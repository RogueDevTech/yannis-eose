import { useEffect, useRef } from 'react';
import { useLocation, useNavigation, useSearchParams } from '@remix-run/react';
import {
  listFilterStorageKey,
  mergeSearchParamsFromStorage,
  parseStoredFilters,
  pickAllowlisted,
} from '~/lib/list-filter-persistence';

export interface UsePersistListFiltersOptions {
  /** Stable logical surface id (not full pathname). */
  scope: string;
  userId: string | undefined;
  /** URL query keys to round-trip; never include `page`. Omit free-text `search` on order lists per security guidance. */
  allowlist: readonly string[];
}

/**
 * Persists allowlisted search params to localStorage and restores them when the user
 * lands on the same surface with a bare URL (e.g. sidebar link). URL always wins for
 * keys already present (deep links).
 */
export function usePersistListFilters({ scope, userId, allowlist }: UsePersistListFiltersOptions): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const lastLocationKeyRef = useRef<string | null>(null);
  const restoreCompletedForKeyRef = useRef(false);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New history entry → allow one restore pass (sidebar bare link vs in-place filter change).
  useEffect(() => {
    if (lastLocationKeyRef.current !== location.key) {
      lastLocationKeyRef.current = location.key;
      restoreCompletedForKeyRef.current = false;
    }
  }, [location.key]);

  // Restore from localStorage once per pathname visit after navigation is idle.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (navigation.state !== 'idle' || !userId) return;
    if (restoreCompletedForKeyRef.current) return;

    const storageKey = listFilterStorageKey(userId, scope);
    const stored = parseStoredFilters(window.localStorage.getItem(storageKey));
    const { next, addedKeys } = mergeSearchParamsFromStorage(location.search, stored, allowlist);

    restoreCompletedForKeyRef.current = true;

    if (addedKeys.length === 0) return;

    setSearchParams(next, { replace: true });
  }, [
    allowlist,
    location.search,
    location.key,
    navigation.state,
    scope,
    userId,
    setSearchParams,
  ]);

  // Persist allowlisted keys whenever URL settles (debounced).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (navigation.state !== 'idle' || !userId) return;

    const storageKey = listFilterStorageKey(userId, scope);
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);

    writeTimerRef.current = setTimeout(() => {
      writeTimerRef.current = null;
      const snapshot = pickAllowlisted(searchParams, allowlist);
      try {
        if (Object.keys(snapshot).length === 0) {
          window.localStorage.removeItem(storageKey);
        } else {
          window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
        }
      } catch {
        // Quota / private mode — ignore
      }
    }, 250);

    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, [allowlist, navigation.state, scope, searchParams, userId]);
}
