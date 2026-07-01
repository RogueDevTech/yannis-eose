import { useEffect, useRef, useCallback, useState } from 'react';
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
  'sortBy',
  'sortOrder',
  'sortDir',
]);

const LS_PREFIX = 'yannis:filters:';
const API_PATH = '/api/filter-preferences';

/**
 * Server-backed filter preferences. Fetches saved defaults on mount and
 * applies them when the URL has no filter params. URL always wins.
 *
 * **Fail-safe**: never breaks the page. All errors are caught and swallowed —
 * the page falls back to its system default filters.
 *
 * @param pageKey Dot-separated page identifier, e.g. 'admin.marketing.orders'
 */
export function useFilterPreferences(pageKey: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedRef = useRef(false);
  const fetchedRef = useRef(false);
  const [hasSavedPrefs, setHasSavedPrefs] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // ── Fetch saved preferences on mount ──────────────────────────────
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    // Already has URL filter params — URL wins, skip fetch entirely.
    const hasAnyFilter = [...searchParams.keys()].some((k) => PERSISTABLE_PARAMS.has(k));
    if (hasAnyFilter) {
      appliedRef.current = true;
      return;
    }

    fetch(`${API_PATH}?pageKey=${encodeURIComponent(pageKey)}`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((saved: Record<string, string> | null) => {
        appliedRef.current = true;
        if (!saved || typeof saved !== 'object' || Object.keys(saved).length === 0) {
          migrateLocalStorage();
          return;
        }

        setHasSavedPrefs(true);

        // Apply saved filters to URL.
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(saved)) {
            if (PERSISTABLE_PARAMS.has(key) && value) {
              next.set(key, value);
            }
          }
          next.delete('page');
          return next;
        }, { replace: true });
      })
      .catch(() => {
        // Fail silently — page uses system defaults.
        appliedRef.current = true;
      });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  // ── One-time localStorage → server migration ─────────────────────
  function migrateLocalStorage() {
    try {
      const stored = localStorage.getItem(LS_PREFIX + pageKey);
      if (!stored) return;

      const parsed = JSON.parse(stored) as Record<string, string>;
      if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) return;

      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (PERSISTABLE_PARAMS.has(k) && v) filtered[k] = v;
      }
      if (Object.keys(filtered).length > 0) {
        fetch(API_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'upsert', pageKey, filters: filtered }),
        }).catch(() => {}); // fire-and-forget
      }
      localStorage.removeItem(LS_PREFIX + pageKey);
    } catch {
      // Corrupt localStorage — ignore.
    }
  }

  // ── Save current URL filters as defaults ──────────────────────────
  const saveCurrentFilters = useCallback(() => {
    const filters: Record<string, string> = {};
    for (const key of PERSISTABLE_PARAMS) {
      const value = searchParams.get(key);
      if (value) filters[key] = value;
    }
    if (Object.keys(filters).length === 0) return;

    setIsSaving(true);
    fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'upsert', pageKey, filters }),
    })
      .then(() => setHasSavedPrefs(true))
      .catch(() => {}) // fail silently
      .finally(() => setIsSaving(false));
  }, [searchParams, pageKey]);

  // ── Clear saved defaults ──────────────────────────────────────────
  const clearSavedFilters = useCallback(() => {
    setIsSaving(true);
    fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'delete', pageKey }),
    })
      .then(() => setHasSavedPrefs(false))
      .catch(() => {}) // fail silently
      .finally(() => setIsSaving(false));
    localStorage.removeItem(LS_PREFIX + pageKey);
  }, [pageKey]);

  return {
    /** True while a save/delete mutation is in flight. */
    isSaving,
    /** Whether the server has saved preferences for this page. */
    hasSavedPrefs,
    /** Save the current URL filter params as defaults. */
    saveCurrentFilters,
    /** Clear saved preferences for this page. */
    clearSavedFilters,
  };
}
