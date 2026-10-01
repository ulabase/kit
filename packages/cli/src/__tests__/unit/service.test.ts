import { describe, it, expect, vi } from 'vitest';
import { createServiceClient } from '../../service.js';
import { fromEnv, MissingEnvError } from '../../env.js';
import type { AdminClient } from '../../admin.js';

/** A JWT whose payload says when it expires. Only `exp` is ever read. */
function jwt(expiresInMs: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor((Date.now() + expiresInMs) / 1000) })
  ).toString('base64url');
  return `header.${payload}.signature`;
}

interface Call {
  path: string;
  method: string;
  auth: string | null;
  body: unknown;
}

function harness(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const transport = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    // Query string included, deliberately. It used to be `pathname` alone,
    // which made the harness blind to `?wm=upsert` — the difference between
    // creating a document and getting a 404 — and let a test assert the wrong
    // URLs while passing.
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    calls.push({
      path,
      method,
      auth: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const route = routes[`${method} ${path}`] ?? { status: 404, body: { message: 'not found' } };
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
    });
  };

  const serviceToken = vi.fn(async () => ({
    token: jwt(15 * 60_000),
    url: 'https://c0ffee.ulabase.app',
    node: 'c0ffee.ulabase.app',
  }));

  const admin = { config: { apiBaseUrl: 'https://api.ulabase.com', transport }, serviceToken } as unknown as AdminClient;
  return { calls, admin, serviceToken };
}

describe('service client', () => {
  it('mints a token once and reuses it', async () => {
    const { admin, serviceToken, calls } = harness({
      'GET /catalog': { status: 200, body: { _id: 'catalog' } },
      'GET /orders': { status: 200, body: { _id: 'orders' } },
    });
    const service = createServiceClient(admin, 'ea820b');

    await service.collectionExists('catalog');
    await service.collectionExists('orders');

    expect(serviceToken).toHaveBeenCalledTimes(1);
    expect(calls.every(c => c.auth?.startsWith('Bearer '))).toBe(true);
  });

  it('renews a token that is about to expire, without the caller knowing', async () => {
    // Fifteen minutes is the admin node's TTL, and a run that installs a plugin
    // and waits for its init can outlive it. A token inside the renewal margin
    // is spent.
    const { admin, serviceToken } = harness({ 'GET /catalog': { status: 200, body: {} } });
    serviceToken.mockImplementation(async () => ({
      token: jwt(30_000),
      url: 'https://c0ffee.ulabase.app',
      node: 'c0ffee.ulabase.app',
    }));
    const service = createServiceClient(admin, 'ea820b');

    await service.collectionExists('catalog');
    await service.collectionExists('catalog');

    expect(serviceToken).toHaveBeenCalledTimes(2);
  });

  it('shares one mint between calls that start together', async () => {
    const { admin, serviceToken } = harness({ 'GET /catalog': { status: 200, body: {} } });
    const service = createServiceClient(admin, 'ea820b');

    await Promise.all([
      service.collectionExists('catalog'),
      service.collectionExists('catalog'),
      service.collectionExists('catalog'),
    ]);

    expect(serviceToken).toHaveBeenCalledTimes(1);
  });

  it('answers a check with false on 404 and throws on anything else', async () => {
    const { admin } = harness({
      'GET /catalog': { status: 200, body: {} },
      'GET /secret': { status: 403, body: { message: 'forbidden' } },
    });
    const service = createServiceClient(admin, 'ea820b');

    expect(await service.collectionExists('catalog')).toBe(true);
    expect(await service.collectionExists('missing')).toBe(false);
    // A 403 means the token cannot see it, which is not the same as it not
    // being there — swallowing it would report "missing", apply, and fail again.
    await expect(service.collectionExists('secret')).rejects.toMatchObject({ status: 403 });
  });

  it('finds an index in the collection listing', async () => {
    const { admin } = harness({
      'GET /catalog/_indexes': {
        status: 200,
        body: [{ _id: '_id_' }, { _id: 'sku_unique' }],
      },
    });
    const service = createServiceClient(admin, 'ea820b');

    expect(await service.indexExists('catalog', 'sku_unique')).toBe(true);
    expect(await service.indexExists('catalog', 'name_text')).toBe(false);
    // No collection, no index.
    expect(await service.indexExists('orders', 'anything')).toBe(false);
  });

  it('writes through the paths RESTHeart expects', async () => {
    // Documents carry ?wm=upsert; collections and indexes do not.
    //
    // RESTHeart's default write mode is `update`, and updating a document that
    // is not there answers 404 rather than creating it — so without upsert
    // every permission, user and schema step failed on exactly the service a
    // setup exists to configure: one where they are not there yet. Verified
    // against a live node, not inferred.
    //
    // Collections and indexes create on their own, so adding it there too would
    // be cargo cult.
    const { admin, calls } = harness({
      'PUT /catalog': { status: 201 },
      'PUT /catalog/_indexes/sku_unique': { status: 201 },
      'PUT /acl/catalog-read-anon?wm=upsert': { status: 201 },
      'PUT /users/robot?wm=upsert': { status: 201 },
      'PUT /schemas/orders?wm=upsert': { status: 201 },
    });
    const service = createServiceClient(admin, 'ea820b');

    await service.createCollection('catalog', { description: 'products' });
    await service.createIndex('catalog', 'sku_unique', { sku: 1 }, { unique: true });
    await service.putPermission('catalog-read-anon', { roles: ['$unauthenticated'] });
    await service.createUser('robot', { roles: ['worker'] });
    await service.putSchema('orders', { type: 'object' });

    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'PUT /catalog',
      'PUT /catalog/_indexes/sku_unique',
      'PUT /acl/catalog-read-anon?wm=upsert',
      'PUT /users/robot?wm=upsert',
      'PUT /schemas/orders?wm=upsert',
    ]);
    expect(calls[1]!.body).toEqual({ keys: { sku: 1 }, ops: { unique: true } });
  });

  it('re-running a document write is not an error', async () => {
    // The property upsert buys, and the one a setup depends on: a step whose
    // check is wrong, or a setup run twice, must not fail the second time.
    const { admin, calls } = harness({
      'PUT /acl/catalog-read-anon?wm=upsert': { status: 200 },
    });
    const service = createServiceClient(admin, 'ea820b');

    await service.putPermission('catalog-read-anon', { roles: ['$unauthenticated'] });
    await service.putPermission('catalog-read-anon', { roles: ['$unauthenticated'] });

    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(2);
  });

  it('resolves fromEnv on the way out, like the admin client does', async () => {
    // The admin client is not the only place a setup can want a secret — a user
    // document has a password. A marker that got here unresolved would be
    // written as an object, and only its `toJSON` guard would say so.
    const { admin, calls } = harness({ 'PUT /users/robot?wm=upsert': { status: 201 } });
    (admin as unknown as { env: Record<string, string> }).env = { ROBOT_PASSWORD: 'hunter2' };
    const service = createServiceClient(admin, 'ea820b');

    await service.createUser('robot', { roles: ['worker'], password: fromEnv('ROBOT_PASSWORD') });

    expect(calls[0]!.body).toEqual({ roles: ['worker'], password: 'hunter2' });
  });

  it('fails naming the variable rather than writing an object', async () => {
    const { admin, calls } = harness({ 'PUT /users/robot?wm=upsert': { status: 201 } });
    (admin as unknown as { env: Record<string, string> }).env = {};
    const service = createServiceClient(admin, 'ea820b');

    await expect(
      service.createUser('robot', { password: fromEnv('ROBOT_PASSWORD') })
    ).rejects.toThrow(MissingEnvError);
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });
});
