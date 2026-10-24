import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // src/core is pure TS; its tests run without a DOM.
    environment: 'node',
    environmentMatchGlobs: [['tests/core/**', 'node']],
  },
});
