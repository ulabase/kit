import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
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
} from '@ulabase/kit';
/**
 * Where {@link RhCartService} keeps the cart in `localStorage`. Defaults to `'rh-cart'`.
 *
 * Worth providing when two of your apps share an origin, which is one deployment decision away
 * from happening by accident.
 *
 * Declared here rather than in `tokens.ts`: that file is the authentication surface, and a cart
 * needs no session. Importing the kit into it to reach one constant also dragged the kit's module
 * into every spec that touches `RH_AUTH_CONFIG`, where it is auto-mocked — which shifted module
 * initialisation enough to make two unrelated guard tests fail, in CI only.
 */
export const RH_CART_STORAGE_KEY = new InjectionToken<string>('RH_CART_STORAGE_KEY', {
  providedIn: 'root',
  factory: () => DEFAULT_CART_STORAGE_KEY,
});

/**
 * The shopping cart.
 *
 * Independent of {@link import('./auth.service.js').RhAuthService | RhAuthService}
 * and of `RH_AUTH_CONFIG`: a cart belongs to the browser, not to a session, and
 * a shop that makes people sign in before they can put something in a basket
 * loses most of them there. It becomes an order — which does need a config —
 * when {@link RhCartService.orderItems} is handed to `createOrder`.
 *
 * On the server, `localStorage` does not exist and the cart reads as empty.
 * That is correct for a rendered page — a request carries no basket — but it
 * does mean a server-rendered cart count starts at zero and fills in once the
 * browser takes over.
 */
@Injectable({ providedIn: 'root' })
export class RhCartService {
  private readonly storageKey = inject(RH_CART_STORAGE_KEY);

  // Declared after `storageKey` so the field is there: initializers run in order.
  private readonly _lines = signal<CartLine[]>(loadCart(this.storageKey));

  /** The lines, in the order they were added. */
  readonly lines = this._lines.asReadonly();

  private readonly totals = computed(() => cartTotals(this._lines()));

  /** Units, not lines: two of one thing counts two. */
  readonly totalItems = computed(() => this.totals().totalItems);
  /** Display only. Minor units, meaningful when every line shares a currency. */
  readonly subtotal = computed(() => this.totals().subtotal);
  /** The first line's currency, or `'eur'` when empty. */
  readonly currency = computed(() => this.totals().currency);
  /** The cart as `createOrder` wants it. */
  readonly orderItems = computed(() => toOrderItems(this._lines()));

  /** Adds an item, or increases the line already holding it. */
  add(item: CartItem, quantity = 1): void {
    this.apply(current => addToCart(current, item, quantity));
  }

  /** Sets a line's quantity. Zero removes it. */
  setQuantity(productId: string, quantity: number): void {
    this.apply(current => setCartQuantity(current, productId, quantity));
  }

  remove(productId: string): void {
    this.apply(current => removeFromCart(current, productId));
  }

  clear(): void {
    this.apply(() => []);
  }

  /**
   * State and storage move together, in the operation that changed them.
   *
   * Deliberately not an `effect` reacting to the signal: an effect runs after
   * the fact and can be skipped or reordered, and the failure that produces is
   * a line coming back from storage after somebody removed it.
   */
  private apply(next: (current: CartLine[]) => CartLine[]): void {
    const updated = next(this._lines());
    saveCart(updated, this.storageKey);
    this._lines.set(updated);
  }
}
