import {
  defineEventHandler,
  getCookie,
  setCookie,
  deleteCookie,
  getRequestURL,
  sendRedirect,
  type H3Event,
} from 'h3';
import type { AuthConfig } from '@ulabase/kit';
import { getTokenExpiry } from '@ulabase/kit';
import { resolveCookieOptions, cookieMaxAge, type SessionCookieOptions } from './cookies.js';

export interface RhServerMiddlewareOptions {
  loginPath?: string;
  appPath?: string;
  isProtected?: (pathname: string) => boolean;
  isPublicOnly?: (pathname: string) => boolean;
  cookie?: Partial<SessionCookieOptions>;
  /** Fraction of the token TTL after which the cookie is proactively renewed. Default `0.8`. */
  refreshThreshold?: number;
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const seg = token.split('.')[1];
    if (!seg) return null;
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function shouldRefresh(token: string, threshold: number): boolean {
  const payload = decodePayload(token);
  if (!payload) return false;
  const exp = typeof payload['exp'] === 'number' ? payload['exp'] * 1000 : null;
  const iat = typeof payload['iat'] === 'number' ? payload['iat'] * 1000 : null;
  if (exp === null) return false;
  const now = Date.now();
  if (iat === null) return exp - now <= (exp - now) * (1 - threshold);
  return now >= iat + (exp - iat) * threshold;
}

async function renew(config: AuthConfig, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${config.apiBaseUrl}/token?renew`, {
      headers: { Authorization: `Bearer ${token}`, 'No-Auth-Challenge': 'true' },
    });
    if (!res.ok) return null;
    return res.headers.get('Auth-Token');
  } catch {
    return null;
  }
}

function isTokenValid(token: string | undefined): token is string {
  if (!token) return false;
  const expMs = getTokenExpiry(token);
  return expMs === null || expMs > Date.now();
}

/**
 * Nitro/Nuxt server middleware that keeps the session cookie fresh and runs the
 * guards before the page renders. Cookies can only be written on the server
 * (route handlers, server middleware), which is why the proactive refresh lives
 * here rather than in a browser timer.
 *
 * ```ts
 * // server/middleware/rh-auth.ts
 * export default rhAuthServerMiddleware(config, {
 *   isProtected: (p) => p.startsWith('/app'),
 *   isPublicOnly: (p) => p.startsWith('/auth'),
 * });
 * ```
 */
export function rhAuthServerMiddleware(config: AuthConfig, options: RhServerMiddlewareOptions = {}) {
  const cookieOpts = resolveCookieOptions(options.cookie);
  const loginPath = options.loginPath ?? '/auth/login';
  const appPath = options.appPath ?? '/';
  const threshold = options.refreshThreshold ?? 0.8;
  const isProtected = options.isProtected ?? (() => false);
  const isPublicOnly = options.isPublicOnly ?? (() => false);

  return defineEventHandler(async (event: H3Event) => {
    let token = getCookie(event, cookieOpts.name);

    if (isTokenValid(token) && shouldRefresh(token, threshold)) {
      const renewed = await renew(config, token);
      if (renewed) {
        token = renewed;
        setCookie(event, cookieOpts.name, renewed, {
          httpOnly: cookieOpts.httpOnly,
          secure: cookieOpts.secure,
          sameSite: cookieOpts.sameSite,
          path: cookieOpts.path,
          maxAge: cookieMaxAge(renewed),
        });
      }
    } else if (token && !isTokenValid(token)) {
      deleteCookie(event, cookieOpts.name, { path: cookieOpts.path });
    }

    const authenticated = isTokenValid(token);
    const { pathname } = getRequestURL(event);

    if (isProtected(pathname) && !authenticated) {
      return sendRedirect(event, loginPath, 302);
    }
    if (isPublicOnly(pathname) && authenticated) {
      return sendRedirect(event, appPath, 302);
    }
  });
}
