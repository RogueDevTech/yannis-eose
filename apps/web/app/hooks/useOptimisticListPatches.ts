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
 * Sibling of `useOptimisticListMerge` for EDIT mutations. When the user
 * submits an edit form, the new field values are already in
 * `fetcher.formData` — we read them, build a patch keyed on the row id,
 * and overlay onto the matching server row for the duration of the
 * round-trip. As soon as the loader revalidates with the canonical row,
 * the overlay drops cleanly (the hook returns `[]` once `fetcher.state`
 * AND `revalidatorState` are both `idle`).
 *
 * Unlike optimistic-add the edited row keeps its REAL id — no
 * `__optimistic_` prefix — so action buttons (View / Edit / Delete) remain
 * meaningful. Use `isOptimisticPatched(patches, row.id)` to dim the row
 * (`opacity-60` + "Saving…" chip) and `disabled={isOptimisticPatched(...)}` on
 * action buttons during the in-flight window to avoid stale-form races.
 *
 * If the server rejects the change, `useFetcherToast` surfaces the error
 * and the overlay drops — the row visibly "snaps back" to its server state.
 * That UX is correct: the user knows their change didn't take.
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
): OptimisticPatch<T>[] {
  const { state: revalidatorState } = useRevalidator();
  return useMemo<OptimisticPatch<T>[]>(() => {
    const isMutating = fetcher.state !== 'idle' || revalidatorState !== 'idle';
    if (!isMutating) return [];
    const fd = fetcher.formData;
    if (!fd) return [];
    const intent = fd.get('intent')?.toString() ?? '';
    if (!intent) return [];
    const patches = build(fd, intent);
    return patches ?? [];
  }, [fetcher.formData, fetcher.state, revalidatorState, build]);
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
