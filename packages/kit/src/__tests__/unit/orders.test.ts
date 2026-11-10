import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrder, getCatalog, getCatalogItem, getOrder, readOrderRef, waitForOrder } from '../../index';
import type { AuthConfig, Order } from '../../types';

const apiBaseUrl = 'https://x.restheart.com';

function order(overrides: Partial<Order> = {}): Order {
  return {
    _id: { $oid: '65f1c2a4b3e4d5f6a7b8c9d0' },
    stripe_session_id: 'cs_test_x',
    secret: 's3cr3t',
    checkout_url: 'https://checkout.stripe.com/x',
    payer: { type: 'guest' },
    status: 'pending_payment',
    line_items: [],
    currency: 'eur',
    amount_subtotal: 1000,
    amount_total: 1000,
    amount_refunded: 0,
    created_at: { $date: 0 },
    expires_at: { $date: 0 },
    ...overrides,
  };
}

describe('getCatalog', () => {
  it('reads the default "catalog" collection when none is given', async () => {
    const transport = vi.fn(async () => new Response('[]', { status: 200 }));
    await getCatalog({ apiBaseUrl, transport });
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/catalog`, expect.anything());
  });

  it('reads the configured collection when the service renamed it', async () => {
    const transport = vi.fn(async () => new Response('[]', { status: 200 }));
    await getCatalog({ apiBaseUrl, transport }, { collection: 'products' });
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/products`, expect.anything());
  });

  it('forwards pagination as pagesize/page query params', async () => {
    const transport = vi.fn(async () => new Response('[]', { status: 200 }));
    await getCatalog({ apiBaseUrl, transport }, { pagesize: 20, page: 2 });
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/catalog?pagesize=20&page=2`, expect.anything());
  });

  it('reads through the named aggregation, each variable a query parameter in JSON', async () => {
    const transport = vi.fn(async () => new Response('[]', { status: 200 }));
    await getCatalog({ apiBaseUrl, transport }, { aggregation: 'shop', vars: { category: 'desk', max: 4 } });
    const url = new URL((transport.mock.calls[0] as unknown[])[0] as string);
    expect(url.pathname).toBe('/catalog/_aggrs/shop');
    expect(url.searchParams.get('category')).toBe('"desk"');
    expect(url.searchParams.get('max')).toBe('4');
  });

  it('refuses a variable named like a RESTHeart query parameter, filter above all', async () => {
    const transport = vi.fn(async () => new Response('[]', { status: 200 }));
    await expect(getCatalog({ apiBaseUrl, transport }, { aggregation: 'shop', vars: { filter: 'x' } })).rejects.toThrow(/filter/);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('getCatalogItem', () => {
  it('reads one product by id from the default collection, the id escaped', async () => {
    const transport = vi.fn(async () => new Response('{"_id":"tee classic"}', { status: 200 }));
    await getCatalogItem({ apiBaseUrl, transport }, 'tee classic');
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/catalog/tee%20classic`, expect.anything());
  });

  it('reads from the configured collection when the service renamed it', async () => {
    const transport = vi.fn(async () => new Response('{}', { status: 200 }));
    await getCatalogItem({ apiBaseUrl, transport }, 'mug', 'products');
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/products/mug`, expect.anything());
  });
});

describe('createOrder', () => {
  it('posts to the default "orders" collection with items and no email for an authenticated buyer', async () => {
    const transport = vi.fn(
      async () => new Response(JSON.stringify(order()), { status: 201 })
    );
    await createOrder({ apiBaseUrl, transport }, [{ productId: 'SKU-1', quantity: 2 }]);

    expect(transport).toHaveBeenCalledWith(
      `${apiBaseUrl}/orders`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ items: [{ productId: 'SKU-1', quantity: 2 }] }) })
    );
  });

  it('includes email for a guest checkout', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(order()), { status: 201 }));
    await createOrder({ apiBaseUrl, transport }, [{ productId: 'SKU-1', quantity: 1 }], 'buyer@example.com');

    const [, init] = transport.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      items: [{ productId: 'SKU-1', quantity: 1 }],
      email: 'buyer@example.com',
    });
  });

  it('posts to the configured collection when the service renamed it', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(order()), { status: 201 }));
    await createOrder({ apiBaseUrl, transport }, [{ productId: 'SKU-1', quantity: 1 }], undefined, 'purchases');
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/purchases`, expect.anything());
  });
});

describe('getOrder', () => {
  it('reads by id with no query string when no secret is given', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(order()), { status: 200 }));
    await getOrder({ apiBaseUrl, transport }, '65f1c2a4b3e4d5f6a7b8c9d0');
    expect(transport).toHaveBeenCalledWith(`${apiBaseUrl}/orders/65f1c2a4b3e4d5f6a7b8c9d0`, expect.anything());
  });

  it('appends the secret as a query param for a guest read', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify(order()), { status: 200 }));
    await getOrder({ apiBaseUrl, transport }, '65f1c2a4b3e4d5f6a7b8c9d0', 's3cr3t');
    expect(transport).toHaveBeenCalledWith(
      `${apiBaseUrl}/orders/65f1c2a4b3e4d5f6a7b8c9d0?secret=s3cr3t`,
      expect.anything()
    );
  });
});

describe('waitForOrder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when the order has already left pending_payment', async () => {
    let calls = 0;
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => {
        calls++;
        return new Response(JSON.stringify(order({ status: 'paid' })), { status: 200 });
      },
    };

    const result = await waitForOrder(config, '65f1c2a4b3e4d5f6a7b8c9d0');

    expect(calls).toBe(1);
    expect(result.status).toBe('paid');
  });

  it('keeps polling while pending_payment, then resolves once the webhook lands', async () => {
    let calls = 0;
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => {
        calls++;
        const status = calls >= 2 ? 'paid' : 'pending_payment';
        return new Response(JSON.stringify(order({ status })), { status: 200 });
      },
    };

    const promise = waitForOrder(config, '65f1c2a4b3e4d5f6a7b8c9d0', undefined, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(calls).toBe(2);
    expect(result.status).toBe('paid');
  });

  it('a timeout is not a payment failure: rejects with WaitTimeoutError, order stays pending_payment', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response(JSON.stringify(order({ status: 'pending_payment' })), { status: 200 }),
    };

    const promise = waitForOrder(config, '65f1c2a4b3e4d5f6a7b8c9d0', undefined, {
      timeoutMs: 2000,
      intervalMs: 1000,
    });
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).rejects.toMatchObject({ name: 'WaitTimeoutError' });
  });
});

describe('readOrderRef', () => {
  // The counterpart of RESTHeart's `interpolateOrderRef`: whatever the plugin
  // wrote into the success URL, this has to read back.

  it('reads the fragment — the placement that keeps the secret out of logs', () => {
    const ref = readOrderRef('https://shop.example.com/order#order=abc123&secret=s3cr3t');
    expect(ref).toEqual({ id: 'abc123', secret: 's3cr3t' });
  });

  it('reads the query string too, for deployments that put it there', () => {
    const ref = readOrderRef('https://shop.example.com/order?order=abc123&secret=s3cr3t');
    expect(ref).toEqual({ id: 'abc123', secret: 's3cr3t' });
  });

  it('prefers the fragment when a URL somehow carries both', () => {
    const ref = readOrderRef('https://shop.example.com/o?order=fromQuery#order=fromFragment');
    expect(ref?.id).toBe('fromFragment');
  });

  it('returns the id alone when only {ORDER_ID} was interpolated', () => {
    // Valid for an authenticated buyer: the session identifies them, so the
    // order reads back without a secret.
    expect(readOrderRef('https://shop.example.com/order#order=abc123')).toEqual({ id: 'abc123' });
  });

  it('returns null when the placeholders were never configured', () => {
    // The normal answer on a deployment that predates this — callers keep
    // whatever fallback they had.
    expect(readOrderRef('https://shop.example.com/order?session=cs_test_x')).toBeNull();
  });

  it('decodes percent-encoded values', () => {
    const ref = readOrderRef('https://shop.example.com/order#order=abc&secret=a+b%26c');
    expect(ref?.secret).toBe('a b&c');
  });

  it('returns null rather than throwing on a URL it cannot parse', () => {
    expect(readOrderRef('not a url')).toBeNull();
    expect(readOrderRef('')).toBeNull();
  });
});
