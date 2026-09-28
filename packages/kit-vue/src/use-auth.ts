import { inject } from 'vue';
import { RH_AUTH_KEY } from './keys.js';
import type { RhAuthStore } from './store.js';

/**
 * Read the shared auth store inside a component's `setup`. Requires the app to
 * have registered the plugin: `app.use(createRhAuth(config))`.
 *
 * ```vue
 * <script setup lang="ts">
 * import { useAuth } from '@ulabase/kit-vue';
 * const auth = useAuth();
 * </script>
 * <template>
 *   <span v-if="auth.isAuthenticated.value">{{ auth.user.value?.profile?.name }}</span>
 * </template>
 * ```
 */
export function useAuth(): RhAuthStore {
  const store = inject(RH_AUTH_KEY);
  if (!store) {
    throw new Error(
      'useAuth() requires the RESTHeart auth plugin — call app.use(createRhAuth(config))'
    );
  }
  return store;
}
