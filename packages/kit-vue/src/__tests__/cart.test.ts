import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { createRhCart, createRhCartStore, useCart } from '../index';

// The cart logic itself is unit-tested in @ulabase/kit. What is left
// here is the adapter's own job: refs and localStorage staying in step, and the
// plugin actually providing the store.

const mug = { productId: 'mug', name: 'Enamel mug', unitAmount: 1450, currency: 'eur' };
const tee = {
  productId: 'tee-classic/yellow-l',
  name: 'Classic T-shirt',
  unitAmount: 2500,
  currency: 'eur',
  options: { colour: 'yellow', size: 'L' },
};

beforeEach(() => localStorage.clear());

describe('createRhCartStore', () => {
  it('starts empty', () => {
    const cart = createRhCartStore();
    expect(cart.lines.value).toEqual([]);
    expect(cart.totalItems.value).toBe(0);
    expect(cart.currency.value).toBe('eur');
  });

  it('adds, counts and totals', () => {
    const cart = createRhCartStore();
    cart.add(mug, 2);
    cart.add(tee);

    expect(cart.lines.value).toHaveLength(2);
    expect(cart.totalItems.value).toBe(3);
    expect(cart.subtotal.value).toBe(1450 * 2 + 2500);
  });

  it('hands createOrder the chosen options too, not only ids and quantities', () => {
    // Without the options the seller reads "Classic T-shirt" and never learns
    // which one — the whole reason a variant is a thing.
    const cart = createRhCartStore();
    cart.add(tee, 2);
    expect(cart.orderItems.value).toEqual([
      {
        productId: 'tee-classic/yellow-l',
        quantity: 2,
        metadata: { colour: 'yellow', size: 'L' },
      },
    ]);
  });

  it('survives a reload', () => {
    createRhCartStore().add(mug, 3);
    expect(createRhCartStore().lines.value[0]?.quantity).toBe(3);
  });

  it('does not resurrect a removed line', () => {
    // The failure this guards against: writing storage in a `watch` reacting to
    // the ref, rather than in the operation that changed it.
    const cart = createRhCartStore();
    cart.add(mug);
    cart.remove('mug');
    expect(createRhCartStore().lines.value).toEqual([]);
  });

  it('empties on clear, in the ref and in storage', () => {
    const cart = createRhCartStore();
    cart.add(mug);
    cart.clear();
    expect(cart.lines.value).toEqual([]);
    expect(createRhCartStore().lines.value).toEqual([]);
  });

  it('keeps two carts apart when the storage key differs', () => {
    createRhCartStore('shop-a').add(mug);
    expect(createRhCartStore('shop-b').lines.value).toEqual([]);
    expect(createRhCartStore('shop-a').lines.value).toHaveLength(1);
  });
});

describe('useCart', () => {
  /** Mounts a component and hands back whatever its setup returned. */
  function inSetup<T>(setup: () => T, plugin?: ReturnType<typeof createRhCart>): T {
    let captured!: T;
    const app = createApp(
      defineComponent({
        setup() {
          captured = setup();
          return () => h('div');
        },
      })
    );
    if (plugin) app.use(plugin);
    app.mount(document.createElement('div'));
    return captured;
  }

  it('reads the store the plugin provided', () => {
    const plugin = createRhCart();
    plugin.store.add(mug, 2);

    const cart = inSetup(() => useCart(), plugin);
    expect(cart.totalItems.value).toBe(2);
  });

  it('says which plugin is missing rather than returning undefined', () => {
    expect(() => inSetup(() => useCart())).toThrow(/createRhCart/);
  });
});
