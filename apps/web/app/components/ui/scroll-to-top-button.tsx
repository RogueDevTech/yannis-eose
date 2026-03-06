import { useState, useEffect, useCallback } from 'react';
import { useIsMobile } from '~/hooks/useIsMobile';

const SCROLL_THRESHOLD = 300;

export function ScrollToTopButton() {
  const isMobile = useIsMobile();
  const [visible, setVisible] = useState(false);

  const checkScroll = useCallback(() => {
    const y = typeof window !== 'undefined' ? window.scrollY ?? document.documentElement.scrollTop : 0;
    setVisible(y > SCROLL_THRESHOLD);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    checkScroll();
    window.addEventListener('scroll', checkScroll, { passive: true });
    return () => window.removeEventListener('scroll', checkScroll);
  }, [isMobile, checkScroll]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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
