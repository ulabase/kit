import type { AuthConfig, ApiError } from './types.js';

// ── Token store (localStorage) ──────────────────────────────────────────────

const TOKEN_KEY = 'rh_access_token';

/** Decode a JWT payload without signature verification. */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const base64Url = jwt.split('.')[1];
  if (!base64Url) throw new Error('Invalid JWT: missing payload segment');
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(base64);
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * The stored token's claims, or `null` when there is no usable token.
 *
 * Useful for what the application knows about the user *before* the user
 * document has been read — `sub` is the user id, which is how an acceptance can
 * be recorded by a session that is blocked from reading `/users/me`.
 *
 * These claims are **not verified**: a JWT payload is base64, and anyone
 * holding the token can change it. Read them for what the client does next,
 * never for an access decision — the server re-checks the signature on every
 * request, which is what actually decides.
 */
export function getTokenClaims(): Record<string, unknown> | null {
  const token = getToken();
  if (!token) return null;
  try {
    return decodeJwtPayload(token);
  } catch {
    return null;
  }
}

/** Returns the token's exp claim in milliseconds, or null if missing/malformed. */
export function getTokenExpiry(token: string): number | null {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload['exp'];
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Store the token in localStorage.
 */
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage unavailable (private browsing, storage full) — fall back to memory-only
    _memoryToken = token;
  }
}

/**
 * Read the stored token if it exists and has not expired.
 * Returns null if the token is missing or expired.
 */
export function getToken(): string | null {
  let token: string | null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    token = _memoryToken;
  }
  if (!token) return null;

  const expMs = getTokenExpiry(token);
  if (expMs !== null && expMs <= Date.now()) {
    clearToken();
    return null;
  }

  return token;
}

/**
 * Clear the stored token and cancel any pending refresh timer.
 */
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
  _memoryToken = null;
}

// ── In-memory fallback (when localStorage is unavailable) ───────────────────

let _memoryToken: string | null = null;

// ── URL validation ──────────────────────────────────────────────────────────

/** Host names that resolve only on a developer machine: there plain http is allowed. */
const LOCAL_HOST = /^localhost$|\.localhost$|\.local$|\.test$/;

/**
 * Returns true if `apiBaseUrl` is a well-formed service URL: any `https://` URL, whatever its
 * domain, so that the kit works on every platform domain and on-prem; `http://` only on a local
 * host name (`localhost`, `.localhost`, `.local`, `.test`).
 */
export function isValidApiBaseUrl(apiBaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    return false;
  }

  if (url.protocol === 'https:') {
    return true;
  }

  const host = url.hostname.toLowerCase();
  return url.protocol === 'http:' && LOCAL_HOST.test(host);
}

function assertValidApiBaseUrl(apiBaseUrl: string): void {
  if (!isValidApiBaseUrl(apiBaseUrl)) {
    throw {
      status: 0,
      message: `Invalid URL: apiBaseUrl must be an https:// service URL (http:// only on localhost, .local or .test), got "${apiBaseUrl}"`,
    } satisfies ApiError;
  }
}

// ── Fetch ───────────────────────────────────────────────────────────────────

/**
 * A `fetch` against the service, with the session already applied: the bearer
 * token, the challenge suppression and the cookie credentials.
 *
 * Every call the kit makes goes through this. It is exported because an
 * application querying its own collections needs exactly the same thing, and
 * re-deriving it at each call site is how a request ends up unauthenticated —
 * which the service answers with a `401`, not with the response the caller was
 * reasoning about.
 *
 * ```ts
 * const res = await apiFetch(config, '/my-collection?pagesize=10');
 * const docs = await res.json();
 * ```
 *
 * Rejects with an `ApiError` (`{ status, message }`) on any non-2xx response,
 * so callers can branch on `status` without unpacking the body.
 *
 * @param path A path on the service, leading slash included — not a full URL.
 */
export async function apiFetch(
  config: AuthConfig,
  path: string,
  init?: RequestInit
): Promise<Response> {
  assertValidApiBaseUrl(config.apiBaseUrl);

  const url = `${config.apiBaseUrl}${path}`;
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  // Suppress RESTHeart's WWW-Authenticate challenge on 401 responses —
  // without this, browsers show their native Basic Auth popup whenever
  // an unauthenticated request (e.g. a session check) gets a 401.
  headers.set('No-Auth-Challenge', 'true');

  // Attach the Bearer token. The source is pluggable: SPA adapters use the
  // default localStorage store; server runtimes pass a source that reads the
  // token from the request cookie (there is no localStorage on a server).
  const token = config.getToken ? await config.getToken() : getToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Called through, not captured at module load, so a caller that replaces the
  // global `fetch` after import is still honoured.
  const send = config.transport ?? ((u: string, i?: RequestInit) => fetch(u, i));

  let res: Response;
  try {
    res = await send(url, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch (cause) {
    // No response at all — DNS, offline, CORS, an aborted request. Reported in
    // the same shape as everything else so callers have one error type to
    // handle, and `status: 0` to tell "never reached the service" from "the
    // service said no".
    const err: ApiError = {
      status: 0,
      message: cause instanceof Error ? cause.message : 'Network request failed',
    };
    config.onError?.(err);
    throw err;
  }

  if (!res.ok) {
    let message = res.statusText;
    let body: unknown;
    try {
      body = await res.json();
      const b = body as Record<string, unknown>;
      // `error` too, and it is not an afterthought: RESTHeart's MongoDB API says
      // `message`, and the Cloud admin node's own services say `error`. Reading
      // only the first threw away every explanation the second ever gave —
      // "400 Bad Request" in place of "Live Stripe keys require a Shared or
      // Dedicated plan", which is the difference between a fix and an
      // afternoon. The CLI's service-side client already read all three.
      message = (b['message'] ?? b['msg'] ?? b['error'] ?? message) as string;
    } catch {
      // ignore parse errors
    }
    const err: ApiError = { status: res.status, message };
    // Logged only when nobody is listening. In a browser with no `onError` this
    // is often the only trace a failed call leaves, and it is worth having. When
    // a caller has registered a handler it has said it is watching, and a second
    // report is noise — in a CLI it lands on stderr immediately before the
    // message the tool wrote for the user, and in CI it puts full URLs in the
    // log. `onError` observes rather than swallows, so nothing is lost either
    // way: the error is thrown regardless.
    if (!config.onError) {
      console.error(`[apiFetch] ${init?.method ?? 'GET'} ${url} → ${res.status} ${res.statusText}`, body ?? '');
    }
    config.onError?.(err);
    throw err;
  }

  return res;
}
