import { useMemo } from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';

/**
 * A pending edit overlay: while the fetcher is in-flight, treat the row whose
 * `id` matches as if these `patch` fields had already been written. The caller
 * applies it via `applyOptimisticPatches(rows, patches)`.
 */
export interface OptimisticPatch<T> {
  id: string;
  patch: Partial<T>;
}

/**
 * Sibling of `useOptimisticListMerge` for EDIT mutations. The edited values
 * already live in `fetcher.formData` — we read them, build a patch keyed on
 * the row id, and overlay onto the matching server row.
 *
 * **Lifecycle (default — `awaitSuccess: true`, CEO directive 2026-05):**
 *   1. User submits the edit form. `fetcher.state` → `'submitting'`. **No
 *      patch overlay yet** — the action hasn't confirmed.
 *   2. Server returns `{ success: true }`. The modal closes (via
 *      `useCloseOnFetcherSuccess`) and on the same React tick the patch
 *      overlay applies to the row in the list.
 *   3. Loader revalidates. The canonical row lands and the overlay drops
 *      cleanly when `fetcher.state` and `revalidatorState` return to `'idle'`.
 *
 * The edited row keeps its REAL id — no `__optimistic_` prefix — so action
 * buttons (View / Edit / Delete) remain meaningful. Use
 * `isOptimisticPatched(patches, row.id)` to dim the row (`opacity-60` +
 * "Saving…" chip) and `disabled={isOptimisticPatched(...)}` on action
 * buttons during the in-flight window to avoid stale-form races.
 *
 * **Failure path:** if the server rejects, `data.success` is never `true`
 * so the overlay never applies. The row stays at its server state and the
 * error toast surfaces — the user knows their change didn't take and the
 * modal stays open with the form values intact for retry.
 *
 * @example
 *   const patches = useOptimisticListPatches<Provider>(fetcher, (fd, intent) => {
 *     if (intent !== 'updateProvider') return null;
 *     const id = fd.get('providerId')?.toString();
 *     if (!id) return null;
 *     return [{ id, patch: { name: fd.get('name')?.toString() ?? '' } }];
 *   });
 *   const display = applyOptimisticPatches(serverRows, patches);
 *   // …in the row: className={isOptimisticPatched(patches, row.id) ? 'opacity-60' : ''}
 */
export function useOptimisticListPatches<T extends { id: string }>(
  fetcher: ReturnType<typeof useFetcher>,
  build: (formData: FormData, intent: string) => OptimisticPatch<T>[] | null,
  options?: {
    /**
     * When `true` (default), patches only apply AFTER the action returns
     * `{ success: true }`. Use `false` for non-modal inline edits where
     * showing the new value during submit matters more than rejection-flicker.
     */
    awaitSuccess?: boolean;
  },
): OptimisticPatch<T>[] {
  const { state: revalidatorState } = useRevalidator();
  const awaitSuccess = options?.awaitSuccess ?? true;
  return useMemo<OptimisticPatch<T>[]>(() => {
    const isMutating = fetcher.state !== 'idle' || revalidatorState !== 'idle';
    if (!isMutating) return [];

    if (awaitSuccess) {
      if (fetcher.state === 'submitting') return [];
      const data = fetcher.data;
      const succeeded =
        !!data && typeof data === 'object' && (data as { success?: boolean }).success === true;
      if (!succeeded) return [];
    }

    const fd = fetcher.formData;
    if (!fd) return [];
    const intent = fd.get('intent')?.toString() ?? '';
    if (!intent) return [];
    const patches = build(fd, intent);
    return patches ?? [];
  }, [fetcher.formData, fetcher.state, fetcher.data, revalidatorState, build, awaitSuccess]);
}

/**
 * Pure helper — given the server rows and a list of pending patches, return
 * a new list where matching rows have the patch fields shallow-merged on top.
 * Non-matching rows pass through by reference (so React reconciliation only
 * dirties the rows that actually changed).
 *
 * Only shallow merge — if a patch needs to update a nested object, the caller
 * is responsible for spreading inside `patch`. Deep merge would silently mask
 * bugs where a partial nested update overwrites unrelated sibling fields.
 */
export function applyOptimisticPatches<T extends { id: string }>(
  rows: readonly T[],
  patches: readonly OptimisticPatch<T>[],
): T[] {
  if (patches.length === 0) return rows as T[];
  const byId = new Map<string, Partial<T>>();
  for (const p of patches) byId.set(p.id, p.patch);
  return rows.map((row) => {
    const patch = byId.get(row.id);
    return patch ? { ...row, ...patch } : row;
  });
}

/**
 * Quick membership check used in render to decide whether a row is currently
 * being optimistically edited (for `opacity-60` + "Saving…" chip + disabled
 * action buttons).
 */
export function isOptimisticPatched<T extends { id: string }>(
  patches: readonly OptimisticPatch<T>[],
  id: string,
): boolean {
  for (const p of patches) {
    if (p.id === id) return true;
  }
  return false;
}
