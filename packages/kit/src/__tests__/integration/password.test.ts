import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { register, verify, login, clearToken, getToken } from '../../index';
import { forgotPassword, resetPassword } from '../../password';
import {
  getConfig, testEmail,
  verifyEmail, readPasswordResetToken, deleteUser,
} from './helpers';

const config   = getConfig();
const email    = testEmail('password');
const password = 'Test-Password-99!';
const newPassword = 'NewTest-Password-88!';

beforeAll(async () => {
  await register(config, { email, password, teamName: 'PwdOrg', firstName: 'Test', lastName: 'User' });
  await verifyEmail(email);
});

afterAll(async () => {
  clearToken();
  await deleteUser(email);
});

describe('password reset', () => {
  it('forgotPassword returns without error', async () => {
    await expect(forgotPassword(config, email)).resolves.toBeUndefined();
  });

  it('resetPassword in bearer mode obtains token with a single request (no POST /token fallback)', async () => {
    const token = await readPasswordResetToken(email);
    clearToken();

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const tokenCallsBefore = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/token') && !url.includes('/token/cookie')
    ).length;

    await resetPassword(config, { email, token, password: newPassword });

    const tokenCallsAfter = fetchSpy.mock.calls.filter(
      ([url]) => typeof url === 'string' && url.includes('/token') && !url.includes('/token/cookie')
    ).length;

    // No additional /token call should have been made after resetPassword
    expect(tokenCallsAfter - tokenCallsBefore).toBe(0);

    // A token should now be stored
    expect(getToken()).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it('resetPassword in cookie mode is refused by a service node, which reads no cookie', async () => {
    await forgotPassword(config, email);
    const token = await readPasswordResetToken(email);
    clearToken();

    await expect(
      resetPassword(config, { email, token, password: 'Cookie-Test-77!' }, 'cookie')
    ).rejects.toMatchObject({ status: 400 });
    expect(getToken()).toBeNull();
  });

  it('login works with the new password', async () => {
    clearToken();
    // the refused cookie-mode reset changed nothing: the password is the bearer test's
    const user = await login(config, email, newPassword);
    expect(user._id).toBeTruthy();
  });
});
