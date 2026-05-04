/**
 * Optimistic-row ID helpers — single source of truth for the synthetic-row
 * marker used by `useOptimisticListMerge` and the surfaces that consume it.
 *
 * Every optimistic row generated from in-flight `fetcher.formData` is given an
 * ID that starts with `OPTIMISTIC_ID_PREFIX`. Consumers use `isOptimisticId`
 * to decide whether to dim the row, render the "Saving…" chip, and disable
 * action buttons (View / Edit / Delete on a synthetic ID would 404 the API).
 *
 * Keep this module tiny and dependency-free; any drift between producer and
 * consumer breaks the visual contract for every page using the pattern.
 */

export const OPTIMISTIC_ID_PREFIX = '__optimistic';

/**
 * Build a synthetic row ID. Pass a stable suffix when the same form yields
 * multiple optimistic rows (e.g. bulk-create) so React `key` props stay
 * unique across the merged list.
 */
export function optimisticId(suffix?: string | number): string {
  return suffix === undefined || suffix === null || suffix === ''
    ? OPTIMISTIC_ID_PREFIX
    : `${OPTIMISTIC_ID_PREFIX}_${suffix}`;
}

export function isOptimisticId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(OPTIMISTIC_ID_PREFIX);
}
