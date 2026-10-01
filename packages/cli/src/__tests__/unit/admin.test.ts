import { describe, it, expect } from 'vitest';
import { createAdminClient } from '../../admin.js';
import { fromEnv, MissingEnvError } from '../../env.js';
import { REDACTED } from '../../types.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A transport that answers from a table and records what it was asked. */
function stub(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const transport = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push({
      url: path,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const key = `${method} ${path}`;
    const found = routes[key];
    if (found === undefined) {
      return new Response(JSON.stringify({ message: 'not stubbed' }), { status: 404 });
    }
    return new Response(JSON.stringify(found), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, transport };
}

const base = 'https://api.ulabase.com';

describe('admin client', () => {
  it('speaks to the endpoints the admin node exposes', async () => {
    const { calls, transport } = stub({
      'GET /plugins': [{ _id: 'stripe' }],
      'POST /plugins-mgmt/ea820b/stripe/install': { success: true },
      'POST /plugins-mgmt/ea820b/stripe/init': { created: 3 },
      'DELETE /plugins-mgmt/ea820b/stripe': { success: true },
    });
    const admin = createAdminClient({ apiBaseUrl: base, transport });

    await admin.pluginCatalog();
    await admin.installPlugin('ea820b', 'stripe');
    await admin.initPlugin('ea820b', 'stripe', 'products');
    await admin.uninstallPlugin('ea820b', 'stripe');

    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'GET /plugins',
      'POST /plugins-mgmt/ea820b/stripe/install',
      'POST /plugins-mgmt/ea820b/stripe/init',
      'DELETE /plugins-mgmt/ea820b/stripe',
    ]);
    // The server builds the initial config itself and ignores a body.
    expect(calls[1]!.body).toBeUndefined();
    expect(calls[2]!.body).toEqual({ mode: 'products' });
  });

  it('reads a plugin schema from `available`, so an uninstalled plugin still has one', async () => {
    const { transport } = stub({
      'GET /plugins-mgmt/ea820b': {
        service_id: 'ea820b',
        installed: [{ plugin_id: 'guards' }],
        available: [
          { _id: 'stripe', config_schema: { properties: { 'secret-key': { format: 'password' } } } },
          { _id: 'guards' },
        ],
      },
    });
    const admin = createAdminClient({ apiBaseUrl: base, transport });

    expect(await admin.isPluginInstalled('ea820b', 'stripe')).toBe(false);
    expect(await admin.isPluginInstalled('ea820b', 'guards')).toBe(true);
    expect(await admin.configSchema('ea820b', 'stripe')).toEqual({
      properties: { 'secret-key': { format: 'password' } },
    });
    expect(await admin.configSchema('ea820b', 'guards')).toBeNull();
  });

  it('writes the redaction placeholder back untouched', async () => {
    // The server replaces the whole config document and restores the stored
    // value for any field still holding the placeholder — so read-modify-write
    // is safe exactly as long as we do not touch it.
    const { calls, transport } = stub({
      'GET /plugins-mgmt/ea820b/stripe/config': {
        'secret-key': REDACTED,
        'success-url': 'https://old.example.com',
        'publishable-key': '',
      },
      'PATCH /plugins-mgmt/ea820b/stripe/config': { success: true },
    });
    const admin = createAdminClient({ apiBaseUrl: base, transport });

    const config = await admin.getPluginConfig('ea820b', 'stripe');
    await admin.updatePluginConfig('ea820b', 'stripe', {
      ...config,
      'success-url': 'https://new.example.com',
    });

    expect(calls[1]!.body).toEqual({
      'secret-key': REDACTED,
      'success-url': 'https://new.example.com',
      // A blank secret is not redacted: "not configured" is information, and
      // turning it into bullets would erase it.
      'publishable-key': '',
    });
  });

  it('resolves a fromEnv marker into the request body and nowhere else', async () => {
    const { calls, transport } = stub({
      'PATCH /plugins-mgmt/ea820b/stripe/config': { success: true },
    });
    const admin = createAdminClient({
      apiBaseUrl: base,
      transport,
      env: { STRIPE_SECRET_KEY: 'sk_test_real' },
    });

    const config = { 'secret-key': fromEnv('STRIPE_SECRET_KEY'), 'success-url': 'https://x.example' };
    await admin.updatePluginConfig('ea820b', 'stripe', config);

    expect(calls[0]!.body).toEqual({ 'secret-key': 'sk_test_real', 'success-url': 'https://x.example' });
    // The setup still holds a marker, not the secret.
    expect(String(config['secret-key'])).toBe('fromEnv(STRIPE_SECRET_KEY)');
  });

  it('fails naming the variable rather than sending undefined', async () => {
    const { calls, transport } = stub({
      'PATCH /plugins-mgmt/ea820b/stripe/config': { success: true },
    });
    const admin = createAdminClient({ apiBaseUrl: base, transport, env: {} });

    await expect(
      admin.updatePluginConfig('ea820b', 'stripe', { 'secret-key': fromEnv('STRIPE_SECRET_KEY') })
    ).rejects.toThrow(MissingEnvError);
    // Nothing went out — the provider never got a chance to reject a bad key.
    expect(calls).toHaveLength(0);
  });

  it('keeps its token out of localStorage and out of other clients', async () => {
    // Two clients in one process, neither of which has a localStorage to fall
    // back to. Each carries its own session; asserted through the header,
    // because the token is deliberately not reachable any other way.
    const seen: Array<string | null> = [];
    const transport = async (_url: string, init?: RequestInit): Promise<Response> => {
      seen.push(new Headers(init?.headers).get('Authorization'));
      return new Response(JSON.stringify([]), { status: 200 });
    };
    const a = createAdminClient({ apiBaseUrl: base, transport });
    a.config.setToken?.('token-a');
    const b = createAdminClient({ apiBaseUrl: base, transport });
    b.config.setToken?.('token-b');

    await a.pluginCatalog();
    await b.pluginCatalog();

    expect(seen).toEqual(['Bearer token-a', 'Bearer token-b']);
  });
});
