import type { ApiError } from '@ulabase/kit';

/**
 * A request against a service node.
 *
 * The core's `apiFetch` is what the admin client uses, and it is the right
 * thing there: it validates that `apiBaseUrl` is an `https://` service URL,
 * `http://` only on a local host name, which is a real guard on a browser-facing
 * kit and costs nothing for the admin node.
 *
 * A service node's URL is not the caller's to choose — it comes back from
 * `GET /srvs-mgmt/{srvId}/jwt`, already decided by the server. Re-validating a
 * value the server just issued buys no safety and does break the one case where
 * it does not pass: a local integration environment on a host name the guard does
 * not know. So this speaks `fetch` directly, and
 * fails in the same `ApiError` shape as everything else so a caller still has
 * one error type to handle.
 */
export async function request(
  baseUrl: string,
  path: string,
  init: RequestInit & { token?: string } = {},
  transport: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)
): Promise<Response> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  // Without this RESTHeart answers a 401 with a `WWW-Authenticate` challenge.
  // Harmless in Node, but the header costs nothing and keeps the two clients
  // behaving identically.
  headers.set('No-Auth-Challenge', 'true');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res!: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await transport(`${baseUrl}${path}`, { ...rest, headers });
    } catch (cause) {
      // `status: 0` tells "never reached the service" from "the service said no",
      // which is the distinction a half-configured run needs in its report.
      throw {
        status: 0,
        message: cause instanceof Error ? cause.message : 'Network request failed',
      } satisfies ApiError;
    }
    // A plan's rate limit is a pause, not a failure: a setup on the Free plan can
    // go past its requests per minute, and stopping there would leave the
    // service half configured. Wait as long as the service asks, then go on.
    if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) break;
    const seconds = retryAfterSeconds(res.headers.get('Retry-After'));
    process.stderr.write(`  The plan's request limit is reached: waiting ${seconds} seconds, then going on.\n`);
    await new Promise(r => setTimeout(r, seconds * 1000));
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as Record<string, unknown>;
      message = (body['message'] ?? body['msg'] ?? body['error'] ?? message) as string;
    } catch {
      // a body that is not JSON tells us nothing the status does not
    }
    throw { status: res.status, message } satisfies ApiError;
  }

  return res;
}

/** How many times a request refused with 429 is tried again. */
const RATE_LIMIT_RETRIES = 3;

/** The wait a 429 asks for, in seconds: its `Retry-After`, or a minute when absent or unreadable. */
export function retryAfterSeconds(header: string | null): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) : 60;
}

/** True when `err` is an `ApiError` carrying `status`. */
export function isApiError(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && 'status' in err;
}

/**
 * Run `fn`, answering `false` on a `404` instead of throwing.
 *
 * Every `*Exists` check is this shape: absent is an answer, not a failure. Any
 * other status still throws — a `403` means the token cannot see the thing,
 * which is emphatically not the same as the thing not being there, and
 * swallowing it would report a step as "missing", apply it, and fail again.
 */
export async function existsOr404<T>(fn: () => Promise<T>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (isApiError(err) && err.status === 404) return false;
    throw err;
  }
}
