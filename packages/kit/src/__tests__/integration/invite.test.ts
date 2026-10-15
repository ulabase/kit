import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { register, login, clearToken, getToken } from '../../index';
import { invite, getInvitation, activate, acceptInvite } from '../../invite';
import {
  getConfig, testEmail,
  verifyEmail, readInvitationToken, deleteUser,
} from './helpers';

const config       = getConfig();
const ownerEmail   = testEmail('invite-owner');
const newUserEmail = testEmail('invite-new');
const existingUserEmail = testEmail('invite-existing');
const password     = 'Test-Password-99!';

async function registerAndVerify(email: string) {
  await register(config, { email, password, teamName: `Org-${email.slice(0, 8)}`, firstName: 'Test', lastName: 'User' });
  await verifyEmail(email);
}

beforeAll(async () => {
  await registerAndVerify(ownerEmail);
  await registerAndVerify(existingUserEmail);
});

afterAll(async () => {
  clearToken();
  await Promise.allSettled([
    deleteUser(ownerEmail),
    deleteUser(newUserEmail),
    deleteUser(existingUserEmail),
  ]);
});

describe('invite — new user', () => {
  beforeAll(async () => {
    await login(config, ownerEmail, password);
  });

  it('invite sends invitation to a new user', async () => {
    await expect(invite(config, newUserEmail, 'member')).resolves.toBeUndefined();
  });

  it('getInvitation returns metadata', async () => {
    const token      = await readInvitationToken(newUserEmail);
    const invitation = await getInvitation(config, newUserEmail, token);
    expect(invitation.isNewUser).toBe(true);
    expect(invitation.role).toBe('member');
    expect(invitation.email).toBe(newUserEmail);
  });

  it('activate in bearer mode obtains token with a single request (no POST /token fallback)', async () => {
    const token = await readInvitationToken(newUserEmail);
    clearToken();

    // Spy on fetch to count /token calls
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const tokenCallsBefore = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/token') && !url.includes('/token/cookie')
    ).length;

    await activate(config, { email: newUserEmail, token, password });

    const tokenCallsAfter = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/token') && !url.includes('/token/cookie')
    ).length;

    // No additional /token call should have been made after activate
    expect(tokenCallsAfter - tokenCallsBefore).toBe(0);

    // A token should now be stored
    expect(getToken()).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it('activate in cookie mode is refused by a service node, which reads no cookie', async () => {
    // Need a fresh invite for the cookie-mode test
    clearToken();
    await login(config, ownerEmail, password);
    const cookieUserEmail = testEmail('invite-cookie');
    await invite(config, cookieUserEmail, 'member');
    const inviteToken = await readInvitationToken(cookieUserEmail);
    clearToken();

    await expect(
      activate(config, { email: cookieUserEmail, token: inviteToken, password }, 'cookie')
    ).rejects.toMatchObject({ status: 400 });
    expect(getToken()).toBeNull();

    // Cleanup
    await deleteUser(cookieUserEmail);
  });
});

describe('invite — existing user', () => {
  beforeAll(async () => {
    clearToken();
    await login(config, ownerEmail, password);
  });

  it('invite sends invitation to an existing user', async () => {
    await expect(invite(config, existingUserEmail, 'member')).resolves.toBeUndefined();
  });

  it('acceptInvite adds the user to the team', async () => {
    const token = await readInvitationToken(existingUserEmail);
    clearToken();
    await login(config, existingUserEmail, password);
    await expect(acceptInvite(config, token)).resolves.toBeUndefined();
  });
});
