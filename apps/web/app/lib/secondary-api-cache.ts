import { json } from '@remix-run/node';

const CACHE_CONTROL = 'private, max-age=10';

/**
 * Short-lived HTTP cache for Remix `api.*` JSON loaders.
 * Browsers may reuse the response for duplicate GETs within ~10s (scoped by `private` + cookie).
 * Do not use for presigned URLs, POST actions, or responses that must always be fresh (e.g. onboarding nudge).
 */
export function secondaryCacheJson<T>(data: T, init?: number | ResponseInit) {
  const base = typeof init === 'number' ? { status: init } : { ...(init ?? {}) };
  const headers = new Headers(base.headers ?? undefined);
  headers.set('Cache-Control', CACHE_CONTROL);
  headers.set('Vary', 'Cookie');
  return json(data, { ...base, headers });
}
