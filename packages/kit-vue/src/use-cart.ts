import { inject } from 'vue';
import { RH_CART_KEY } from './keys.js';
import type { RhCartStore } from './cart-store.js';

/**
 * Read the shared cart inside a component's `setup`. Requires the app to have
 * registered the plugin: `app.use(createRhCart())`.
 *
 * ```vue
 * <script setup lang="ts">
 * import { useCart } from '@ulabase/kit-vue';
 * const cart = useCart();
 * </script>
 * <template>
 *   <button @click="cart.add({ productId: 'mug', name: 'Enamel mug', unitAmount: 1450 })">
 *     Add to cart
 *   </button>
 *   <p>{{ cart.totalItems.value }} items</p>
 * </template>
 * ```
 */
export function useCart(): RhCartStore {
  const store = inject(RH_CART_KEY);
  if (!store) {
    throw new Error('useCart() requires the RESTHeart cart plugin — call app.use(createRhCart())');
  }
  return store;
}
