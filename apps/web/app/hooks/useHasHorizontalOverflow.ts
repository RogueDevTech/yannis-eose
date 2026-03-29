import { type RefObject, useCallback, useLayoutEffect, useState } from 'react';

const EPS = 2;

/**
 * True when `scrollWidth > clientWidth` for the ref element.
 * Re-checks on window resize, element resize, DOM changes inside the element, and when `contentKey` changes.
 */
export function useHasHorizontalOverflow(
  ref: RefObject<HTMLElement | null>,
  contentKey?: string | number,
): boolean {
  const [hasOverflow, setHasOverflow] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) {
      setHasOverflow(false);
      return;
    }
    const next = el.scrollWidth > el.clientWidth + EPS;
    setHasOverflow((prev) => (prev === next ? prev : next));
  }, [ref]);

  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);

    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, characterData: true });

    window.addEventListener('resize', schedule);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [measure, contentKey]);

  return hasOverflow;
}
