import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { RhCartProvider, useCart } from '../index';

// The cart logic itself is unit-tested in @ulabase/kit. What is left to
// assert here is the adapter's own job: that state and localStorage stay in
// step, and that a second mount reads back what the first one left.

const mug = { productId: 'mug', name: 'Enamel mug', unitAmount: 1450, currency: 'eur' };
const tee = {
  productId: 'tee-classic/yellow-l',
  name: 'Classic T-shirt',
  unitAmount: 2500,
  currency: 'eur',
  options: { colour: 'yellow', size: 'L' },
};

const wrapper = ({ children }: { children: ReactNode }) => <RhCartProvider>{children}</RhCartProvider>;

beforeEach(() => localStorage.clear());

describe('useCart', () => {
  it('refuses to work outside a provider, by name', () => {
    expect(() => renderHook(() => useCart())).toThrow(/RhCartProvider/);
  });

  it('starts empty', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.lines).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.currency).toBe('eur');
  });

  it('adds, counts and totals', () => {
    const { result } = renderHook(() => useCart(), { wrapper });

    act(() => result.current.add(mug, 2));
    act(() => result.current.add(tee));

    expect(result.current.lines).toHaveLength(2);
    expect(result.current.totalItems).toBe(3);
    expect(result.current.subtotal).toBe(1450 * 2 + 2500);
  });

  it('hands createOrder the chosen options too, not only ids and quantities', () => {
    // Without the options the seller reads "Classic T-shirt" and never learns
    // which one — the whole reason a variant is a thing.
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(tee, 2));
    expect(result.current.orderItems).toEqual([
      {
        productId: 'tee-classic/yellow-l',
        quantity: 2,
        metadata: { colour: 'yellow', size: 'L' },
      },
    ]);
  });

  it('survives a reload', () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => first.result.current.add(mug, 3));
    first.unmount();

    const second = renderHook(() => useCart(), { wrapper });
    expect(second.result.current.lines[0]?.quantity).toBe(3);
  });

  it('does not resurrect a removed line on the next mount', () => {
    // The failure this guards against: writing storage in an effect that reacts
    // to the state, rather than in the operation that changed it.
    const first = renderHook(() => useCart(), { wrapper });
    act(() => first.result.current.add(mug));
    act(() => first.result.current.remove('mug'));
    first.unmount();

    expect(renderHook(() => useCart(), { wrapper }).result.current.lines).toEqual([]);
  });

  it('empties on clear, in state and in storage', () => {
    const first = renderHook(() => useCart(), { wrapper });
    act(() => first.result.current.add(mug));
    act(() => first.result.current.clear());
    expect(first.result.current.lines).toEqual([]);
    first.unmount();

    expect(renderHook(() => useCart(), { wrapper }).result.current.lines).toEqual([]);
  });

  it('keeps two carts apart when the storage key differs', () => {
    const a = ({ children }: { children: ReactNode }) => (
      <RhCartProvider storageKey="shop-a">{children}</RhCartProvider>
    );
    const b = ({ children }: { children: ReactNode }) => (
      <RhCartProvider storageKey="shop-b">{children}</RhCartProvider>
    );

    const first = renderHook(() => useCart(), { wrapper: a });
    act(() => first.result.current.add(mug));
    first.unmount();

    expect(renderHook(() => useCart(), { wrapper: b }).result.current.lines).toEqual([]);
    expect(renderHook(() => useCart(), { wrapper: a }).result.current.lines).toHaveLength(1);
  });
});
