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
   * True while a same-path loader refetch is in flight, or immediately after the user
   * triggers one (before Remix flips `navigation.state` to `loading`).
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
 *   as busy so the overlay can appear before data is swapped.
 * - `primeSamePathRefetch()` + capture-phase `pointerdown` on in-app `<a href>` links
 *   that only change the query string paint the overlay on the same frame as the click.
 */
export function useLoaderRefetchBusy(options?: UseLoaderRefetchBusyOptions): LoaderRefetchBusy {
  const navigation = useNavigation();
  const location = useLocation();
  const samePathnameOnly = options?.samePathnameOnly ?? true;
  const [armed, setArmed] = useState(false);

  const pathname = location.pathname;
  const search = location.search;

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

  useLayoutEffect(() => {
    const onPointerDownCapture = (ev: PointerEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const a = t.closest('a[href]');
      if (!a || !(a instanceof HTMLAnchorElement)) return;
      if (a.target === '_blank' || a.download) return;
      const href = a.getAttribute('href');
      if (!href) return;

      let nextUrl: URL;
      try {
        nextUrl = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (nextUrl.origin !== window.location.origin) return;
      if (nextUrl.pathname !== pathname) return;
      if (nextUrl.search === search && nextUrl.hash === location.hash) return;

      primeSamePathRefetch();
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [pathname, search, location.hash, primeSamePathRefetch]);

  const busy = Boolean(armed || isSamePathRefetchNav);

  return { busy, primeSamePathRefetch };
}
