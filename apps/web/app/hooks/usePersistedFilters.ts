import { useEffect, useCallback } from 'react';
import { useSearchParams } from '@remix-run/react';

/**
 * Filter params worth persisting. Excludes `page` (always reset to 1 on revisit)
 * and transient params like `search` (too volatile to restore).
 */
const PERSISTABLE_PARAMS = new Set([
  'startDate',
  'endDate',
  'period',
  'status',
  'mediaBuyerId',
  'csCloserId',
  'productId',
  'campaignId',
  'fromLocationId',
  'toLocationId',
  'locationId',
  'branchId',
  'perPage',
  'fromCart',
  'testOrders',
]);

const STORAGE_PREFIX = 'yannis:filters:';

/**
 * Persist URL filter params to localStorage so the user's last-used filters
 * are restored when they revisit the page without explicit URL params.
 *
 * Usage: call once at the top of a page component.
 *
 * ```ts
 * usePersistedFilters('marketing-orders');
 * ```
 *
 * Behaviour:
 * - On mount with NO filter params in the URL → reads localStorage and
 *   replaces the URL with saved filters (if any).
 * - On every filter change → writes the current persistable params to localStorage.
 * - `page` is never persisted (always starts at 1).
 * - `search` is never persisted (too transient).
 * - Clearing all filters also clears localStorage for the page.
 */
export function usePersistedFilters(
  pageKey: string,
  opts?: { exclude?: string[] },
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const excludeSet = opts?.exclude ? new Set(opts.exclude) : null;

  // On mount: restore filters from localStorage when URL has no filter params.
  useEffect(() => {
    // Only restore if the URL is "bare" (no persistable params set).
    const hasAnyFilter = [...searchParams.keys()].some((k) => PERSISTABLE_PARAMS.has(k));
    if (hasAnyFilter) return;

    const stored = localStorage.getItem(STORAGE_PREFIX + pageKey);
    if (!stored) return;

    try {
      const saved = JSON.parse(stored) as Record<string, string>;
      if (!saved || typeof saved !== 'object' || Object.keys(saved).length === 0) return;

      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(saved)) {
          if (PERSISTABLE_PARAMS.has(key) && value && !excludeSet?.has(key)) {
            next.set(key, value);
          }
        }
        // Never restore page — always start at 1.
        next.delete('page');
        return next;
      }, { replace: true });
    } catch {
      // Corrupt localStorage — ignore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]); // Only run on mount (pageKey is stable).

  // On filter change: save current filters to localStorage.
  useEffect(() => {
    const toSave: Record<string, string> = {};
    for (const key of PERSISTABLE_PARAMS) {
      if (excludeSet?.has(key)) continue;
      const value = searchParams.get(key);
      if (value) toSave[key] = value;
    }

    if (Object.keys(toSave).length === 0) {
      localStorage.removeItem(STORAGE_PREFIX + pageKey);
    } else {
      localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(toSave));
    }
  }, [searchParams, pageKey]);
}
