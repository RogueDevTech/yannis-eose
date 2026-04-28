import { useLocation, useNavigation } from '@remix-run/react';

export interface UseLoaderRefetchBusyOptions {
  /**
   * When true (default), only report busy during a loader transition that stays on the
   * same pathname (search-param / pagination refetches). Avoids overlay flashes when
   * navigating to another route while this component is still mounted briefly.
   */
  samePathnameOnly?: boolean;
}

/**
 * True while Remix is re-running the route loader (`navigation.state === 'loading'`).
 * Use for table overlays on filter/pagination changes — not for `submitting` unless
 * you intentionally want form posts to dim the table.
 */
export function useLoaderRefetchBusy(options?: UseLoaderRefetchBusyOptions): boolean {
  const navigation = useNavigation();
  const location = useLocation();
  const samePathnameOnly = options?.samePathnameOnly ?? true;

  if (navigation.state !== 'loading') return false;
  if (!samePathnameOnly) return true;

  const nextPath = navigation.location?.pathname;
  if (nextPath == null || nextPath === '') return true;
  return nextPath === location.pathname;
}
