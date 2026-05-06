import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // tsconfigPaths returns a vite v6 Plugin; vitest v2 still types its plugin slot
  // against vite v5. The two are runtime-compatible — cast to keep the typecheck happy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [tsconfigPaths() as any],
  test: {
    include: ['app/**/*.spec.ts'],
    environment: 'node',
  },
});
