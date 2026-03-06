import { useEffect, useState } from 'react';

const DEFAULT_BREAKPOINT = 768; // Tailwind md

/**
 * Returns true when viewport width is below the breakpoint (mobile).
 * Uses matchMedia for resize updates. Safe for SSR (returns false until mounted).
 */
export function useIsMobile(breakpoint: number = DEFAULT_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(query.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}
