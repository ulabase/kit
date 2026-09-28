import { cookies } from 'next/headers';
import type { AuthConfig, UserInfo } from '@ulabase/kit';
import {
  login as kitLogin,
  switchTeam as kitSwitchTeam,
  activate as kitActivate,
  resetPassword as kitResetPassword,
  logout as kitLogout,
} from '@ulabase/kit';
import {
  resolveCookieOptions,
  cookieMaxAge,
  rhServerConfig,
  type SessionCookieOptions,
} from './cookies.js';

export interface ServerActionOptions {
  cookie?: Partial<SessionCookieOptions>;
}

/**
 * Run a bearer-mode core call with a capturing config, then write the fresh
 * token into the session cookie.
 *
 * The config's `setToken` sink captures the token instead of touching
 * `localStorage` (which doesn't exist on a server and would leak into a shared
 * module global). `getToken` returns the captured token once it exists, else the
 * current cookie — so `login` can fetch `/users/me` with the token it just
 * obtained, and `switchTeam` authorises with the existing session.
 *
 * Must run inside a Server Action or Route Handler, where the cookie store is
 * writable.
 */
async function runCapturing<T>(
  config: AuthConfig,
  opts: SessionCookieOptions,
  run: (cfg: AuthConfig) => Promise<T>
): Promise<T> {
  const store = await cookies();
  const current = store.get(opts.name)?.value ?? null;
  let captured: string | null = null;

  const cfg: AuthConfig = {
    ...config,
    getToken: () => captured ?? current,
    setToken: (t) => {
      captured = t;
    },
  };

  const result = await run(cfg);

  if (captured) {
    store.set(opts.name, captured, {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
      maxAge: cookieMaxAge(captured),
    });
  }
  return result;
}

/** Server-action login: exchanges credentials and sets the session cookie. Returns the user. */
export async function rhLogin(
  config: AuthConfig,
  email: string,
  password: string,
  options: ServerActionOptions = {}
): Promise<UserInfo> {
  const opts = resolveCookieOptions(options.cookie);
  return runCapturing(config, opts, (cfg) => kitLogin(cfg, email, password, 'bearer'));
}

/** Server-action switch-team: rewrites the session cookie with the new team claim. */
export async function rhSwitchTeam(
  config: AuthConfig,
  teamId: { $oid: string },
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  await runCapturing(config, opts, (cfg) => kitSwitchTeam(cfg, teamId, 'bearer'));
}

/** Server-action account activation: sets the password and logs the invitee in via cookie. */
export async function rhActivate(
  config: AuthConfig,
  payload: { email: string; token: string; password: string },
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  await runCapturing(config, opts, (cfg) => kitActivate(cfg, payload, 'bearer'));
}

/** Server-action password reset: applies the new password and logs the user in via cookie. */
export async function rhResetPassword(
  config: AuthConfig,
  payload: { email: string; token: string; password: string },
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  await runCapturing(config, opts, (cfg) => kitResetPassword(cfg, payload, 'bearer'));
}

/** Server-action logout: best-effort upstream logout, then clears the session cookie. */
export async function rhLogout(
  config: AuthConfig,
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  try {
    await kitLogout(rhServerConfig(config, opts.name));
  } catch {
    // Upstream logout is best-effort — clearing the cookie is what ends the session.
  }
  const store = await cookies();
  store.delete(opts.name);
}
