import { defineConfig } from 'vitest/config';

// Live canary against the real Parliament API (about 15 requests, one per second).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
