import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 60000,
    setupFiles: ['test/setup.ts'],
  },
});
