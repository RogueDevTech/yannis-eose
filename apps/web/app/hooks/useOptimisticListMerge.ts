import { useMemo } from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';

/**
 * Derive synthetic "optimistic" rows from an in-flight `fetcher.formData`
 * payload. Returns an array (possibly empty) — the caller merges it with the
 * server-side loader data, typically as `[...optimisticRows, ...serverRows]`.
 *
 * The hook handles the gating internally:
 *   isMutating = fetcher.state !== 'idle' || revalidatorState !== 'idle'
 *
 * That spans both the action phase AND the post-action loader revalidation,
 * so an optimistic row stays visible across the whole round-trip with no
 * flicker. As soon as the canonical row lands in the loader response and
 * `revalidatorState` returns to `'idle'`, the hook stops returning the
 * synthetic row — it's seamlessly replaced by the real data.
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
     * When `true`, the optimistic row only renders AFTER the action returns
     * `{ success: true }` — i.e. during the loader-revalidation window
     * (`fetcher.state === 'loading'`) and any post-action revalidator pass.
     * Hide it during the in-flight `submitting` phase entirely.
     *
     * Use this when the modal blocks the table during submit (so optimistic
     * UI under the modal is invisible anyway) and you want to avoid the
     * "row briefly appears, then disappears" flash on action failure.
     *
     * Default `false` — preserves the original "show throughout the
     * round-trip" behavior used by add-during-submit pages.
     */
    awaitSuccess?: boolean;
  },
): T[] {
  const { state: revalidatorState } = useRevalidator();
  const awaitSuccess = options?.awaitSuccess ?? false;
  return useMemo<T[]>(() => {
    const isMutating = fetcher.state !== 'idle' || revalidatorState !== 'idle';
    if (!isMutating) return [];

    // Gate on success when caller opted in. `fetcher.data` is set as soon as
    // the action returns (state transitions submitting → loading), so the
    // "after success" window starts on the loading edge — exactly when the
    // modal closes via `useCloseOnFetcherSuccess` and the table becomes
    // visible. If `data.success !== true` (action failed), we never render.
    if (awaitSuccess) {
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
