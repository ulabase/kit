import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h } from 'vue';
import * as kit from '@ulabase/kit';
import { createRhAuth } from '../create';
import { useAuth } from '../use-auth';

vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null);
});

it('useAuth returns the store provided by createRhAuth', () => {
  const rh = createRhAuth(config);
  let injected: unknown;

  const app = createApp({
    setup() {
      injected = useAuth();
      return () => h('div');
    },
  });
  app.use(rh);
  app.mount(document.createElement('div'));

  expect(injected).toBe(rh.store);
  app.unmount();
});

it('useAuth throws when the plugin is not installed', () => {
  // Called outside any component setup: inject() yields undefined → we throw.
  expect(() => useAuth()).toThrow(/createRhAuth/);
});
