import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  addToCart,
  cartTotals,
  loadCart,
  removeFromCart,
  saveCart,
  setCartQuantity,
  toOrderItems,
  DEFAULT_CART_STORAGE_KEY,
  type CartItem,
  type CartLine,
  type OrderItem,
} from '@ulabase/kit';

/**
 * The reactive cart store.
 *
 * Independent of {@link import('./store.js').RhAuthStore | RhAuthStore}: a cart
 * belongs to the browser, not to a session, and a shop that makes people sign
 * in before they can put something in a basket loses most of them there. It
 * becomes an order — which does need a config — when {@link RhCartStore.orderItems}
 * is handed to `createOrder`.
 *
 * Create it with {@link createRhCart} and read it with `useCart()`.
 */
export interface RhCartStore {
  /** The lines, in the order they were added. */
  readonly lines: Readonly<Ref<CartLine[]>>;
  /** Units, not lines: two of one thing counts two. */
  readonly totalItems: ComputedRef<number>;
  /** Display only. Minor units, meaningful when every line shares a currency. */
  readonly subtotal: ComputedRef<number>;
  /** The first line's currency, or `'eur'` when empty. */
  readonly currency: ComputedRef<string>;
  /** The cart as `createOrder` wants it. */
  readonly orderItems: ComputedRef<OrderItem[]>;

  /** Adds an item, or increases the line already holding it. */
  add(item: CartItem, quantity?: number): void;
  /** Sets a line's quantity. Zero removes it. */
  setQuantity(productId: string, quantity: number): void;
  remove(productId: string): void;
  clear(): void;
}

/**
 * Builds the store.
 *
 * On the server `localStorage` does not exist and the cart reads as empty. That
 * is correct for a rendered page — a request carries no basket — but it does
 * mean an SSR'd cart count starts at zero and fills in once the browser takes
 * over.
 *
 * @param storageKey Where the cart is kept. Defaults to `'rh-cart'`; worth
 *                   setting when two of your apps share an origin.
 */
export function createRhCartStore(storageKey: string = DEFAULT_CART_STORAGE_KEY): RhCartStore {
  const lines = ref<CartLine[]>(loadCart(storageKey));

  const totals = computed(() => cartTotals(lines.value));

  /**
   * State and storage move together, in the operation that changed them.
   *
   * Deliberately not a `watch` on the ref: a watcher runs after the fact and
   * the failure that produces is a line coming back from storage after
   * somebody removed it.
   */
  const apply = (next: (current: CartLine[]) => CartLine[]): void => {
    const updated = next(lines.value);
    saveCart(updated, storageKey);
    lines.value = updated;
  };

  return {
    lines,
    totalItems: computed(() => totals.value.totalItems),
    subtotal: computed(() => totals.value.subtotal),
    currency: computed(() => totals.value.currency),
    orderItems: computed(() => toOrderItems(lines.value)),

    add: (item, quantity = 1) => apply(current => addToCart(current, item, quantity)),
    setQuantity: (productId, quantity) => apply(current => setCartQuantity(current, productId, quantity)),
    remove: productId => apply(current => removeFromCart(current, productId)),
    clear: () => apply(() => []),
  };
}
