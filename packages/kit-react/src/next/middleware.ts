import { NextResponse, type NextRequest } from 'next/server';
import type { AuthConfig } from '@ulabase/kit';
import { getTokenExpiry } from '@ulabase/kit';
import { resolveCookieOptions, cookieMaxAge, type SessionCookieOptions } from './cookies.js';

export interface RhMiddlewareOptions {
  /** Where to send an unauthenticated user hitting a protected path. Default `/auth/login`. */
  loginPath?: string;
  /** Where to send an authenticated user hitting a public-only path. Default `/`. */
  appPath?: string;
  /** A path requires a session. Default: nothing is protected (refresh-only). */
  isProtected?: (pathname: string) => boolean;
  /** A path is for signed-out users only (login, signup). Default: nothing. */
  isPublicOnly?: (pathname: string) => boolean;
  /** Session cookie overrides (name, sameSite, …). */
  cookie?: Partial<SessionCookieOptions>;
  /** Fraction of the token TTL after which middleware proactively renews. Default `0.8`. */
  refreshThreshold?: number;
}

/** Decode a JWT payload without verifying the signature. Returns `null` if malformed. */
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

/** True once the token has burned past `threshold` of its issued→expiry lifetime. */
function shouldRefresh(token: string, threshold: number): boolean {
  const payload = decodePayload(token);
  if (!payload) return false;
  const exp = typeof payload['exp'] === 'number' ? payload['exp'] * 1000 : null;
  const iat = typeof payload['iat'] === 'number' ? payload['iat'] * 1000 : null;
  if (exp === null) return false;
  const now = Date.now();
  if (iat === null) {
    // No issued-at — fall back to "within the last 20% of remaining life".
    return exp - now <= (exp - now) * (1 - threshold);
  }
  return now >= iat + (exp - iat) * threshold;
}

/** Ask RESTHeart for a renewed token, carrying the current one as a bearer. */
async function renew(config: AuthConfig, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${config.apiBaseUrl}/token?renew`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'No-Auth-Challenge': 'true',
      },
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
 * Next.js middleware that keeps the session cookie fresh and runs the guards
 * before render — so there is no flash of unauthenticated content.
 *
 * Cookies can only be written in middleware, route handlers and server actions
 * (never while a Server Component renders), which is why the proactive refresh
 * lives here rather than in a browser timer.
 *
 * ```ts
 * // middleware.ts
 * export const middleware = rhAuthMiddleware(config, {
 *   isProtected: (p) => p.startsWith('/app'),
 *   isPublicOnly: (p) => p.startsWith('/auth'),
 * });
 * export const config = { matcher: ['/((?!_next|.*\\..*).*)'] };
 * ```
 */
export function rhAuthMiddleware(config: AuthConfig, options: RhMiddlewareOptions = {}) {
  const cookieOpts = resolveCookieOptions(options.cookie);
  const loginPath = options.loginPath ?? '/auth/login';
  const appPath = options.appPath ?? '/';
  const threshold = options.refreshThreshold ?? 0.8;
  const isProtected = options.isProtected ?? (() => false);
  const isPublicOnly = options.isPublicOnly ?? (() => false);

  return async (req: NextRequest): Promise<NextResponse> => {
    const { pathname } = req.nextUrl;
    let token = req.cookies.get(cookieOpts.name)?.value;

    // Proactively renew a still-valid-but-aging token, so it never expires
    // mid-navigation. A failed renew is non-fatal: the token remains usable
    // until it actually expires.
    let renewed: string | null = null;
    if (isTokenValid(token) && shouldRefresh(token, threshold)) {
      renewed = await renew(config, token);
      if (renewed) token = renewed;
    }

    const authenticated = isTokenValid(token);

    // Guards — redirect before render.
    if (isProtected(pathname) && !authenticated) {
      const url = req.nextUrl.clone();
      url.pathname = loginPath;
      return NextResponse.redirect(url);
    }
    if (isPublicOnly(pathname) && authenticated) {
      const url = req.nextUrl.clone();
      url.pathname = appPath;
      return NextResponse.redirect(url);
    }

    const res = NextResponse.next();
    // Persist a renewed token (and expire the cookie if the token went invalid).
    if (renewed) {
      res.cookies.set(cookieOpts.name, renewed, {
        httpOnly: cookieOpts.httpOnly,
        secure: cookieOpts.secure,
        sameSite: cookieOpts.sameSite,
        path: cookieOpts.path,
        maxAge: cookieMaxAge(renewed),
      });
    } else if (token && !authenticated) {
      res.cookies.delete(cookieOpts.name);
    }
    return res;
  };
}
