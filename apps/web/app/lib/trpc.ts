import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@yannis/api/trpc';

/**
 * Vanilla tRPC client — used in Remix loaders/actions (server-side).
 * For client-side React components, use the React Query wrapper.
 */
export function createServerTrpcClient(request: Request) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${process.env.API_URL ?? 'http://localhost:4444'}/trpc`,
        headers: () => {
          // Forward the cookie from the incoming request to the API
          const cookie = request.headers.get('cookie');
          return cookie ? { cookie } : {};
        },
      }),
    ],
  });
}

/**
 * Browser-side tRPC client — used in React components.
 */
export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/api/trpc',
      fetch: (url, options) =>
        fetch(url, { ...options, credentials: 'include' }),
    }),
  ],
});
