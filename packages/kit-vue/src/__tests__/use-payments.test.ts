import { beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, type Plugin } from 'vue';
import * as kit from '@ulabase/kit';
import { createRhAuth } from '../create';
import { createRhPayments } from '../create-payments';
import { usePayments } from '../use-payments';

vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com', payments: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null);
});

/** Mount a throwaway component that reads `usePayments()`, return what it got. */
function mountWith(plugins: Plugin[]): unknown {
  let injected: unknown;
  const app = createApp({
    setup() {
      injected = usePayments();
      return () => h('div');
    },
  });
  plugins.forEach(p => app.use(p));
  app.mount(document.createElement('div'));
  app.unmount();
  return injected;
}

it('usePayments returns the store provided by createRhPayments', () => {
  const rhAuth = createRhAuth(config);
  const rhPayments = createRhPayments(config, rhAuth);

  expect(mountWith([rhAuth, rhPayments])).toBe(rhPayments.store);
});

it('createRhPayments accepts the bare auth store as well as the plugin', () => {
  const rhAuth = createRhAuth(config);
  const rhPayments = createRhPayments(config, rhAuth.store);

  expect(mountWith([rhAuth, rhPayments])).toBe(rhPayments.store);
});

it('usePayments throws when the plugin is not installed', () => {
  // Called outside any component setup: inject() yields undefined → we throw.
  expect(() => usePayments()).toThrow(/createRhPayments/);
});
