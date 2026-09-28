// Nuxt subpath: server-side rendering support for @ulabase/kit-vue.
// Everything importing `h3` lives behind this subpath, so a Vue app on Vite
// never resolves it. `h3` is an optional peer dependency.

export {
  RH_SESSION_COOKIE,
  DEFAULT_COOKIE_OPTIONS,
  rhServerConfig,
  cookieMaxAge,
  resolveCookieOptions,
} from './cookies.js';
export type { SessionCookieOptions } from './cookies.js';

export { getServerSession, getServerSessionWithTeams } from './session.js';

export { rhAuthServerMiddleware } from './middleware.js';
export type { RhServerMiddlewareOptions } from './middleware.js';

export { createSessionHandler } from './handler.js';
export type { SessionHandlerOptions } from './handler.js';

export {
  syncServerSession,
  clearServerSession,
  bridgeFragmentToCookie,
  DEFAULT_SESSION_ENDPOINT,
} from './client.js';

export {
  rhLogin,
  rhSwitchTeam,
  rhActivate,
  rhResetPassword,
  rhLogout,
} from './actions.js';
export type { ServerActionOptions } from './actions.js';
