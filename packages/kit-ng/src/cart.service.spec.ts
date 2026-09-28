import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RhCartService, RH_CART_STORAGE_KEY } from './cart.service';

// The cart logic itself is unit-tested in @ulabase/kit. What is left
// here is the service's own job: signals and localStorage staying in step.

const mug = { productId: 'mug', name: 'Enamel mug', unitAmount: 1450, currency: 'eur' };
const tee = {
  productId: 'tee-classic/yellow-l',
  name: 'Classic T-shirt',
  unitAmount: 2500,
  currency: 'eur',
  options: { colour: 'yellow', size: 'L' },
};

function service(storageKey?: string): RhCartService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      RhCartService,
      ...(storageKey ? [{ provide: RH_CART_STORAGE_KEY, useValue: storageKey }] : []),
    ],
  });
  return TestBed.inject(RhCartService);
}

beforeEach(() => localStorage.clear());

describe('RhCartService', () => {
  it('starts empty', () => {
    const cart = service();
    expect(cart.lines()).toEqual([]);
    expect(cart.totalItems()).toBe(0);
    expect(cart.currency()).toBe('eur');
  });

  it('adds, counts and totals', () => {
    const cart = service();
    cart.add(mug, 2);
    cart.add(tee);

    expect(cart.lines()).toHaveLength(2);
    expect(cart.totalItems()).toBe(3);
    expect(cart.subtotal()).toBe(1450 * 2 + 2500);
  });

  it('hands createOrder the chosen options too, not only ids and quantities', () => {
    // Without the options the seller reads "Classic T-shirt" and never learns
    // which one — the whole reason a variant is a thing.
    const cart = service();
    cart.add(tee, 2);
    expect(cart.orderItems()).toEqual([
      {
        productId: 'tee-classic/yellow-l',
        quantity: 2,
        metadata: { colour: 'yellow', size: 'L' },
      },
    ]);
  });

  it('survives a reload', () => {
    service().add(mug, 3);
    expect(service().lines()[0]?.quantity).toBe(3);
  });

  it('does not resurrect a removed line', () => {
    // The failure this guards against: writing storage in an effect reacting to
    // the signal, rather than in the operation that changed it.
    const cart = service();
    cart.add(mug);
    cart.remove('mug');
    expect(service().lines()).toEqual([]);
  });

  it('empties on clear, in signal and in storage', () => {
    const cart = service();
    cart.add(mug);
    cart.clear();
    expect(cart.lines()).toEqual([]);
    expect(service().lines()).toEqual([]);
  });

  it('keeps two carts apart when the storage key differs', () => {
    service('shop-a').add(mug);
    expect(service('shop-b').lines()).toEqual([]);
    expect(service('shop-a').lines()).toHaveLength(1);
  });
});
