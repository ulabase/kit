// Next.js subpath: server-side rendering support for @ulabase/kit-react.
// Everything importing `next/*` lives behind this subpath, so a React app on Vite
// never resolves it. `next` is an optional peer dependency.

export {
  RH_SESSION_COOKIE,
  DEFAULT_COOKIE_OPTIONS,
  rhServerConfig,
  cookieMaxAge,
  resolveCookieOptions,
} from './cookies.js';
export type { SessionCookieOptions } from './cookies.js';

export { getServerSession, getServerSessionWithTeams } from './session.js';

export { rhAuthMiddleware } from './middleware.js';
export type { RhMiddlewareOptions } from './middleware.js';

export { createSessionRoute } from './route.js';
export type { SessionRouteOptions } from './route.js';

export {
  SessionSync,
  syncServerSession,
  clearServerSession,
  DEFAULT_SESSION_ENDPOINT,
} from './sync.js';
export type { SessionSyncProps } from './sync.js';

export {
  rhLogin,
  rhSwitchTeam,
  rhActivate,
  rhResetPassword,
  rhLogout,
} from './actions.js';
export type { ServerActionOptions } from './actions.js';
