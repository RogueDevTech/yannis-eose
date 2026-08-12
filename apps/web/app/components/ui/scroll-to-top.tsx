import { useEffect, useState } from 'react';

/**
 * Floating "scroll to top" button.
 *
 * Appears only after the user scrolls past a threshold, and sits just above
 * the AI chat icon (which lives at right-4 bottom-20 md:bottom-6, w-12 h-12).
 * Shown for everyone, independent of AI-assistant access.
 */
export function ScrollToTop({ threshold = 400 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > threshold);
    };
    onScroll(); // sync initial state (e.g. on route change with restored scroll)
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll to top"
      tabIndex={visible ? 0 : -1}
      className={`fixed z-[69] right-4 bottom-[8.5rem] md:bottom-[4.5rem] w-12 h-12 rounded-full bg-app-elevated border border-app-border text-app-fg-muted shadow-lg hover:shadow-xl hover:text-app-fg transition-all flex items-center justify-center ${
        visible ? 'scale-100 opacity-100' : 'scale-0 opacity-0 pointer-events-none'
      }`}
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      </svg>
    </button>
  );
}
