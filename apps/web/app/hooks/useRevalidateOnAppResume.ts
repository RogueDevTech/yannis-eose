import { useEffect, useRef } from 'react';
import { useNavigation, useRevalidator } from '@remix-run/react';

const DEBOUNCE_MS = 500;

/**
 * Refetches Remix loaders when the user returns to the tab or foregrounds the PWA,
 * and when the page is restored from bfcache. Skips the first visible paint until
 * the document has been hidden at least once. Debounced; skips when offline (rider PWA);
 * revalidates once when the browser goes online again.
 */
export function useRevalidateOnAppResume(enabled: boolean): void {
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  const navigation = useNavigation();
  const navigationStateRef = useRef(navigation.state);
  navigationStateRef.current = navigation.state;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawHiddenRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const scheduleRevalidate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (navigationStateRef.current !== 'idle') return;
        if (!navigator.onLine) return;
        revalidateRef.current();
      }, DEBOUNCE_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        sawHiddenRef.current = true;
        return;
      }
      if (!sawHiddenRef.current) return;
      if (navigationStateRef.current !== 'idle') return;
      if (!navigator.onLine) return;
      scheduleRevalidate();
    };

    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (navigationStateRef.current !== 'idle') return;
      if (!navigator.onLine) return;
      scheduleRevalidate();
    };

    const onOnline = () => {
      if (navigationStateRef.current !== 'idle') return;
      scheduleRevalidate();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
    };
  }, [enabled]);
}
