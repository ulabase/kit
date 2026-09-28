import { cookies } from 'next/headers';
import type { AuthConfig } from '@ulabase/kit';
import { getTokenExpiry } from '@ulabase/kit';

/**
 * Name of the first-party session cookie.
 *
 * This cookie is a container for the same JWT a SPA keeps in `localStorage`. It
 * is set by *your* Next.js server on *your* domain, so it is first-party and no
 * browser blocks it. It is not a RESTHeart authentication cookie — RESTHeart is
 * unaware it exists (see docs/ADAPTERS.md §2.2).
 */
export const RH_SESSION_COOKIE = 'rh_session';

/** Options applied when writing the session cookie. */
export interface SessionCookieOptions {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
}

export const DEFAULT_COOKIE_OPTIONS: SessionCookieOptions = {
  name: RH_SESSION_COOKIE,
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

export function resolveCookieOptions(
  overrides?: Partial<SessionCookieOptions>
): SessionCookieOptions {
  return { ...DEFAULT_COOKIE_OPTIONS, ...overrides };
}

/**
 * `maxAge` (seconds) for a session cookie holding `token`, derived from the
 * JWT's `exp` claim so the cookie and the token expire together. Returns
 * `undefined` when the token has no `exp` (session cookie).
 */
export function cookieMaxAge(token: string): number | undefined {
  const expMs = getTokenExpiry(token);
  if (expMs === null) return undefined;
  const seconds = Math.floor((expMs - Date.now()) / 1000);
  return seconds > 0 ? seconds : 0;
}

/**
 * Build an {@link AuthConfig} whose token source is the request cookie rather
 * than `localStorage`. Pass this to any `@ulabase/kit` function you call
 * from a Server Component, Route Handler, or Server Action.
 *
 * ```ts
 * const session = await checkSession(rhServerConfig(config));
 * ```
 */
export function rhServerConfig(
  config: AuthConfig,
  cookieName: string = RH_SESSION_COOKIE
): AuthConfig {
  return {
    ...config,
    getToken: async () => {
      // `cookies()` is async in Next 15 and sync in 14 — awaiting covers both.
      const store = await cookies();
      return store.get(cookieName)?.value ?? null;
    },
  };
}
