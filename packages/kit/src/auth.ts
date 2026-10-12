import type { AuthConfig, UserInfo, LoginMode } from './types.js';
import { apiFetch, setToken, getToken, clearToken, getTokenExpiry } from './client.js';

// ── Proactive refresh ───────────────────────────────────────────────────────

let _refreshTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a proactive token refresh at 80% of the token's remaining TTL.
 * The timer is module-scoped so it survives across calls but is cleared on
 * logout or explicit session clear.
 */
export function scheduleRefresh(config: AuthConfig): void {
  cancelRefresh();

  const token = getToken();
  if (!token) return;

  const expMs = getTokenExpiry(token);
  if (expMs === null) return; // no exp claim — can't schedule

  const ttlMs = expMs - Date.now();
  if (ttlMs <= 0) return; // already expired

  const refreshAt = ttlMs * 0.8; // 80% of TTL
  _refreshTimerId = setTimeout(async () => {
    try {
      await renewToken(config);
      scheduleRefresh(config); // reschedule from new expiry
    } catch {
      // refresh failed — token will expire naturally, next API call
      // will get a 401 and the session will be cleared
    }
  }, refreshAt);
}

/**
 * Force the server to issue a new token, replacing the one currently held.
 *
 * A JWT is a snapshot taken at issuance: a change to the user document — the
 * roles, or an application-level field such as consents — does not reach the
 * token the client is already holding. The renewed token is rebuilt from the
 * user document as it is read at that moment, so it carries the change.
 *
 * This is what {@link scheduleRefresh} calls on its timer, and what an
 * application calls right after writing something the token is expected to
 * reflect (see `acceptConsents`).
 *
 * @param mode 'bearer' (default): `GET /token?renew=true`, the new token is
 *             stored and returned. 'cookie': `POST /token/cookie?renew=true`,
 *             the backend replaces the JWT cookie and `null` is returned.
 */
export async function renewToken(
  config: AuthConfig,
  mode: LoginMode = 'bearer'
): Promise<string | null> {
  if (mode === 'cookie') {
    await apiFetch(config, '/token/cookie?renew=true', { method: 'POST' });
    return null;
  }

  const res = await apiFetch(config, '/token?renew=true');
  const token = res.headers.get('Auth-Token');
  if (!token) {
    throw { status: 0, message: 'Token renewal succeeded but no Auth-Token in response' };
  }

  persistToken(config, token);
  return token;
}

/** Cancel any pending refresh timer. */
export function cancelRefresh(): void {
  if (_refreshTimerId !== null) {
    clearTimeout(_refreshTimerId);
    _refreshTimerId = null;
  }
}

// ── Bearer token extraction from auto-login responses ───────────────────────

/**
 * Extract a bearer token from an auto-login response (activate, resetPassword,
 * switchTeam) and store it locally. The server returns the token in the JSON
 * body (`access_token`) when `delivery=body`, or in the `Auth-Token` header
 * as a fallback.
 *
 * By default the token is stored in localStorage and a proactive refresh is
 * scheduled. When `config.setToken` is provided (server runtimes), the token is
 * handed to that sink instead and no refresh timer is scheduled.
 *
 * Returns the token so a server action can write it into a response cookie, or
 * `null` if none was found (cookie mode, or the server did not include one).
 */
export async function applyBearerDelivery(
  config: AuthConfig,
  res: Response
): Promise<string | null> {
  const body = await res.clone().json().catch(() => null) as Record<string, unknown> | null;
  const token = (body?.['access_token'] as string | undefined) ?? res.headers.get('Auth-Token') ?? null;
  if (token) {
    persistToken(config, token);
  }
  return token;
}

/**
 * Store a freshly obtained token. Uses the pluggable sink when configured
 * (server: capture only), otherwise the localStorage store plus a proactive
 * refresh timer (browser).
 */
function persistToken(config: AuthConfig, token: string): void {
  if (config.setToken) {
    config.setToken(token);
  } else {
    setToken(token);
    scheduleRefresh(config);
  }
}

// ── Auth operations ─────────────────────────────────────────────────────────

/**
 * Read the authenticated user from `GET /users/me`.
 *
 * The response is the stored user document, not the token's claims — so it
 * carries application-level fields (e.g. consents) even when they are not
 * exposed as JWT claims. Unlike {@link checkSession} it makes no local expiry
 * check and does not clear the session on failure.
 */
export async function getUserInfo<E extends object = Record<never, never>>(config: AuthConfig): Promise<UserInfo<E>> {
  const res = await apiFetch(config, '/users/me');
  return res.json() as Promise<UserInfo<E>>;
}

/**
 * Register a new user.
 *
 * The generic parameter `E` lets callers pass additional properties that the
 * application's JSON Schema declares on the users collection (e.g. `consents`).
 *
 * **Important:** when no JSON Schema is configured on the users collection the
 * server silently drops any properties beyond the base set (`email`, `password`,
 * `teamName`, `firstName`, `lastName`). The request still succeeds with `201`.
 */
export async function register<E extends object = Record<never, never>>(
  config: AuthConfig,
  payload: {
    email: string;
    password: string;
    teamName: string;
    firstName: string;
    lastName: string;
  } & E
): Promise<void> {
  await apiFetch(config, '/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Build the URL for email verification.
 *
 * This is a browser-navigation endpoint — the backend responds with a 302
 * redirect to frontend-app-url. The JWT is delivered according to delivery:
 * - cookie: sets a JWT cookie (for same-origin setups)
 * - fragment: appends #access_token=... to the redirect URL (for cross-origin SPAs)
 */
export function buildVerifyUrl(
  config: AuthConfig,
  email: string,
  token: string,
  delivery: 'cookie' | 'fragment' = 'fragment'
): string {
  const params = new URLSearchParams({ email, token, delivery });
  return `${config.apiBaseUrl}/auth/verify?${params.toString()}`;
}

/**
 * Verify an email token after signup.
 *
 * Returns the URL the browser must navigate to. The backend verifies the
 * token, promotes the user to roles: ["user"], and 302 redirects to
 * frontend-app-url with the JWT delivered per the delivery parameter.
 *
 * @param delivery  'cookie' sets a JWT cookie (same-origin);
 *                  'fragment' (default) redirects with #access_token=... in the URL hash
 *                  (cross-origin SPAs). Read the token from window.location.hash.
 *
 * @example
 * // Fragment delivery (default) — cross-origin SPAs
 * window.location.href = await verify(config, email, token);
 * // After redirect, read the token from location.hash
 *
 * @example
 * // Cookie delivery — same-origin setups
 * await verify(config, email, token, 'cookie');
 * // Cookie is set by the backend, no further action needed
 */
export async function verify(
  config: AuthConfig,
  email: string,
  token: string,
  delivery: 'cookie' | 'fragment' = 'fragment'
): Promise<string> {
  return buildVerifyUrl(config, email, token, delivery);
}

/**
 * Login.
 *
 * @param mode 'bearer' (default): POST /token, stores token in localStorage.
 *             'cookie': POST /token/cookie, backend sets HttpOnly JWT cookie.
 */
export async function login<E extends object = Record<never, never>>(
  config: AuthConfig,
  email: string,
  password: string,
  mode: LoginMode = 'bearer'
): Promise<UserInfo<E>> {
  const credentials = btoa(`${email}:${password}`);

  if (mode === 'cookie') {
    // Cookie login — backend sets JWT cookie, no token in response
    await apiFetch(config, '/token/cookie', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}` },
    });
    const user = await getUserInfo<E>(config);
    if (user.roles.includes('$unauthenticated')) {
      throw { status: 403, message: 'Account not verified' };
    }
    return user;
  }

  // Bearer login — token comes back in Auth-Token response header
  const res = await apiFetch(config, '/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}` },
  });

  // Read token from Auth-Token response header
  const token = res.headers.get('Auth-Token');
  if (!token) {
    throw { status: 0, message: 'Login succeeded but no Auth-Token in response' };
  }

  persistToken(config, token);

  const user = await getUserInfo<E>(config);
  if (user.roles.includes('$unauthenticated')) {
    clearToken();
    cancelRefresh();
    throw { status: 403, message: 'Account not verified' };
  }
  return user;
}

export async function logout(config: AuthConfig, mode: LoginMode = 'bearer'): Promise<void> {
  cancelRefresh();
  try {
    // Only a cookie session has something to undo on the server: /logout clears the auth cookie.
    // A bearer session ends here, when the token is dropped; service nodes do not serve /logout.
    if (mode === 'cookie') await apiFetch(config, '/logout', { method: 'POST' });
  } finally {
    clearToken();
  }
}

/**
 * Check the current session state.
 *
 * Reads the token from localStorage — if present and not expired,
 * returns user info from the server. Otherwise returns null.
 */
/**
 * Runs a call again on a temporary failure: a 429 after its Retry-After when readable (at most 30
 * seconds, else 3), a 5xx or a network error (status 0) after a short pause; three attempts in
 * all. Any other error, and the last one, are thrown as they came.
 */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err: unknown) {
      const e = err as { status?: number; retryAfter?: number };
      const temporary = e?.status === 429 || e?.status === 0 || (e?.status ?? 0) >= 500;
      if (!temporary || attempt === 3) throw err;
      const seconds = e?.status === 429 ? Math.min(e.retryAfter ?? 3, 30) : attempt;
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }
  }
}

export async function checkSession<E extends object = Record<never, never>>(config: AuthConfig): Promise<UserInfo<E> | null> {
  // Resolve through the pluggable source: SPA adapters read localStorage, server
  // runtimes read the request cookie. Falls back to the localStorage default.
  const token = config.getToken ? await config.getToken() : getToken();
  if (!token) return null;

  // Client-side expiry check — no need to call the server if the JWT is expired
  const expMs = getTokenExpiry(token);
  if (expMs !== null && expMs <= Date.now()) {
    clearToken();
    cancelRefresh();
    return null;
  }

  // Token exists and is not expired — verify with server and get full user info.
  // Only 401 and 403 end the session: a 429, a 5xx or a dropped connection says nothing about
  // the token, so the check waits and tries again before giving up.
  try {
    const user = await withRetry(() => getUserInfo<E>(config));
    if (user.roles.includes('$unauthenticated')) {
      clearToken();
      cancelRefresh();
      return null;
    }
    return user;
  } catch (err: unknown) {
    const e = err as { status?: number };
    if (e?.status === 401 || e?.status === 403) {
      clearToken();
      cancelRefresh();
      return null;
    }
    throw err;
  }
}
