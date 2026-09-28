import type { App } from 'vue';
import type { AuthConfig } from '@ulabase/kit';
import { createRhPaymentsStore, type RhPaymentsStore } from './payments.js';
import type { RhAuth } from './create.js';
import type { RhAuthStore } from './store.js';
import { RH_PAYMENTS_KEY } from './keys.js';

export interface RhPayments {
  /** The reactive payments store, also reachable anywhere via `usePayments()`. */
  store: RhPaymentsStore;
  /** Vue plugin install hook — registers the store for `usePayments()`. */
  install(app: App): void;
}

/**
 * Create the payments plugin — the counterpart of {@link createRhAuth}, kept
 * separate because a subscription is not a session.
 *
 * It needs the auth plugin (or its store) to follow the signed-in user: the
 * subscription belongs to the team, so it loads on sign-in and reloads on
 * `switchTeam`.
 *
 * ```ts
 * // main.ts
 * const config = { apiBaseUrl: import.meta.env.VITE_API_URL, payments: true };
 * const rhAuth = createRhAuth(config);
 * const rhPayments = createRhPayments(config, rhAuth);
 *
 * app.use(rhAuth);
 * app.use(rhPayments);
 * ```
 *
 * Without `config.payments === true` the store still exists, but no
 * `/stripe/*` call is ever made — a service without the `stripe` plugin
 * answers `404` on those paths.
 */
export function createRhPayments(config: AuthConfig, auth: RhAuth | RhAuthStore): RhPayments {
  // Accept either what `createRhAuth` returned or the bare store, so this
  // reads naturally in `main.ts` without reaching for `.store` first.
  const authStore: RhAuthStore = 'store' in auth ? auth.store : auth;
  const store = createRhPaymentsStore(config, authStore.user);

  return {
    store,
    install(app: App): void {
      app.provide(RH_PAYMENTS_KEY, store);
    },
  };
}
