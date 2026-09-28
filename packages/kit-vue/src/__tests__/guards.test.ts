import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import * as kit from '@ulabase/kit';
import { createRhAuthStore } from '../store';
import { buildGuards } from '../guards';

vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };
const user = { _id: 'a@b.com', roles: ['user'] } as kit.UserInfo;
const to = { fullPath: '/app' } as RouteLocationNormalized;
const from = { fullPath: '/' } as RouteLocationNormalized;

function signedIn() {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  vi.mocked(kit.checkSession).mockResolvedValue(user);
  vi.mocked(kit.getTeams).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null);
  vi.mocked(kit.checkSession).mockResolvedValue(null);
});

it('B1 authGuard redirects to /auth/login when unauthenticated', async () => {
  const s = createRhAuthStore(config);
  await vi.waitFor(() => expect(s.initializing.value).toBe(false));
  const { authGuard } = buildGuards(s);
  expect(await authGuard(to, from)).toBe('/auth/login');
});

it('B2 authGuard allows when authenticated', async () => {
  signedIn();
  const s = createRhAuthStore(config);
  await vi.waitFor(() => expect(s.isAuthenticated.value).toBe(true));
  const { authGuard } = buildGuards(s);
  expect(await authGuard(to, from)).toBe(true);
});

it('B3 publicGuard redirects an authenticated user into the app', async () => {
  signedIn();
  const s = createRhAuthStore(config);
  await vi.waitFor(() => expect(s.isAuthenticated.value).toBe(true));
  const { publicGuard } = buildGuards(s);
  expect(await publicGuard(to, from)).toBe('/');
});

it('B4 publicGuard allows when unauthenticated', async () => {
  const s = createRhAuthStore(config);
  await vi.waitFor(() => expect(s.initializing.value).toBe(false));
  const { publicGuard } = buildGuards(s);
  expect(await publicGuard(to, from)).toBe(true);
});
