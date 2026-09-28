import { NextResponse, type NextRequest } from 'next/server';
import { resolveCookieOptions, cookieMaxAge, type SessionCookieOptions } from './cookies.js';

export interface SessionRouteOptions {
  cookie?: Partial<SessionCookieOptions>;
}

/**
 * Route handlers that write and clear the first-party session cookie. Mount them
 * on a route the browser can reach:
 *
 * ```ts
 * // app/api/rh/session/route.ts
 * import { createSessionRoute } from '@ulabase/kit-react/next';
 * export const { POST, DELETE } = createSessionRoute();
 * ```
 *
 * - **POST** `{ accessToken }` — writes the cookie. Used by the fragment→cookie
 *   bridge ({@link SessionSync}) and to sync the cookie after a client-side
 *   `login`/`switchTeam`.
 * - **DELETE** — clears the cookie (logout).
 */
export function createSessionRoute(options: SessionRouteOptions = {}) {
  const cookieOpts = resolveCookieOptions(options.cookie);

  async function POST(req: NextRequest): Promise<NextResponse> {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }
    const token = (body as { accessToken?: unknown } | null)?.accessToken;
    if (typeof token !== 'string' || token.length === 0) {
      return NextResponse.json({ message: 'accessToken is required' }, { status: 400 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(cookieOpts.name, token, {
      httpOnly: cookieOpts.httpOnly,
      secure: cookieOpts.secure,
      sameSite: cookieOpts.sameSite,
      path: cookieOpts.path,
      maxAge: cookieMaxAge(token),
    });
    return res;
  }

  async function DELETE(): Promise<NextResponse> {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(cookieOpts.name);
    return res;
  }

  return { POST, DELETE };
}
