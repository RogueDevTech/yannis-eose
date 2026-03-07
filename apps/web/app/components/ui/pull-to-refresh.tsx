import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevalidator } from '@remix-run/react';

const PULL_THRESHOLD = 60;
const PULL_MAX = 80;
const SCROLL_TOP_TOLERANCE = 10;

interface PullToRefreshProps {
  children: React.ReactNode;
  disabled?: boolean;
}

function getScrollTop(): number {
  if (typeof document === 'undefined') return 0;
  return document.documentElement.scrollTop || window.scrollY;
}

export function PullToRefresh({ children, disabled = false }: PullToRefreshProps) {
  const { revalidate, state } = useRevalidator();
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const startYRef = useRef(0);
  const isAtTopRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const pullingRef = useRef(false);

  const isLoading = state === 'loading';

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || isLoading) return;
      const atTop = getScrollTop() < SCROLL_TOP_TOLERANCE;
      isAtTopRef.current = atTop;
      if (atTop) {
        pullingRef.current = true;
        setIsPulling(true);
        startYRef.current = e.touches[0].clientY;
        pullDistanceRef.current = 0;
        setPullDistance(0);
      }
    },
    [disabled, isLoading],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (disabled || isLoading || !pullingRef.current) return;
      if (!isAtTopRef.current) return;
      const scrollTop = getScrollTop();
      if (scrollTop >= SCROLL_TOP_TOLERANCE) {
        pullingRef.current = false;
        setIsPulling(false);
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      const currentY = e.touches[0].clientY;
      const delta = currentY - startYRef.current;
      if (delta > 0) {
        e.preventDefault();
        const value = Math.min(delta, PULL_MAX);
        pullDistanceRef.current = value;
        setPullDistance(value);
      }
    },
    [disabled, isLoading],
  );

  const handleTouchEnd = useCallback(() => {
    if (disabled || isLoading) return;
    const currentPull = pullDistanceRef.current;
    if (currentPull >= PULL_THRESHOLD) {
      revalidate();
    }
    pullingRef.current = false;
    pullDistanceRef.current = 0;
    setIsPulling(false);
    setPullDistance(0);
  }, [disabled, isLoading, revalidate]);

  useEffect(() => {
    if (disabled) return;
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [disabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  const showIndicator = pullDistance > 0 || isLoading;
  const triggerRefresh = pullDistance >= PULL_THRESHOLD;
  // Icon rotates with pull (0 -> 360deg over PULL_MAX) so the drag feels like winding a refresh
  const iconRotationDeg = Math.min(360, (pullDistance / PULL_MAX) * 360);
  const indicatorHeight = isLoading ? 52 : Math.max(44, Math.min(pullDistance, PULL_MAX));

  return (
    <div className="relative min-h-0 flex-1">
      {/* Pull indicator — fixed at top, refresh icon visible and rotating during drag */}
      {showIndicator && (
        <div
          className="fixed left-0 right-0 top-0 z-40 flex items-center justify-center overflow-hidden bg-surface-100 dark:bg-surface-900 text-surface-600 dark:text-surface-400 shadow-sm transition-[height] duration-200 ease-out"
          style={{ height: indicatorHeight }}
          aria-live="polite"
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <svg
                className="w-6 h-6 animate-spin mr-2 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5.64 19.36A9 9 0 0 1 4 12a9 9 0 0 1 9-9c2.39 0 4.57.94 6.17 2.47" />
                <path d="M18.36 4.64A9 9 0 0 1 20 12a9 9 0 0 1-9 9c-2.39 0-4.57-.94-6.17-2.47" />
              </svg>
              <span className="text-xs font-medium">Refreshing…</span>
            </>
          ) : (
            <svg
              className="w-6 h-6 flex-shrink-0 transition-transform duration-75"
              style={{
                transform: `rotate(${iconRotationDeg}deg) ${triggerRefresh ? 'scale(1.15)' : 'scale(1)'}`,
              }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 4v6h6" />
              <path d="M21 20v-6h-6" />
              <path d="M5.64 19.36A9 9 0 0 1 4 12a9 9 0 0 1 9-9c2.39 0 4.57.94 6.17 2.47" />
              <path d="M18.36 4.64A9 9 0 0 1 20 12a9 9 0 0 1-9 9c-2.39 0-4.57-.94-6.17-2.47" />
            </svg>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
