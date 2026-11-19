import type { NavigationGuard } from 'vue-router';
import type { RhAuthStore } from './store.js';

export interface GuardOptions {
  /** Where `authGuard` redirects an unauthenticated user. Default `/auth/login`. */
  loginPath?: string;
  /** Where `publicGuard` redirects an authenticated user. Default `/`. */
  appPath?: string;
}

export interface RhGuards {
  authGuard: NavigationGuard;
  publicGuard: NavigationGuard;
}

/**
 * Build `vue-router` navigation guards bound to `store`. `createRhAuth` calls
 * this for you and exposes the guards on its return value; use it directly only
 * if you manage the store yourself.
 *
 * `authGuard` redirects to `loginPath` when unauthenticated; `publicGuard`
 * redirects to `appPath` when already authenticated. Both check the in-memory
 * session first and fall back to a `checkSession()` round trip.
 *
 * Leave the invitation page outside both guards, on both of its paths:
 * `/auth/activate` (where the service's invitation email links a new user) and
 * `/invitations/accept` (an existing one). It must work for signed-out invitees,
 * signed-in users, and people without an account.
 */
export function buildGuards(store: RhAuthStore, options: GuardOptions = {}): RhGuards {
  const loginPath = options.loginPath ?? '/auth/login';
  const appPath = options.appPath ?? '/';

  const authGuard: NavigationGuard = async () => {
    if (store.isAuthenticated.value) return true;
    const user = await store.checkSession().catch(() => null);
    return user !== null ? true : loginPath;
  };

  const publicGuard: NavigationGuard = async () => {
    if (!store.isAuthenticated.value) return true;
    const user = await store.checkSession().catch(() => null);
    return user === null ? true : appPath;
  };

  return { authGuard, publicGuard };
}
