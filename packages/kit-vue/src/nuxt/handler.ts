import {
  defineEventHandler,
  readBody,
  setCookie,
  deleteCookie,
  createError,
  type H3Event,
} from 'h3';
import { resolveCookieOptions, cookieMaxAge, type SessionCookieOptions } from './cookies.js';

export interface SessionHandlerOptions {
  cookie?: Partial<SessionCookieOptions>;
}

/**
 * A server route handler that writes and clears the first-party session cookie.
 * Mount it where the browser can reach it:
 *
 * ```ts
 * // server/api/rh/session.ts
 * import { createSessionHandler } from '@ulabase/kit-vue/nuxt';
 * export default createSessionHandler();
 * ```
 *
 * - **POST** `{ accessToken }` — writes the cookie. Used by the fragment→cookie
 *   bridge and to sync the cookie after a client-side `login`/`switchTeam`.
 * - **DELETE** — clears the cookie (logout).
 */
export function createSessionHandler(options: SessionHandlerOptions = {}) {
  const cookieOpts = resolveCookieOptions(options.cookie);

  return defineEventHandler(async (event: H3Event) => {
    if (event.method === 'DELETE') {
      deleteCookie(event, cookieOpts.name, { path: cookieOpts.path });
      return { ok: true };
    }

    if (event.method === 'POST') {
      const body = await readBody<{ accessToken?: unknown }>(event);
      const token = body?.accessToken;
      if (typeof token !== 'string' || token.length === 0) {
        throw createError({ statusCode: 400, statusMessage: 'accessToken is required' });
      }
      setCookie(event, cookieOpts.name, token, {
        httpOnly: cookieOpts.httpOnly,
        secure: cookieOpts.secure,
        sameSite: cookieOpts.sameSite,
        path: cookieOpts.path,
        maxAge: cookieMaxAge(token),
      });
      return { ok: true };
    }

    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' });
  });
}
