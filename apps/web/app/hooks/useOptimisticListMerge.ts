import { useMemo } from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';

/**
 * Derive a synthetic "optimistic" row from a fetcher's submission payload and
 * merge it into the list while the post-action loader revalidates.
 *
 * **Lifecycle (default — `awaitSuccess: true`):**
 *   1. User clicks Submit. `fetcher.state` → `'submitting'`. **No synthetic
 *      row yet** — the action hasn't confirmed.
 *   2. Server returns `{ success: true }`. `fetcher.data` flips, the modal
 *      closes (via `useCloseOnFetcherSuccess`), and on the SAME React tick
 *      the synthetic row appears in the list.
 *   3. Loader revalidates (`fetcher.state` = `'loading'`). The real row lands.
 *   4. `fetcher.state` → `'idle'`. Synthetic row drops; real row stays.
 *
 * The synthetic row is purely a bridge between modal-close and loader-
 * revalidation. The user never sees "row appears, then disappears" because
 * we wait for confirmation before showing anything.
 *
 * **Why the default is `awaitSuccess: true` (CEO directive 2026-05):** the
 * earlier "show during submit" model briefly painted rows that the server
 * could still reject, leading to flicker on bad input. Waiting for success
 * makes every visible row a row that landed.
 *
 * **Failure path:** if the server returns `{ success: false }` or throws,
 * `fetcher.data.success` is never `true` so the synthetic row never renders,
 * and the modal stays open with the form values intact. The user sees their
 * error toast and can retry without losing input.
 *
 * The `build` callback is the only per-page logic. It receives the live
 * `FormData` plus the resolved `intent` string (from the `name="intent"`
 * hidden input) and returns either the synthetic rows OR `null` when the
 * intent doesn't apply to this list. Use `optimisticId(...)` from
 * `~/lib/optimistic` for the row ID so consumers can mark + disable.
 *
 * Canonical reference: `apps/web/app/features/logistics/LogisticsPage.tsx`.
 *
 * @example
 *   const optimisticProviders = useOptimisticListMerge<Provider>(fetcher, (fd, intent) => {
 *     if (intent !== 'createProvider') return null;
 *     const name = fd.get('name')?.toString().trim();
 *     if (!name) return null;
 *     return [{ id: optimisticId(), name, status: 'ACTIVE', createdAt: new Date().toISOString(), ... }];
 *   });
 *   const display = useMemo(
 *     () => [...optimisticProviders, ...providers],
 *     [providers, optimisticProviders],
 *   );
 */
export function useOptimisticListMerge<T>(
  fetcher: ReturnType<typeof useFetcher>,
  build: (formData: FormData, intent: string) => T[] | null,
  options?: {
    /**
     * When `true` (default), the optimistic row only renders AFTER the action
     * returns `{ success: true }` — i.e. during the loader-revalidation
     * window (`fetcher.state === 'loading'`) and any post-action revalidator
     * pass. Hidden during the in-flight `submitting` phase entirely. This is
     * what every modal-driven CRUD list wants because the modal is still
     * covering the table during submit, AND because painting a row that the
     * server could reject leads to flicker on validation failure.
     *
     * Set to `false` only for non-modal in-line edits where instant feedback
     * during the in-flight window matters more than rejection-flicker.
     */
    awaitSuccess?: boolean;
  },
): T[] {
  const { state: revalidatorState } = useRevalidator();
  const awaitSuccess = options?.awaitSuccess ?? true;
  return useMemo<T[]>(() => {
    const isMutating = fetcher.state !== 'idle' || revalidatorState !== 'idle';
    if (!isMutating) return [];

    // Gate on success when caller opted in (default). `fetcher.data` is set
    // as soon as the action returns (state transitions submitting → loading),
    // so the "after success" window starts on the loading edge — exactly
    // when the modal closes via `useCloseOnFetcherSuccess` and the table
    // becomes visible. If `data.success !== true` (action failed), we never
    // render.
    //
    // We also guard against stale `fetcher.data` from a prior submit by
    // requiring `fetcher.state !== 'submitting'` — a fresh submit clears the
    // synthetic row until its own success lands.
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
    const rows = build(fd, intent);
    return rows ?? [];
    // We deliberately key on `fetcher.formData` (the live submission payload)
    // and `fetcher.state` / `revalidatorState` (the lifecycle); `build` is
    // expected to be a stable reference from the caller (or wrapped in
    // useCallback) — passing it here keeps the hook honest.
  }, [fetcher.formData, fetcher.state, fetcher.data, revalidatorState, build, awaitSuccess]);
}
