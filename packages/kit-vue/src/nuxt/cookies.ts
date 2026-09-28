import { getCookie, type H3Event } from 'h3';
import type { AuthConfig } from '@ulabase/kit';
import { getTokenExpiry } from '@ulabase/kit';

/**
 * Name of the first-party session cookie. A container for the same JWT a SPA
 * keeps in `localStorage`, set by *your* Nuxt server on *your* domain, so it is
 * first-party and no browser blocks it. RESTHeart is unaware it exists
 * (see docs/ADAPTERS.md §2.2).
 */
export const RH_SESSION_COOKIE = 'rh_session';

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

/** `maxAge` (seconds) derived from the token's `exp`, so cookie and token expire together. */
export function cookieMaxAge(token: string): number | undefined {
  const expMs = getTokenExpiry(token);
  if (expMs === null) return undefined;
  const seconds = Math.floor((expMs - Date.now()) / 1000);
  return seconds > 0 ? seconds : 0;
}

/**
 * Build an {@link AuthConfig} whose token source is the request cookie rather
 * than `localStorage`. Pass this to any `@ulabase/kit` function you call
 * from Nuxt server code (server routes, `defineEventHandler`, Nitro middleware).
 *
 * ```ts
 * const session = await checkSession(rhServerConfig(event, config));
 * ```
 */
export function rhServerConfig(
  event: H3Event,
  config: AuthConfig,
  cookieName: string = RH_SESSION_COOKIE
): AuthConfig {
  return {
    ...config,
    getToken: () => getCookie(event, cookieName) ?? null,
  };
}
