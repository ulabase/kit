import { getCookie, setCookie, deleteCookie, type H3Event } from 'h3';
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
 * token into the session cookie on the event's response.
 *
 * The config's `setToken` sink captures the token instead of touching
 * `localStorage` (which doesn't exist on a server and would leak into a shared
 * module global). `getToken` returns the captured token once it exists, else the
 * current cookie — so `login` can fetch `/users/me` with the token it just
 * obtained, and `switchTeam` authorises with the existing session.
 */
async function runCapturing<T>(
  event: H3Event,
  config: AuthConfig,
  opts: SessionCookieOptions,
  run: (cfg: AuthConfig) => Promise<T>
): Promise<T> {
  const current = getCookie(event, opts.name) ?? null;
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
    setCookie(event, opts.name, captured, {
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path,
      maxAge: cookieMaxAge(captured),
    });
  }
  return result;
}

/** Server-handler login: exchanges credentials and sets the session cookie. Returns the user. */
export async function rhLogin(
  event: H3Event,
  config: AuthConfig,
  email: string,
  password: string,
  options: ServerActionOptions = {}
): Promise<UserInfo> {
  const opts = resolveCookieOptions(options.cookie);
  return runCapturing(event, config, opts, (cfg) => kitLogin(cfg, email, password, 'bearer'));
}

/** Server-handler switch-team: rewrites the session cookie with the new team claim. */
export async function rhSwitchTeam(
  event: H3Event,
  config: AuthConfig,
  teamId: { $oid: string },
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  await runCapturing(event, config, opts, (cfg) => kitSwitchTeam(cfg, teamId, 'bearer'));
}

/** Server-handler account activation: sets the password and logs the invitee in via cookie. */
export async function rhActivate(
  event: H3Event,
  config: AuthConfig,
  payload: { email: string; token: string; password: string },
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  await runCapturing(event, config, opts, (cfg) => kitActivate(cfg, payload, 'bearer'));
}

/** Server-handler password reset: applies the new password and logs the user in via cookie. */
export async function rhResetPassword(
  event: H3Event,
  config: AuthConfig,
  payload: { email: string; token: string; password: string },
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  await runCapturing(event, config, opts, (cfg) => kitResetPassword(cfg, payload, 'bearer'));
}

/** Server-handler logout: best-effort upstream logout, then clears the session cookie. */
export async function rhLogout(
  event: H3Event,
  config: AuthConfig,
  options: ServerActionOptions = {}
): Promise<void> {
  const opts = resolveCookieOptions(options.cookie);
  try {
    await kitLogout(rhServerConfig(event, config, opts.name));
  } catch {
    // Upstream logout is best-effort — clearing the cookie is what ends the session.
  }
  deleteCookie(event, opts.name, { path: opts.path });
}
