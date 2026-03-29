import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: 'unit',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.integration.spec.ts'],
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@yannis/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
