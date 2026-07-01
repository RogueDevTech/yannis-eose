import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
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

// ── Context ───────────────────────────────────────────────────────────────────

/**
 * All saved filter preferences for the session, keyed by pageKey.
 * Populated once in the root loader and shared across every page
 * so no per-page fetch is needed.
 */
export type AllFilterPrefs = Record<string, Record<string, string>>;

interface FilterPrefsContextValue {
  /** Full prefs map — pageKey → { filterKey: filterValue }. */
  prefs: AllFilterPrefs;
  /** Replace or merge a single page's prefs into the map. */
  setPagePrefs: (pageKey: string, filters: Record<string, string> | null) => void;
}

const FilterPrefsContext = createContext<FilterPrefsContextValue>({
  prefs: {},
  setPagePrefs: () => {},
});

export { FilterPrefsContext };

/**
 * Resolves an internal href by appending saved filter params for the target page.
 * Returns the original href if no saved prefs exist.
 */
export function resolveFilterHref(href: string, prefs: AllFilterPrefs): string {
  // Only process internal /admin paths
  if (!href.startsWith('/admin')) return href;
  // Don't touch hrefs that already have query params (explicit filters)
  if (href.includes('?')) return href;
  const pageKey = href.replace(/^\//, '').replace(/\//g, '.');
  const saved = prefs[pageKey];
  if (!saved || Object.keys(saved).length === 0) return href;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(saved)) {
    if (v) sp.set(k, v);
  }
  return `${href}?${sp.toString()}`;
}

/**
 * Hook that returns a resolver function for appending saved filter params to hrefs.
 * Use in components that render navigation links.
 */
export function useResolveFilterHref() {
  const { prefs } = useContext(FilterPrefsContext);
  return useCallback((href: string) => resolveFilterHref(href, prefs), [prefs]);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Server-backed filter preferences. Reads saved defaults from the root-level
 * context (populated once on app load) and applies them when the URL has no
 * filter params. URL always wins.
 *
 * **Fail-safe**: never breaks the page. If the context is empty the hook
 * behaves as if no prefs are saved.
 *
 * @param pageKey Dot-separated page identifier, e.g. 'admin.marketing.orders'
 */
export function useFilterPreferences(pageKey: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { prefs, setPagePrefs } = useContext(FilterPrefsContext);

  const appliedRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);

  // Derive from context — no network fetch needed.
  const contextEntry = pageKey !== '__noop__' ? (prefs[pageKey] ?? null) : null;
  const [hasSavedPrefs, setHasSavedPrefs] = useState(() => {
    return contextEntry != null && Object.keys(contextEntry).length > 0;
  });
  const savedFiltersRef = useRef<Record<string, string> | null>(contextEntry);

  // Keep local state in sync when the context entry changes (e.g. after the
  // root prefs map is first populated on hydration).
  useEffect(() => {
    if (pageKey === '__noop__') return;
    const entry = prefs[pageKey] ?? null;
    const hasEntry = entry != null && Object.keys(entry).length > 0;
    setHasSavedPrefs(hasEntry);
    savedFiltersRef.current = hasEntry ? entry : null;
  }, [pageKey, prefs]);

  // ── Apply saved prefs on mount (once) ─────────────────────────────
  useEffect(() => {
    if (appliedRef.current) return;
    if (pageKey === '__noop__') { appliedRef.current = true; return; }

    const entry = prefs[pageKey];
    appliedRef.current = true;

    if (!entry || Object.keys(entry).length === 0) {
      migrateLocalStorage();
      return;
    }

    // If the URL already has the saved params (sidebar pre-applied), skip.
    // If the URL has *different* explicit filter params (user navigated with
    // a specific URL), respect their choice — don't override.
    const urlHasExplicitFilters = [...searchParams.keys()].some((k) => PERSISTABLE_PARAMS.has(k));
    if (urlHasExplicitFilters) return;

    // No filter params in URL — apply saved filters (replaces loader defaults).
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of PERSISTABLE_PARAMS) {
        next.delete(key);
      }
      for (const [key, value] of Object.entries(entry)) {
        if (PERSISTABLE_PARAMS.has(key) && value) {
          next.set(key, value);
        }
      }
      next.delete('page');
      return next;
    }, { replace: true });

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
    // Normalize: period=all_time makes startDate/endDate redundant
    if (filters.period === 'all_time') {
      delete filters.startDate;
      delete filters.endDate;
    }
    if (Object.keys(filters).length === 0) return;

    setIsSaving(true);
    fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'upsert', pageKey, filters }),
    })
      .then(() => {
        setHasSavedPrefs(true);
        savedFiltersRef.current = filters;
        setPagePrefs(pageKey, filters);
      })
      .catch(() => {}) // fail silently
      .finally(() => setIsSaving(false));
  }, [searchParams, pageKey, setPagePrefs]);

  // ── Clear saved defaults ──────────────────────────────────────────
  const clearSavedFilters = useCallback(() => {
    setIsSaving(true);
    fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'delete', pageKey }),
    })
      .then(() => {
        setHasSavedPrefs(false);
        savedFiltersRef.current = null;
        setPagePrefs(pageKey, null);
      })
      .catch(() => {}) // fail silently
      .finally(() => setIsSaving(false));
    localStorage.removeItem(LS_PREFIX + pageKey);
  }, [pageKey, setPagePrefs]);

  // Check if current URL filters differ from saved
  const hasChanges = (() => {
    if (!hasSavedPrefs || !savedFiltersRef.current) return false;
    const saved = savedFiltersRef.current;
    const current: Record<string, string> = {};
    for (const key of PERSISTABLE_PARAMS) {
      const value = searchParams.get(key);
      if (value) current[key] = value;
    }
    const savedKeys = Object.keys(saved);
    const currentKeys = Object.keys(current);
    if (savedKeys.length !== currentKeys.length) return true;
    for (const k of savedKeys) {
      if (saved[k] !== current[k]) return true;
    }
    return false;
  })();

  return {
    /** True while a save/delete mutation is in flight. */
    isSaving,
    /** Whether the server has saved preferences for this page. */
    hasSavedPrefs,
    /** Whether the current URL filters differ from the saved defaults. */
    hasChanges,
    /** The saved filter key-value pairs (null if none). */
    savedFilters: savedFiltersRef.current,
    /** Save the current URL filter params as defaults. */
    saveCurrentFilters,
    /** Clear saved preferences for this page. */
    clearSavedFilters,
  };
}
