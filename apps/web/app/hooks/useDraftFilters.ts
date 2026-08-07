import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from '@remix-run/react';

/**
 * Draft-until-Apply filter state.
 *
 * Filters historically wrote to the URL on every `onChange` (each keystroke or
 * dropdown pick fired `setSearchParams`, triggering a loader fetch). This hook
 * lets a page hold pending filter selections in local state and commit them all
 * at once — one navigation, one fetch — when the user presses **Apply**.
 *
 * Mirrors the proven `SortMenu` pattern: seed a `draft` from the committed URL,
 * mutate the draft freely, then `apply()` writes the whole draft to the URL.
 *
 * ## Usage
 * ```tsx
 * const df = useDraftFilters();
 * // in a filter control:
 * <SearchableSelect value={df.get('mediaBuyerId') ?? 'ALL'} onChange={(v) => df.set('mediaBuyerId', v === 'ALL' ? null : v)} />
 * // in the sheet footer / Apply button:
 * <Button disabled={!df.dirty} onClick={df.apply}>Apply</Button>
 * ```
 *
 * The `draft` only reflects the keys the page manages (passed via `keys`), so
 * unrelated params (search text, tab, per-page) survive an Apply untouched.
 *
 * @param keys The filter param names this page owns. Only these are diffed for
 *   `dirty` and rewritten on `apply()`. Params outside this set pass through.
 */
export interface UseDraftFiltersOptions {
  /**
   * When Apply commits, also reset `page` to '1' (list pagination). Default true
   * — changing a filter should send the user back to page 1.
   */
  resetPageOnApply?: boolean;
  /**
   * Called right before the URL is committed on Apply — use to prime a
   * same-path skeleton refetch (e.g. `primeSamePathRefetch()`), matching how the
   * page's existing `setSearchParams` wrapper behaves.
   */
  beforeApply?: () => void;
}

export interface DraftFilters {
  /** Current pending value for a key (falls back to the committed URL value). */
  get: (key: string) => string | null;
  /** Stage a value in the draft. Pass null/'' to clear the key. Does NOT navigate. */
  set: (key: string, value: string | null) => void;
  /** Stage several keys at once (e.g. a date range). Does NOT navigate. */
  setMany: (patch: Record<string, string | null>) => void;
  /** Whether the draft differs from the committed URL for any owned key. */
  dirty: boolean;
  /** Commit the whole draft to the URL in a single navigation. */
  apply: () => void;
  /** Discard staged changes and re-seed the draft from the committed URL. */
  reset: () => void;
  /** Re-seed the draft from the current URL — call when the sheet opens. */
  reseed: () => void;
  /** The committed value straight from the URL (ignores the draft). */
  committed: (key: string) => string | null;
}

/** Build a plain record of the owned keys' current URL values. */
function snapshot(params: URLSearchParams, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const v = params.get(key);
    if (v != null && v !== '') out[key] = v;
  }
  return out;
}

export function useDraftFilters(
  keys: readonly string[],
  options: UseDraftFiltersOptions = {},
): DraftFilters {
  const { resetPageOnApply = true, beforeApply } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  // Freeze the key set for stable identity across renders.
  const keySet = useMemo(() => Array.from(new Set(keys)), [keys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The committed snapshot from the URL — recomputed each render so an external
  // navigation (sidebar link, Clear filters, saved prefs) re-seeds the baseline.
  const committedSnapshot = useMemo(
    () => snapshot(searchParams, keySet),
    [searchParams, keySet],
  );

  // Draft overlay: only keys the user has touched since the last seed/apply live
  // here. `null` means "explicitly cleared". Absent means "use committed value".
  const [draft, setDraft] = useState<Record<string, string | null>>({});

  // When the committed URL changes out from under us (external nav), a stale
  // draft would look dirty forever. Track the baseline we seeded against and
  // clear the draft when the baseline moves.
  const seededBaselineRef = useRef<string>(JSON.stringify(committedSnapshot));
  const currentBaseline = JSON.stringify(committedSnapshot);
  if (seededBaselineRef.current !== currentBaseline && Object.keys(draft).length === 0) {
    seededBaselineRef.current = currentBaseline;
  }

  const get = useCallback(
    (key: string): string | null => {
      if (key in draft) return draft[key] ?? null;
      return committedSnapshot[key] ?? null;
    },
    [draft, committedSnapshot],
  );

  const committed = useCallback(
    (key: string): string | null => committedSnapshot[key] ?? null,
    [committedSnapshot],
  );

  const set = useCallback((key: string, value: string | null) => {
    setDraft((prev) => ({ ...prev, [key]: value && value !== '' ? value : null }));
  }, []);

  const setMany = useCallback((patch: Record<string, string | null>) => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        next[k] = v && v !== '' ? v : null;
      }
      return next;
    });
  }, []);

  const reseed = useCallback(() => setDraft({}), []);
  const reset = useCallback(() => setDraft({}), []);

  // Dirty = any owned key's effective value differs from the committed URL.
  const dirty = useMemo(() => {
    for (const key of Object.keys(draft)) {
      const effective = draft[key] ?? '';
      const committedVal = committedSnapshot[key] ?? '';
      if (effective !== committedVal) return true;
    }
    return false;
  }, [draft, committedSnapshot]);

  const apply = useCallback(() => {
    if (!dirty) return;
    beforeApply?.();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of keySet) {
        const val = key in draft ? draft[key] : committedSnapshot[key] ?? null;
        if (val && val !== '') next.set(key, val);
        else next.delete(key);
      }
      if (resetPageOnApply) next.set('page', '1');
      return next;
    });
    setDraft({});
  }, [dirty, beforeApply, setSearchParams, keySet, draft, committedSnapshot, resetPageOnApply]);

  return { get, set, setMany, dirty, apply, reset, reseed, committed };
}
