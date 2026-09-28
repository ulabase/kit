import type { App } from 'vue';
import type { AuthConfig } from '@ulabase/kit';
import { createRhAuthStore, type RhAuthStore } from './store.js';
import { buildGuards, type GuardOptions, type RhGuards } from './guards.js';
import { RH_AUTH_KEY } from './keys.js';

export interface RhAuth extends RhGuards {
  /** The reactive store, also reachable anywhere via `useAuth()`. */
  store: RhAuthStore;
  /** Vue plugin install hook — registers the store for `useAuth()`. */
  install(app: App): void;
}

/**
 * Create the auth plugin. Register it once, then wire the guards into the router:
 *
 * ```ts
 * // main.ts
 * const rhAuth = createRhAuth({ apiBaseUrl: import.meta.env.VITE_API_URL });
 * app.use(rhAuth);
 *
 * // router.ts
 * router.beforeEach(rhAuth.authGuard);   // or per-route: { beforeEnter: rhAuth.authGuard }
 * ```
 *
 * `rhAuth.authGuard` / `rhAuth.publicGuard` are bound to the same store that
 * `useAuth()` returns inside components.
 */
export function createRhAuth(config: AuthConfig, options: GuardOptions = {}): RhAuth {
  const store = createRhAuthStore(config);
  const { authGuard, publicGuard } = buildGuards(store, options);

  return {
    store,
    authGuard,
    publicGuard,
    install(app: App): void {
      app.provide(RH_AUTH_KEY, store);
    },
  };
}
