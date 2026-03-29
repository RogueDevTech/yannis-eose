import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

declare module '@remix-run/node' {
  interface Future {
    v3_singleFetch: true;
  }
}

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
    port: 4000,
    strictPort: false,
    allowedHosts: ['.trycloudflare.com'],
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 4000,
    },
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:4444',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
