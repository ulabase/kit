// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineEventHandler } from 'h3';
import { call, setCookieHeader } from './server';

vi.mock('@ulabase/kit');

import * as kit from '@ulabase/kit';
import { rhLogin, rhLogout, rhSwitchTeam } from '../actions';

const config = { apiBaseUrl: 'https://x.restheart.com' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getTokenExpiry).mockReturnValue(null); // → session cookie, no maxAge
});

describe('server actions', () => {
  it('D8 rhLogin captures the fresh token into the cookie and returns the user', async () => {
    vi.mocked(kit.login).mockImplementation(async (cfg) => {
      cfg.setToken?.('FRESH');
      return { _id: 'a@b.com', roles: ['user'] } as kit.UserInfo;
    });

    const res = await call([defineEventHandler((e) => rhLogin(e, config, 'a@b.com', 'pw'))], {
      method: 'POST',
    });

    expect(setCookieHeader(res)).toContain('rh_session=FRESH');
    expect(JSON.parse(res.body)._id).toBe('a@b.com');
  });

  it('D8 rhSwitchTeam rewrites the cookie with the new team token', async () => {
    vi.mocked(kit.switchTeam).mockImplementation(async (cfg) => {
      cfg.setToken?.('T2');
      return 'T2';
    });

    const res = await call([defineEventHandler((e) => rhSwitchTeam(e, config, { $oid: '2' }))], {
      method: 'POST',
    });

    expect(setCookieHeader(res)).toContain('rh_session=T2');
  });

  it('D9 rhLogout clears the cookie', async () => {
    vi.mocked(kit.logout).mockResolvedValue(undefined);

    const res = await call([defineEventHandler((e) => rhLogout(e, config))], { method: 'POST' });

    expect(setCookieHeader(res)).toMatch(/rh_session=;/);
  });
});
