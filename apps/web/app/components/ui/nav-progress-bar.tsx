import { useEffect, useState } from 'react';
import { useNavigation } from '@remix-run/react';

/**
 * Global top-of-page progress bar.
 *
 * Triggers on ANY non-idle Remix navigation — route changes, filter / sort / search
 * param updates, fetcher actions. This is the single source of "the app is loading"
 * feedback across every page; per-page spinners next to filter inputs are no longer
 * required.
 *
 * The bar:
 * - Animates from 0 → 90% during loading (deterministic ramp, never reaches 100% mid-flight)
 * - Snaps to 100% then fades out when navigation completes
 * - Has a 120 ms grace period so quick navigations don't flash a bar
 * - Sits fixed at z-[100] above all page content but below modals (z-[90])
 */
export function NavProgressBar() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== 'idle';

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      // Navigation finished. Snap to full, then fade.
      if (visible) {
        setProgress(100);
        const t = setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 200);
        return () => clearTimeout(t);
      }
      return;
    }

    // Show after 120 ms so fast loads don't flicker
    const showTimer = setTimeout(() => {
      setVisible(true);
      setProgress(15);
    }, 120);

    return () => clearTimeout(showTimer);
  }, [isLoading, visible]);

  // Ramp progress while loading
  useEffect(() => {
    if (!visible || !isLoading) return;
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        // Ease out: bigger increments early, smaller as we approach 90%
        const increment = (90 - p) * 0.08;
        return Math.min(90, p + Math.max(increment, 0.5));
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [visible, isLoading]);

  if (!visible) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] h-0.5 bg-transparent pointer-events-none"
      aria-hidden
    >
      <div
        className="h-full bg-brand-500 dark:bg-brand-400 transition-[width,opacity] duration-200 ease-out shadow-[0_0_8px_rgba(99,102,241,0.6)]"
        style={{
          width: `${progress}%`,
          opacity: progress >= 100 ? 0 : 1,
        }}
      />
    </div>
  );
}
