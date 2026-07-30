import { useEffect } from 'react';
import { useRevalidator } from '@remix-run/react';
import { runSafeRevalidate } from '~/lib/safe-revalidate';

/**
 * Re-runs the current route's loaders whenever the tab regains focus or
 * becomes visible again.
 *
 * Use on pages whose loader data can change while the user is away — e.g. a
 * form with dropdown option lists (products, locations) where the user may
 * step out to a create flow in another tab and come back expecting the new
 * record to be selectable. Without this, the loader only re-runs on
 * navigation, so the stale list lingers until a manual refresh.
 *
 * Resume-gated via `runSafeRevalidate` so a backgrounded PWA wake doesn't
 * fire a fetch before the network stack is ready.
 */
export function useRevalidateOnFocus(): void {
  const { revalidate } = useRevalidator();

  useEffect(() => {
    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      runSafeRevalidate(revalidate);
    };

    window.addEventListener('focus', schedule);
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('online', schedule);
    return () => {
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('online', schedule);
    };
  }, [revalidate]);
}
