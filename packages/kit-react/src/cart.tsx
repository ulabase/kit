import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
 * The cart, shared app-wide through {@link RhCartProvider}.
 *
 * Independent of {@link import('./context.js').RhAuthProvider | RhAuthProvider}:
 * a cart belongs to the browser, not to a session, and a shop that makes people
 * sign in before they can put something in a basket loses most of them there.
 * It becomes an order — which does need a config — when {@link RhCart.orderItems}
 * is handed to `createOrder`.
 */
export interface RhCart {
  /** The lines, in the order they were added. */
  lines: CartLine[];
  /** Units, not lines: two of one thing counts two. */
  totalItems: number;
  /** Display only. Minor units, meaningful when every line shares a currency. */
  subtotal: number;
  /** The first line's currency, or `'eur'` when empty. */
  currency: string;
  /** The cart as `createOrder` wants it. */
  orderItems: OrderItem[];

  /** Adds an item, or increases the line already holding it. */
  add(item: CartItem, quantity?: number): void;
  /** Sets a line's quantity. Zero removes it. */
  setQuantity(productId: string, quantity: number): void;
  remove(productId: string): void;
  clear(): void;
}

export interface RhCartProviderProps {
  children: ReactNode;
  /**
   * Where the cart is kept in `localStorage`. Defaults to `'rh-cart'`.
   *
   * Worth setting when two of your apps share an origin, which is one
   * deployment decision away from happening by accident.
   */
  storageKey?: string;
}

const CartContext = createContext<RhCart | null>(null);

/**
 * Holds the cart and keeps it in `localStorage`, so a reload does not empty it.
 *
 * State and storage move together in one place: every operation writes the
 * array it just produced rather than reacting to a change afterwards, which is
 * what stops a reload from resurrecting a line somebody removed.
 */
export function RhCartProvider({ children, storageKey = DEFAULT_CART_STORAGE_KEY }: RhCartProviderProps) {
  const [lines, setLines] = useState<CartLine[]>(() => loadCart(storageKey));

  const apply = useCallback(
    (next: (current: CartLine[]) => CartLine[]) => {
      setLines(current => {
        const updated = next(current);
        saveCart(updated, storageKey);
        return updated;
      });
    },
    [storageKey]
  );

  const add = useCallback(
    (item: CartItem, quantity = 1) => apply(current => addToCart(current, item, quantity)),
    [apply]
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) =>
      apply(current => setCartQuantity(current, productId, quantity)),
    [apply]
  );

  const remove = useCallback(
    (productId: string) => apply(current => removeFromCart(current, productId)),
    [apply]
  );

  const clear = useCallback(() => apply(() => []), [apply]);

  const value = useMemo<RhCart>(() => {
    const totals = cartTotals(lines);
    return {
      lines,
      totalItems: totals.totalItems,
      subtotal: totals.subtotal,
      currency: totals.currency,
      orderItems: toOrderItems(lines),
      add,
      setQuantity,
      remove,
      clear,
    };
  }, [lines, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** The cart. Must be called inside an {@link RhCartProvider}. */
export function useCart(): RhCart {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within an <RhCartProvider>');
  return ctx;
}
