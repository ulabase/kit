import { inject } from 'vue';
import { RH_PAYMENTS_KEY } from './keys.js';
import type { RhPaymentsStore } from './payments.js';

/**
 * Read the shared payments store inside a component's `setup`. Requires the app
 * to have registered the plugin: `app.use(createRhPayments(config, rhAuth))`.
 *
 * ```vue
 * <script setup lang="ts">
 * import { usePayments } from '@ulabase/kit-vue';
 * const payments = usePayments();
 * </script>
 * <template>
 *   <p v-if="payments.subscription.value">Plan: {{ payments.plan.value }}</p>
 *   <button v-if="payments.canManageBilling.value" @click="upgrade">Change plan</button>
 * </template>
 * ```
 */
export function usePayments(): RhPaymentsStore {
  const store = inject(RH_PAYMENTS_KEY);
  if (!store) {
    throw new Error(
      'usePayments() requires the RESTHeart payments plugin — call app.use(createRhPayments(config, rhAuth))'
    );
  }
  return store;
}
