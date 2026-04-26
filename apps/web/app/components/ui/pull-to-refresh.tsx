import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevalidator } from '@remix-run/react';

const PULL_THRESHOLD = 120;       // px of visual pull needed to trigger refresh (was 72)
const PULL_MAX = 160;              // max visual pull distance (was 110)
const PULL_DEAD_ZONE = 20;         // raw finger movement ignored before anything shows (was 0)
const SCROLL_TOP_TOLERANCE = 12;
const RELEASE_TRANSITION_MS = 200;
const RESISTANCE = 0.35;           // lower = heavier resistance (was 0.55)

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
  const [releasing, setReleasing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const reachedThresholdRef = useRef(false);
  const releaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoading = state === 'loading';

  // Clear refreshing flag when revalidation finishes
  useEffect(() => {
    if (state === 'idle') setRefreshing(false);
  }, [state]);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || isLoading || refreshing) return;
      if (getScrollTop() > SCROLL_TOP_TOLERANCE) return;
      const touch = e.touches[0];
      if (!touch) return;
      pullingRef.current = true;
      reachedThresholdRef.current = false;
      startYRef.current = touch.clientY;
      setPullDistance(0);
    },
    [disabled, isLoading, refreshing],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (disabled || !pullingRef.current || isLoading || refreshing) return;
      if (getScrollTop() > SCROLL_TOP_TOLERANCE) {
        pullingRef.current = false;
        setPullDistance(0);
        return;
      }
      const moveTouch = e.touches[0];
      if (!moveTouch) return;
      const rawDelta = moveTouch.clientY - startYRef.current;
      if (rawDelta <= PULL_DEAD_ZONE) return;
      e.preventDefault();
      const value = Math.min((rawDelta - PULL_DEAD_ZONE) * RESISTANCE, PULL_MAX);
      setPullDistance(value);
      reachedThresholdRef.current = value >= PULL_THRESHOLD;
    },
    [disabled, isLoading, refreshing],
  );

  const handleTouchEnd = useCallback(() => {
    if (disabled || !pullingRef.current) return;
    pullingRef.current = false;

    if (reachedThresholdRef.current) {
      setRefreshing(true);
      revalidate();
    }

    reachedThresholdRef.current = false;
    setReleasing(true);
    setPullDistance(0);

    if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current);
    releaseTimeoutRef.current = setTimeout(() => {
      setReleasing(false);
    }, RELEASE_TRANSITION_MS);
  }, [disabled, revalidate]);

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

  useEffect(() => () => {
    if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current);
  }, []);

  const showIndicator = pullDistance > 0 || refreshing || releasing;
  const indicatorHeight = refreshing
    ? 48
    : pullDistance > 0
      ? Math.min(pullDistance, PULL_MAX)
      : 0;
  const isReady = pullDistance >= PULL_THRESHOLD;
  const iconRotation = Math.min(360, (pullDistance / PULL_MAX) * 360);

  return (
    <div className="relative">
      {/* Pull indicator */}
      {showIndicator && (
        <div
          className="fixed left-0 right-0 top-0 z-50 flex items-center justify-center bg-app-elevated text-app-fg-muted shadow-sm"
          style={{
            height: indicatorHeight,
            transition: `height ${RELEASE_TRANSITION_MS}ms ease-out`,
          }}
        >
          {refreshing ? (
            <>
              <svg
                className="w-5 h-5 animate-spin mr-2"
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
            <>
              {isReady && (
                <span className="text-xs font-medium mr-2 text-brand-600 dark:text-brand-400">
                  Release to refresh
                </span>
              )}
              <svg
                className="w-5 h-5 transition-colors duration-150"
                style={{ transform: `rotate(${iconRotation}deg)` }}
                viewBox="0 0 24 24"
                fill="none"
                stroke={isReady ? 'currentColor' : 'currentColor'}
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
            </>
          )}
        </div>
      )}

      {/* Content — shifts down with pull */}
      <div
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : 'none',
          transition: pullDistance === 0 ? `transform ${RELEASE_TRANSITION_MS}ms ease-out` : 'none',
          willChange: pullDistance > 0 ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
