import { useCallback, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigation } from '@remix-run/react';

export interface UseLoaderRefetchBusyOptions {
  /**
   * When true (default), only report busy during a transition that stays on the
   * same pathname (search-param / pagination refetches). Avoids overlay flashes when
   * navigating to another route while this component is still mounted briefly.
   */
  samePathnameOnly?: boolean;
}

export interface LoaderRefetchBusy {
  /**
   * True while a same-path loader refetch is in flight.
   */
  busy: boolean;
  /**
   * Call synchronously in the same stack as programmatic URL updates (`setSearchParams`,
   * etc.) so the table overlay can paint before the router schedules navigation.
   */
  primeSamePathRefetch: () => void;
}

/**
 * Same-path loader refetch detection for table overlays.
 *
 * - Treats `navigation.state === 'loading'`, and GET-like `submitting` (Link / GET form),
 *   as busy so the overlay appears while the loader runs.
 * - `primeSamePathRefetch()` arms the overlay synchronously for programmatic navigations
 *   (`setSearchParams`, etc.) so the overlay paints before the router schedules.
 *
 * NOTE: We intentionally do NOT listen for `pointerdown` on `<a>` links.
 * Pre-arming the overlay on pointerdown caused a React re-render that replaced
 * the DOM node before the browser dispatched `click`, silently swallowing the
 * navigation (first-click no-op on pagination). The overlay now appears one
 * frame after click instead of on pointerdown — an imperceptible difference
 * that eliminates the double-click bug.
 */
export function useLoaderRefetchBusy(options?: UseLoaderRefetchBusyOptions): LoaderRefetchBusy {
  const navigation = useNavigation();
  const location = useLocation();
  const samePathnameOnly = options?.samePathnameOnly ?? true;
  const [armed, setArmed] = useState(false);

  const pathname = location.pathname;

  const destPathname = navigation.location?.pathname;
  const method = navigation.formMethod?.toUpperCase();
  const isGetLikeSubmitting =
    navigation.state === 'submitting' && (method === 'GET' || method === undefined);

  const isSamePathRefetchNav =
    (navigation.state === 'loading' || isGetLikeSubmitting) &&
    (!samePathnameOnly ||
      destPathname == null ||
      destPathname === '' ||
      destPathname === pathname);

  const primeSamePathRefetch = useCallback(() => {
    flushSync(() => {
      setArmed(true);
    });
  }, []);

  useLayoutEffect(() => {
    if (navigation.state === 'idle') {
      setArmed(false);
    }
  }, [navigation.state]);

  const busy = Boolean(armed || isSamePathRefetchNav);

  return { busy, primeSamePathRefetch };
}
