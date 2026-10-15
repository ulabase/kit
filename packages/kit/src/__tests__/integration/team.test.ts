import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { register, verify, login, clearToken, getToken } from '../../index';
import { invite, acceptInvite } from '../../invite';
import { getTeams, switchTeam } from '../../team';
import {
  getConfig, testEmail,
  verifyEmail, readInvitationToken, deleteUser,
} from './helpers';

const config      = getConfig();
const ownerEmail  = testEmail('team-owner');
const memberEmail = testEmail('team-member');
const password    = 'Test-Password-99!';

/** Decode the `team` claim from a JWT without verifying the signature. */
function decodeTeamClaim(token: string): unknown {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
  return payload['team'];
}

async function registerAndVerify(email: string) {
  await register(config, { email, password, teamName: `Org-${email.slice(0, 8)}`, firstName: 'Test', lastName: 'User' });
  await verifyEmail(email);
}

beforeAll(async () => {
  await registerAndVerify(ownerEmail);
  await registerAndVerify(memberEmail);
  // owner invites member so member has 2 teams
  await login(config, ownerEmail, password);
  await invite(config, memberEmail, 'member');
  const inviteToken = await readInvitationToken(memberEmail);
  clearToken();
  await login(config, memberEmail, password);
  await acceptInvite(config, inviteToken);
});

afterAll(async () => {
  clearToken();
  await Promise.allSettled([deleteUser(ownerEmail), deleteUser(memberEmail)]);
});

describe('team', () => {
  beforeAll(() => login(config, memberEmail, password));

  it('getTeams returns all memberships', async () => {
    const teams = await getTeams(config);
    expect(teams.length).toBeGreaterThanOrEqual(2);
  });

  it('switchTeam in bearer mode updates the stored token (single request)', async () => {
    const teams = await getTeams(config);
    const other = teams.find((t: { active?: boolean }) => !t.active);
    expect(other).toBeDefined();

    const tokenBefore = getToken();
    expect(tokenBefore).toBeTruthy();

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const tokenCallsBefore = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/token') && !url.includes('/token/cookie')
    ).length;

    await switchTeam(config, other!.id);

    const tokenCallsAfter = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/token') && !url.includes('/token/cookie')
    ).length;

    // No additional /token call should have been made after switchTeam
    expect(tokenCallsAfter - tokenCallsBefore).toBe(0);

    // Token should have been replaced with a fresh one that actually carries
    // the new active team — not just "some truthy JWT-shaped string" (which
    // would also be true of a stale, unreplaced token).
    const tokenAfter = getToken();
    expect(tokenAfter).toBeTruthy();
    expect(tokenAfter).not.toBe(tokenBefore);
    expect(tokenAfter!.split('.').length).toBe(3);
    // The `team` claim is `{ _id: { $oid }, role }` — verify the id matches.
    const claim = decodeTeamClaim(tokenAfter!) as Record<string, unknown>;
    expect(claim['_id']).toEqual(other!.id);
    expect(claim['role']).toBe(other!.role);

    fetchSpy.mockRestore();
  });

  it('switchTeam in cookie mode is refused by a service node, which reads no cookie', async () => {
    // Establish our own bearer session to look up a team to switch to —
    // independent of whatever auth state the previous test left behind.
    clearToken();
    await login(config, memberEmail, password);
    const teams = await getTeams(config);
    const other = teams.find((t: { active?: boolean }) => !t.active);
    expect(other).toBeDefined();

    await expect(switchTeam(config, other!.id, 'cookie')).rejects.toMatchObject({ status: 400 });
  });
});
