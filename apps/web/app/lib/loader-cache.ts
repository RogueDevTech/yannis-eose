/**
 * Client-side loader-data cache for "instant revisit" navigation.
 *
 * When the user opens page A → leaves to page B → comes back to A, render A's
 * last-seen data immediately (cache hit) and trigger background revalidation
 * to refresh stale data. Same UX pattern LinkedIn / Twitter / Facebook use.
 *
 * Storage: in-memory Map keyed by `pathname + search`. Cleared on hard reload
 * (browser drops module memory) and on logout (`clearLoaderCache()` is called
 * from the logout action). LRU-evicted at `MAX` entries; TTL'd at `TTL_MS`.
 *
 * Stale-while-revalidate contract:
 *  - Cache hit + within TTL → render cached data instantly, kick off
 *    `useRevalidator().revalidate()` so fresh data replaces it within ~300ms.
 *  - Cache miss or expired → fall through to standard loader behavior.
 *
 * Mutation invalidation: same-page mutations naturally update the cache via
 * Remix's automatic post-action revalidation (we re-snapshot on every settled
 * render). Cross-page mutations (mutate on B, revisit A) show stale data
 * briefly until the always-revalidate-on-revisit completes.
 *
 * Do NOT use for pages with sensitive PII or financial reads where momentary
 * stale data could mislead a decision — those should keep using `useLoaderData`
 * directly.
 */

interface CacheEntry {
  data: unknown;
  ts: number;
}

/** 5 minutes. Pages older than this fall back to a fresh loader run. */
const TTL_MS = 5 * 60 * 1000;
/** LRU bound. Roughly 30 distinct route+filter combinations, plenty for one session. */
const MAX_ENTRIES = 30;

const cache = new Map<string, CacheEntry>();

/** Read a fresh entry. Returns null if missing or expired. */
export function getCachedLoaderEntry(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts >= TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

/**
 * Snapshot loader data into the cache. Re-running with the same key + same
 * data is a no-op (saves an LRU shuffle on every settled render).
 */
export function setCachedLoaderEntry(key: string, data: unknown): void {
  // Don't cache nullish / non-object data — usually means the loader hasn't
  // resolved yet or the route returned an error placeholder.
  if (data == null) return;

  const existing = cache.get(key);
  if (existing && existing.data === data) {
    // Same reference → just bump the timestamp.
    existing.ts = Date.now();
    return;
  }

  cache.set(key, { data, ts: Date.now() });

  if (cache.size > MAX_ENTRIES) {
    // LRU evict — drop the oldest by timestamp. O(n) but n ≤ 31, negligible.
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of cache) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey != null) cache.delete(oldestKey);
  }
}

/**
 * Wipe the entire cache. Called from the logout action so a different user
 * signing into the same browser tab cannot read the previous user's cached
 * loader payloads.
 */
export function clearLoaderCache(): void {
  cache.clear();
}

/**
 * Drop one URL's cache entry. Useful for explicit cache busting after a
 * mutation that affects another page (e.g. creating an order from page A
 * could call `invalidateCachedLoader('/admin/cs/orders')` to ensure the next
 * revisit shows the new row immediately rather than waiting for the
 * background revalidate to land).
 */
export function invalidateCachedLoader(pathname: string): void {
  // Match by prefix so `/admin/cs/orders?status=PENDING` etc. all drop.
  for (const k of [...cache.keys()]) {
    if (k === pathname || k.startsWith(`${pathname}?`)) {
      cache.delete(k);
    }
  }
}
