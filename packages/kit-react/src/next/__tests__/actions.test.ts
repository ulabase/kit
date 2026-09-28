// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake cookie store, hoisted so the next/headers mock factory can close over it.
const { store } = vi.hoisted(() => ({
  store: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => store) }));
vi.mock('@ulabase/kit');

import * as kit from '@ulabase/kit';
import { rhLogin, rhLogout, rhSwitchTeam } from '../actions';

const config = { apiBaseUrl: 'https://x.restheart.com' };

beforeEach(() => {
  vi.clearAllMocks();
  store.get.mockReturnValue(undefined); // no current cookie
  vi.mocked(kit.getTokenExpiry).mockReturnValue(null); // → session cookie, no maxAge
});

describe('server actions', () => {
  it('rhLogin captures the fresh token through the sink and writes the cookie', async () => {
    // The core persists the token via config.setToken; we stand in for that.
    vi.mocked(kit.login).mockImplementation(async (cfg) => {
      cfg.setToken?.('FRESH');
      return { _id: 'a@b.com', roles: ['user'] } as kit.UserInfo;
    });

    const user = await rhLogin(config, 'a@b.com', 'pw');

    expect(user._id).toBe('a@b.com');
    expect(store.set).toHaveBeenCalledWith(
      'rh_session',
      'FRESH',
      expect.objectContaining({ httpOnly: true, path: '/' })
    );
  });

  it('rhSwitchTeam rewrites the cookie with the new team token', async () => {
    vi.mocked(kit.switchTeam).mockImplementation(async (cfg) => {
      cfg.setToken?.('T2');
      return 'T2';
    });

    await rhSwitchTeam(config, { $oid: '2' });

    expect(store.set).toHaveBeenCalledWith('rh_session', 'T2', expect.anything());
  });

  it('rhLogout clears the cookie', async () => {
    vi.mocked(kit.logout).mockResolvedValue(undefined);

    await rhLogout(config);

    expect(store.delete).toHaveBeenCalledWith('rh_session');
  });
});
