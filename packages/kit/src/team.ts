import type { AuthConfig, TeamMembership, TeamMember, LoginMode } from './types.js';
import { apiFetch } from './client.js';
import { applyBearerDelivery } from './auth.js';

export async function getTeams(config: AuthConfig): Promise<TeamMembership[]> {
  const res = await apiFetch(config, '/auth/teams');
  return res.json() as Promise<TeamMembership[]>;
}

/** Lists the caller's active team's members. restheart#642. */
export async function listTeamMembers(config: AuthConfig): Promise<TeamMember[]> {
  const res = await apiFetch(config, '/auth/team/members');
  return res.json() as Promise<TeamMember[]>;
}

/** Removes a member from the caller's active team. Owner/admin only; owners can't remove themselves. */
export async function removeMember(config: AuthConfig, email: string): Promise<void> {
  await apiFetch(config, '/auth/remove-member', { method: 'DELETE', body: JSON.stringify({ email }) });
}

/** Updates a member's org-level role within the caller's active team. Owner/admin only. */
export async function updateMemberRole(config: AuthConfig, email: string, role: 'owner' | 'member'): Promise<void> {
  await apiFetch(config, '/auth/member-role', { method: 'PATCH', body: JSON.stringify({ email, role }) });
}

/** Creates an additional team for the caller, who becomes its owner. restheart#643. */
export async function createTeam(config: AuthConfig, teamName: string): Promise<TeamMembership> {
  const res = await apiFetch(config, '/auth/teams', { method: 'POST', body: JSON.stringify({ teamName }) });
  return res.json() as Promise<TeamMembership>;
}

/** Renames/edits the caller's active team. Owner/admin only. restheart#644. */
export async function updateTeam(
  config: AuthConfig,
  updates: { name?: string; description?: string }
): Promise<void> {
  await apiFetch(config, '/auth/team', { method: 'PATCH', body: JSON.stringify(updates) });
}

/** Deletes the caller's active team. Owner only; fails if the team has other members. restheart#645. */
export async function deleteTeam(config: AuthConfig): Promise<void> {
  await apiFetch(config, '/auth/team', { method: 'DELETE' });
}

/**
 * Switch the active team.
 *
 * Uses the `delivery` query parameter to control token delivery:
 * - bearer (default): delivery=body — new JWT returned in the response JSON body
 * - cookie: delivery=cookie — backend sets HttpOnly JWT cookie
 *
 * No token carries the team: the server reads the active one at every request,
 * and `GET /users/me` answers it as `user.team`.
 *
 * In bearer mode the stored token is replaced with the fresh one so that
 * subsequent requests carry the correct team context.
 *
 * Returns the fresh bearer token (bearer mode), or `null` (cookie mode), so a
 * server action can write it into a response cookie.
 */
export async function switchTeam(
  config: AuthConfig,
  teamId: { $oid: string },
  mode: LoginMode = 'bearer'
): Promise<string | null> {
  const delivery = mode === 'bearer' ? 'body' : 'cookie';
  const res = await apiFetch(config, `/auth/switch-team?delivery=${delivery}`, {
    method: 'POST',
    body: JSON.stringify({ teamId }),
  });

  if (mode === 'bearer') {
    return applyBearerDelivery(config, res);
  }
  // Cookie mode: backend already set the JWT cookie, nothing to do
  return null;
}
