import { useEffect, useRef } from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';

/**
 * Edge-triggered close-on-success for modal-driven `fetcher.Form` submissions.
 *
 * Fires `onSuccess` the instant `fetcher.data` flips to a `{ success: true }`
 * payload — the same React render tick that `useFetcherToast` shows the
 * toast. Use this to close the parent Modal so the toast and the close
 * happen visually together.
 *
 * Why a hook (and not a five-line snippet inline): every page that has tried
 * to write this from scratch shipped one of three buggy variants:
 *
 *   1. `useEffect([actionSuccess])` keyed on a derived boolean.
 *      Once the boolean flips to `true` it stays `true` until `fetcher.data`
 *      itself changes — so a second consecutive submit-with-success skips
 *      the effect (React sees the dep value unchanged) and the modal stays
 *      open.
 *
 *   2. `useEffect` waiting for `fetcher.state === 'idle'`.
 *      The post-action loader revalidation holds state at `'loading'` for
 *      100–500 ms, so the modal lingers visibly after the toast.
 *
 *   3. Closing inside the form's `onSubmit` handler.
 *      Closes BEFORE the action validates, hiding server errors. Tried and
 *      reverted in `LogisticsPage` history.
 *
 * The correct trigger is reference equality on `fetcher.data`. We hold the
 * last handled reference in a ref so identical objects never fire twice, and
 * each fresh `{ success: true }` response fires exactly once.
 *
 * Canonical reference: `apps/web/app/features/logistics/LogisticsPage.tsx`.
 */
export function useCloseOnFetcherSuccess(
  fetcher: ReturnType<typeof useFetcher>,
  onSuccess: (data: { success: true } & Record<string, unknown>) => void,
  options?: {
    /** Default `true`. Calls `useRevalidator().revalidate()` on success so any
     * non-default `shouldRevalidate` paths on parent routes still refresh. */
    revalidateOnIdle?: boolean;
    /**
     * Limit the close to specific submission intents. When set, only success
     * responses whose in-flight `formData.intent` matched (captured at submit
     * time) trigger `onSuccess`. Use this when one fetcher is shared by
     * multiple actions on the same page (e.g. `generateBatch` + `approve` +
     * `reject` on the HR payroll page) and only one of them should close a
     * particular modal.
     *
     * Pass a single intent string or an array of intents. If omitted, every
     * `{ success: true }` response fires `onSuccess`.
     */
    intent?: string | readonly string[];
  },
): void {
  const { revalidate, state: revalidatorState } = useRevalidator();
  const lastHandledRef = useRef<unknown>(fetcher.data);
  const revalidateOnIdle = options?.revalidateOnIdle ?? true;
  const intentFilter = options?.intent;
  /**
   * Captured at submit time because `fetcher.formData` is `null` once the
   * action resolves — we can't read the original intent from `fetcher` by
   * the time `fetcher.data` flips. Stamp it while we still can.
   */
  const lastSubmittedIntentRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetcher.state === 'submitting' || fetcher.state === 'loading') {
      const inFlight = fetcher.formData?.get('intent');
      if (typeof inFlight === 'string' && inFlight) {
        lastSubmittedIntentRef.current = inFlight;
      }
    }
  }, [fetcher.state, fetcher.formData]);

  useEffect(() => {
    if (fetcher.data === lastHandledRef.current) return;
    lastHandledRef.current = fetcher.data;
    if (!fetcher.data || typeof fetcher.data !== 'object') return;
    const data = fetcher.data as { success?: boolean } & Record<string, unknown>;
    if (!data.success) return;

    if (intentFilter !== undefined) {
      const lastIntent = lastSubmittedIntentRef.current;
      if (!lastIntent) return;
      const matches = Array.isArray(intentFilter)
        ? intentFilter.includes(lastIntent)
        : intentFilter === lastIntent;
      if (!matches) return;
    }

    onSuccess(data as { success: true } & Record<string, unknown>);

    if (revalidateOnIdle && revalidatorState === 'idle') {
      revalidate();
    }
    // We deliberately key on `fetcher.data` (and the surrounding deps) — NOT
    // on a derived boolean — so reference equality is the trigger.
  }, [fetcher.data, onSuccess, revalidate, revalidatorState, revalidateOnIdle, intentFilter]);
}
