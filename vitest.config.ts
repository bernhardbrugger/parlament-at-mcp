import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // live tests hit the real Parliament API: run them on purpose with `npm run test:integration`
    exclude: ['tests/integration/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/http-cli.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
