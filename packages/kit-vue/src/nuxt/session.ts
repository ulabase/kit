import type { H3Event } from 'h3';
import type { AuthConfig, TeamMembership, UserInfo } from '@ulabase/kit';
import { checkSession, getTeams } from '@ulabase/kit';
import { rhServerConfig, RH_SESSION_COOKIE } from './cookies.js';

/**
 * The current session, read on the server from the session cookie. Call it from
 * a server route or a Nitro handler to render authenticated data with no client
 * waterfall. Returns `null` when there is no cookie or the token is rejected.
 *
 * ```ts
 * // server/api/me.get.ts
 * export default defineEventHandler((event) => getServerSession(event, config));
 * ```
 */
export async function getServerSession(
  event: H3Event,
  config: AuthConfig,
  cookieName: string = RH_SESSION_COOKIE
): Promise<UserInfo | null> {
  return checkSession(rhServerConfig(event, config, cookieName));
}

/** The current session together with the user's teams, read on the server. */
export async function getServerSessionWithTeams(
  event: H3Event,
  config: AuthConfig,
  cookieName: string = RH_SESSION_COOKIE
): Promise<{ user: UserInfo | null; teams: TeamMembership[] }> {
  const serverConfig = rhServerConfig(event, config, cookieName);
  const user = await checkSession(serverConfig);
  if (user === null) return { user: null, teams: [] };
  const teams = await getTeams(serverConfig).catch(() => [] as TeamMembership[]);
  return { user, teams };
}
