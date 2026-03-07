import { useState, useEffect, useCallback, useRef } from 'react';
import { useIsMobile } from '~/hooks/useIsMobile';

const SCROLL_THRESHOLD = 300;

/** Ease-out step: move ~12% of remaining distance per frame, min 2px so we always reach 0 */
function nextScrollY(current: number): number {
  const step = Math.max(current * 0.12, 2);
  return Math.max(0, current - step);
}

export function ScrollToTopButton() {
  const isMobile = useIsMobile();
  const [visible, setVisible] = useState(false);
  const rafIdRef = useRef<number | null>(null);
  const isScrollingToTopRef = useRef(false);
  const lastScrollYRef = useRef(0);

  const checkScroll = useCallback(() => {
    if (typeof window === 'undefined') return;
    const y = window.scrollY ?? document.documentElement.scrollTop ?? 0;

    // Cancel programmatic scroll-to-top if user scrolled down (scrollY increased)
    if (isScrollingToTopRef.current && y > lastScrollYRef.current) {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      isScrollingToTopRef.current = false;
    }
    lastScrollYRef.current = y;
    setVisible(y > SCROLL_THRESHOLD);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    checkScroll();
    window.addEventListener('scroll', checkScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', checkScroll);
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      isScrollingToTopRef.current = false;
    };
  }, [isMobile, checkScroll]);

  const scrollToTop = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    isScrollingToTopRef.current = true;
    lastScrollYRef.current = window.scrollY ?? document.documentElement.scrollTop ?? 0;

    const tick = () => {
      const current = window.scrollY ?? document.documentElement.scrollTop ?? 0;
      if (current <= 0) {
        isScrollingToTopRef.current = false;
        rafIdRef.current = null;
        return;
      }
      const next = nextScrollY(current);
      window.scrollTo(0, next);
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  if (!isMobile) return null;

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className={`
        fixed z-[35] flex h-11 w-11 items-center justify-center rounded-full
        bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-200
        shadow-lg border border-surface-200 dark:border-surface-700
        hover:bg-surface-50 dark:hover:bg-surface-700
        active:scale-95 transition-all duration-200
        md:hidden
      `}
      style={{
        bottom: 'calc(var(--bottom-nav-height) + 12px)',
        right: '1rem',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transform: visible ? 'scale(1)' : 'scale(0.9)',
      }}
    >
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
  );
}
