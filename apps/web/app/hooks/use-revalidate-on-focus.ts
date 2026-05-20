import { useEffect } from 'react';
import { useRevalidator } from '@remix-run/react';

/**
 * Re-runs the current route's loaders whenever the tab regains focus or
 * becomes visible again.
 *
 * Use on pages whose loader data can change while the user is away — e.g. a
 * form with dropdown option lists (products, locations) where the user may
 * step out to a create flow in another tab and come back expecting the new
 * record to be selectable. Without this, the loader only re-runs on
 * navigation, so the stale list lingers until a manual refresh.
 */
export function useRevalidateOnFocus(): void {
  const { revalidate } = useRevalidator();

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [revalidate]);
}
