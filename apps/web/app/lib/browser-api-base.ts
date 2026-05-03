function isLoopbackHost(hostname: string): boolean {
  // URL.hostname for IPv6 literals is usually `::1`, not `[::1]`.
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

/**
 * Base URL for browser → Nest (tRPC, REST, Socket.io).
 *
 * In local dev, Remix/Vite is often on :4003 with `/trpc` and `/socket.io` proxied to Nest on :4444.
 * `window.__ENV.API_URL` may still be `http://localhost:4444` for SSR; the browser should use
 * same-origin so traffic goes through the dev proxy and cookies stay aligned.
 *
 * When `PUBLIC_API_URL` points at a real host (e.g. api.example.com), use it from the browser too.
 *
 * If `.env` still has `http://localhost:4444` but you open the app as `http://192.168.x.x:4003` or a
 * tunnel host, calling `:4444` on localhost fails — same-origin + Vite `/trpc` proxy is correct.
 */
export function getBrowserApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  const raw = window.__ENV?.API_URL?.trim() ?? '';

  let resolved: string;
  if (!raw) {
    resolved = origin;
  } else {
    try {
      const api = new URL(raw);
      const page = new URL(origin);
      const apiLoopback = isLoopbackHost(api.hostname);
      const pageLoopback = isLoopbackHost(page.hostname);

      const loopbackMismatchPorts =
        apiLoopback && pageLoopback && api.origin !== page.origin;
      const apiLoopbackButPageIsNot =
        apiLoopback && !pageLoopback;

      if (loopbackMismatchPorts || apiLoopbackButPageIsNot) {
        resolved = origin;
      } else if (window.location.protocol === 'https:' && raw.startsWith('http://')) {
        resolved = raw.replace(/^http:\/\//, 'https://');
      } else {
        resolved = raw;
      }
    } catch {
      resolved = origin;
    }
  }

  return resolved.replace(/\/+$/, '');
}
