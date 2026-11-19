import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCheckoutSession,
  getSubscription,
  grantLicense,
  openBillingPortal,
  waitForSubscription,
  WaitTimeoutError,
} from '../../index';
import type { AuthConfig, Subscription } from '../../types';

const apiBaseUrl = 'https://x.restheart.com';

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    plan: 'free',
    active: false,
    licensed: false,
    cancel_at_period_end: false,
    seats: { limit: null, licensed: 0, available: null, over_limit: false },
    ...overrides,
  };
}

describe('grantLicense', () => {
  it('resolves "granted" on 201', async () => {
    const config: AuthConfig = { apiBaseUrl, transport: async () => new Response('{}', { status: 201 }) };
    await expect(grantLicense(config, 'a@b.com')).resolves.toBe('granted');
  });

  it('resolves "already-licensed" on 200 — the seat did not change', async () => {
    const config: AuthConfig = { apiBaseUrl, transport: async () => new Response('{}', { status: 200 }) };
    await expect(grantLicense(config, 'a@b.com')).resolves.toBe('already-licensed');
  });

  it('rejects with status 409 when no seat is available — apiFetch already turns this into an ApiError', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response(JSON.stringify({ message: 'no seat available' }), { status: 409 }),
    };
    await expect(grantLicense(config, 'a@b.com')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects with status 404 when userId is not a member', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response(JSON.stringify({ message: 'not a member' }), { status: 404 }),
    };
    await expect(grantLicense(config, 'a@b.com')).rejects.toMatchObject({ status: 404 });
  });
});

describe('createCheckoutSession', () => {
  it('resolves the checkout url on 201', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/x' }), { status: 201 }),
    };
    await expect(createCheckoutSession(config, 'gold', 'month')).resolves.toEqual({
      url: 'https://checkout.stripe.com/x',
    });
  });

  it('rejects with status 409 for a team that already has an active subscription', async () => {
    const config: AuthConfig = { apiBaseUrl, transport: async () => new Response(null, { status: 409 }) };
    await expect(createCheckoutSession(config, 'gold', 'month')).rejects.toMatchObject({ status: 409 });
  });

  it('sends locale only when given: a service that does not know it is sent nothing new', async () => {
    const bodies: unknown[] = [];
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async (_url, init) => {
        bodies.push(JSON.parse((init as RequestInit).body as string));
        return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/x' }), { status: 201 });
      },
    };
    await createCheckoutSession(config, 'gold', 'month');
    await createCheckoutSession(config, 'gold', 'month', 'it');
    expect(bodies).toEqual([
      { plan: 'gold', interval: 'month' },
      { plan: 'gold', interval: 'month', locale: 'it' },
    ]);
  });
});

describe('openBillingPortal', () => {
  it('rejects with status 402 for a team with no Stripe customer yet', async () => {
    const config: AuthConfig = { apiBaseUrl, transport: async () => new Response(null, { status: 402 }) };
    await expect(openBillingPortal(config)).rejects.toMatchObject({ status: 402 });
  });

  it('has no body without a locale, and the locale alone with one', async () => {
    const bodies: unknown[] = [];
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async (_url, init) => {
        bodies.push((init as RequestInit).body);
        return new Response(JSON.stringify({ url: 'https://billing.stripe.com/x' }), { status: 201 });
      },
    };
    await openBillingPortal(config);
    await openBillingPortal(config, 'it');
    expect(bodies).toEqual([undefined, JSON.stringify({ locale: 'it' })]);
  });
});

describe('waitForSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves on the first check when the predicate is already true — no wait', async () => {
    let calls = 0;
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => {
        calls++;
        return new Response(JSON.stringify(subscription({ plan: 'gold', active: true })), { status: 200 });
      },
    };

    const result = await waitForSubscription(config, s => s.plan === 'gold');

    expect(calls).toBe(1);
    expect(result.plan).toBe('gold');
  });

  it('polls at the given interval until the predicate becomes true', async () => {
    let calls = 0;
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => {
        calls++;
        const plan = calls >= 3 ? 'gold' : 'free';
        return new Response(JSON.stringify(subscription({ plan })), { status: 200 });
      },
    };

    const promise = waitForSubscription(config, s => s.plan === 'gold', { intervalMs: 1000 });
    // Let the first (immediate) check happen, then two intervals for the
    // second and third checks.
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(calls).toBe(3);
    expect(result.plan).toBe('gold');
  });

  it('rejects with WaitTimeoutError, not a generic error, when the condition never becomes true', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response(JSON.stringify(subscription({ plan: 'free' })), { status: 200 }),
    };

    const promise = waitForSubscription(config, s => s.plan === 'gold', {
      timeoutMs: 3000,
      intervalMs: 1000,
    });
    // Prevent an unhandled rejection warning while we advance timers below.
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(3000);

    await expect(promise).rejects.toBeInstanceOf(WaitTimeoutError);
  });

  it('rejects immediately when the signal is already aborted, without calling the transport', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(subscription()), { status: 200 }));
    const config: AuthConfig = { apiBaseUrl, transport };
    const controller = new AbortController();
    controller.abort();

    await expect(waitForSubscription(config, () => true, { signal: controller.signal })).rejects.toBeDefined();
    expect(transport).not.toHaveBeenCalled();
  });

  it('rejects when the signal aborts while waiting between polls', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response(JSON.stringify(subscription({ plan: 'free' })), { status: 200 }),
    };
    const controller = new AbortController();

    const promise = waitForSubscription(config, s => s.plan === 'gold', {
      intervalMs: 5000,
      signal: controller.signal,
    });
    promise.catch(() => {});

    // First check has happened and failed the predicate; it is now waiting
    // out the interval when the abort arrives.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(promise).rejects.toBeDefined();
  });

  it('checkSession behavior: getSubscription performs a plain GET with the session already applied', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(subscription({ plan: 'gold' })), { status: 200 }));
    const config: AuthConfig = { apiBaseUrl, transport };

    const result = await getSubscription(config);

    expect(result.plan).toBe('gold');
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/stripe/subscription`, expect.anything());
  });
});
