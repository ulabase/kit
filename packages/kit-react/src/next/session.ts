import type { AuthConfig, TeamMembership, UserInfo } from '@ulabase/kit';
import { checkSession, getTeams } from '@ulabase/kit';
import { rhServerConfig, RH_SESSION_COOKIE } from './cookies.js';

/**
 * The current session, read on the server from the session cookie. Call this
 * from a Server Component to render authenticated data with no client waterfall.
 *
 * Returns `null` when there is no cookie or the token is expired/rejected.
 *
 * ```tsx
 * // app/dashboard/page.tsx (Server Component)
 * export default async function Page() {
 *   const user = await getServerSession(config);
 *   if (!user) redirect('/auth/login');
 *   return <Dashboard user={user} />;
 * }
 * ```
 */
export async function getServerSession(
  config: AuthConfig,
  cookieName: string = RH_SESSION_COOKIE
): Promise<UserInfo | null> {
  return checkSession(rhServerConfig(config, cookieName));
}

/** The current session together with the user's teams, read on the server. */
export async function getServerSessionWithTeams(
  config: AuthConfig,
  cookieName: string = RH_SESSION_COOKIE
): Promise<{ user: UserInfo | null; teams: TeamMembership[] }> {
  const serverConfig = rhServerConfig(config, cookieName);
  const user = await checkSession(serverConfig);
  if (user === null) return { user: null, teams: [] };
  const teams = await getTeams(serverConfig).catch(() => [] as TeamMembership[]);
  return { user, teams };
}
