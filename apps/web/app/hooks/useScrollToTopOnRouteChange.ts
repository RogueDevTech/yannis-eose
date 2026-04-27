import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigation, useNavigationType } from '@remix-run/react';

function getNavigationPreventScrollReset(
  nav: ReturnType<typeof useNavigation>,
): boolean | undefined {
  if (nav.state === 'idle') return undefined;
  return (nav as { preventScrollReset?: boolean }).preventScrollReset;
}

/**
 * After client navigations (PUSH/REPLACE), scroll the document to the top so new pages
 * do not inherit the previous route's scroll position. Skips: hash links, back/forward (POP),
 * and navigations that set preventScrollReset (e.g. tab / filter in place).
 * Pair with <ScrollRestoration getKey={(loc) => loc.key} /> so per-entry scroll matches history.
 */
export function useScrollToTopOnRouteChange() {
  const location = useLocation();
  const navigation = useNavigation();
  const navType = useNavigationType();
  const skipFromPreventScroll = useRef(false);
  const prevKeyRef = useRef(location.key);

  // `preventScrollReset` is set while a transition is in flight; it is not reliable at idle.
  const preventScrollReset = getNavigationPreventScrollReset(navigation);
  useLayoutEffect(() => {
    if (navigation.state === 'submitting' || navigation.state === 'loading') {
      if (preventScrollReset === true) {
        skipFromPreventScroll.current = true;
      }
    }
  }, [navigation.state, preventScrollReset]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (navigation.state !== 'idle') return;
    if (location.hash) return;
    if (navType === 'POP') {
      prevKeyRef.current = location.key;
      return;
    }
    if (location.key === prevKeyRef.current) {
      if (skipFromPreventScroll.current) {
        skipFromPreventScroll.current = false;
      }
      return;
    }
    if (skipFromPreventScroll.current) {
      skipFromPreventScroll.current = false;
      prevKeyRef.current = location.key;
      return;
    }

    prevKeyRef.current = location.key;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        if (document.documentElement) {
          document.documentElement.scrollTop = 0;
        }
        if (document.body) {
          document.body.scrollTop = 0;
        }
      });
    });
    return () => cancelAnimationFrame(id);
  }, [location.key, location.hash, navigation.state, navType]);
}
