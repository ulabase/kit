import { defineConfig } from 'vitest/config';

// Kept apart from vitest.config.ts on purpose: that one drives the integration
// suite, which needs a live service and the ULABASE_TEST_* secrets the release
// workflow provides. These run anywhere, with nothing configured.
export default defineConfig({
  test: {
    include: ['src/__tests__/unit/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
});
