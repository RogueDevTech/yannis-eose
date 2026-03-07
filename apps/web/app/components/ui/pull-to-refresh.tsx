import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevalidator } from '@remix-run/react';

const PULL_DEAD_ZONE = 18;
const PULL_THRESHOLD = 76;
const PULL_MAX = 100;
const SCROLL_TOP_TOLERANCE = 15;
const RELEASE_TRANSITION_MS = 220;

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
  const [releasing, setReleasing] = useState(false);
  const startYRef = useRef(0);
  const isAtTopRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const pullingRef = useRef(false);
  const pastDeadZoneRef = useRef(false);
  const releaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoading = state === 'loading';

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || isLoading) return;
      const atTop = getScrollTop() < SCROLL_TOP_TOLERANCE;
      isAtTopRef.current = atTop;
      if (atTop) {
        pullingRef.current = true;
        setIsPulling(true);
        pastDeadZoneRef.current = false;
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
        pastDeadZoneRef.current = false;
        setIsPulling(false);
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      const currentY = e.touches[0].clientY;
      const delta = currentY - startYRef.current;
      if (delta < 0 && !pastDeadZoneRef.current) {
        pullingRef.current = false;
        setIsPulling(false);
        return;
      }
      if (delta > 0) {
        if (delta < PULL_DEAD_ZONE) return;
        pastDeadZoneRef.current = true;
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
    pastDeadZoneRef.current = false;
    setIsPulling(false);
    setReleasing(true);
    setPullDistance(0);
    if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current);
    releaseTimeoutRef.current = setTimeout(() => {
      releaseTimeoutRef.current = null;
      setReleasing(false);
    }, RELEASE_TRANSITION_MS);
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

  useEffect(() => () => {
    if (releaseTimeoutRef.current) clearTimeout(releaseTimeoutRef.current);
  }, []);

  const showIndicator = pullDistance > 0 || isLoading || releasing;
  const triggerRefresh = pullDistance >= PULL_THRESHOLD;
  // Icon rotates with pull (0 -> 360deg over PULL_MAX) so the drag feels like winding a refresh
  const iconRotationDeg = Math.min(360, (pullDistance / PULL_MAX) * 360);
  const indicatorHeight = isLoading ? 52 : pullDistance > 0 ? Math.max(44, Math.min(pullDistance, PULL_MAX)) : 0;
  // Subtle scale when pulling: slight "lift" (e.g. scale 0.98 at full pull)
  const scale = pullDistance > 0 ? Math.max(0.98, 1 - pullDistance / 2500) : 1;
  const isTransforming = pullDistance > 0 || releasing;

  return (
    <div className="relative min-h-0 flex-1">
      {/* Pull indicator — fixed at top, refresh icon visible and rotating during drag */}
      {showIndicator && (
        <div
          className="fixed left-0 right-0 top-0 z-40 flex items-center justify-center overflow-hidden bg-surface-100 dark:bg-surface-900 text-surface-600 dark:text-surface-400 shadow-sm ease-out"
          style={{
            height: indicatorHeight,
            transition: `height ${RELEASE_TRANSITION_MS}ms ease-out`,
          }}
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

      <div
        className="min-h-0 flex-1"
        style={{
          transform: `translateY(${pullDistance}px) scale(${scale})`,
          transition: isTransforming && pullDistance === 0 ? `transform ${RELEASE_TRANSITION_MS}ms ease-out` : 'none',
          willChange: isTransforming ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
