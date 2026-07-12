import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

declare module '@remix-run/node' {
  interface Future {
    v3_singleFetch: true;
  }
}

// Dev proxy target for /trpc and /socket.io. Honors API_URL so the whole stack
// (SSR loaders + browser proxy) can be pointed at a non-default API port with a
// single env var, e.g. when another checkout already occupies 4444.
const DEV_API_TARGET = process.env['API_URL']?.trim() || 'http://127.0.0.1:4444';

export default defineConfig({
  ssr: {
    noExternal: ['@remix-run/react'],
  },
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_singleFetch: true,
        v3_lazyRouteDiscovery: true,
      },
    }),
    tsconfigPaths(),
  ],
  server: {
    port: 4003,
    strictPort: false,
    allowedHosts: ['.trycloudflare.com'],
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 4003,
    },
    proxy: {
      // Remix loaders run in Node and call API_URL; default in dev is this dev server so cookies + host line up.
      // Forward /trpc to Nest so permissions.listCatalog and other procedures work without a manual API_URL.
      '/trpc': {
        target: DEV_API_TARGET,
        changeOrigin: true,
      },
      // Do NOT proxy `/auth` — browser navigations to `/auth` must hit Remix. SSR posts to `/auth/*`
      // use api.server `resolveServerApiBase` (direct :4444 in dev).
      '/socket.io': {
        target: DEV_API_TARGET,
        ws: true,
        changeOrigin: true,
      },
      '/api/ai-chat': {
        target: DEV_API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
