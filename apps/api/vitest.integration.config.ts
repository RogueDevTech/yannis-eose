import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load apps/api/.env so TEST_DATABASE_URL is available without manual env export
config({ path: resolve(__dirname, '.env') });

export default defineConfig({
  test: {
    name: 'integration',
    include: ['src/**/*.integration.spec.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Integration tests must not run in parallel — they share a real DB
    pool: 'forks',
    maxConcurrency: 1,
  },
  resolve: {
    alias: {
      '@yannis/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
