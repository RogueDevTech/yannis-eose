import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevalidator } from '@remix-run/react';

const PULL_DEAD_ZONE = 18;
const PULL_THRESHOLD = 76;
const PULL_MAX = 100;
const SCROLL_TOP_TOLERANCE = 15;
const RELEASE_TRANSITION_MS = 220;
const HOLD_TO_REFRESH_MS = 2000;
const HOLD_PROGRESS_INTERVAL_MS = 50;

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
  const holdProgressRef = useRef(0);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [pullTriggeredRefresh, setPullTriggeredRefresh] = useState(false);

  const isLoading = state === 'loading';
  const isDragLoading = isLoading && pullTriggeredRefresh;

  const clearHoldTimer = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    holdProgressRef.current = 0;
    setHoldProgress(0);
  }, []);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || isDragLoading) return;
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
    [disabled, isDragLoading],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (disabled || isDragLoading || !pullingRef.current) return;
      if (!isAtTopRef.current) return;
      const scrollTop = getScrollTop();
      if (scrollTop >= SCROLL_TOP_TOLERANCE) {
        pullingRef.current = false;
        pastDeadZoneRef.current = false;
        clearHoldTimer();
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

        if (value >= PULL_THRESHOLD && !holdIntervalRef.current) {
          const step = HOLD_PROGRESS_INTERVAL_MS / HOLD_TO_REFRESH_MS;
          holdIntervalRef.current = setInterval(() => {
            const next = Math.min(1, holdProgressRef.current + step);
            holdProgressRef.current = next;
            setHoldProgress(next);
            if (next >= 1) {
              clearHoldTimer();
              setPullTriggeredRefresh(true);
              revalidate();
            }
          }, HOLD_PROGRESS_INTERVAL_MS);
        } else if (value < PULL_THRESHOLD) {
          clearHoldTimer();
        }
      }
    },
    [disabled, isDragLoading, clearHoldTimer, revalidate],
  );

  const handleTouchEnd = useCallback(() => {
    if (disabled || isDragLoading) return;
    clearHoldTimer();
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
  }, [disabled, isDragLoading, clearHoldTimer]);

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
    clearHoldTimer();
  }, [clearHoldTimer]);

  useEffect(() => {
    if (state === 'idle') setPullTriggeredRefresh(false);
  }, [state]);

  const showIndicator = pullDistance > 0 || isDragLoading || releasing;
  const atHoldThreshold = pullDistance >= PULL_THRESHOLD;
  const isHolding = atHoldThreshold && holdProgress > 0 && holdProgress < 1;
  // Icon rotates with pull (0 -> 360deg over PULL_MAX) so the drag feels like winding a refresh
  const iconRotationDeg = Math.min(360, (pullDistance / PULL_MAX) * 360);
  const indicatorHeight = isDragLoading ? 52 : pullDistance > 0 ? Math.max(44, Math.min(pullDistance, PULL_MAX)) : 0;
  // Subtle scale when pulling: slight "lift" (e.g. scale 0.98 at full pull)
  const scale = pullDistance > 0 ? Math.max(0.98, 1 - pullDistance / 2500) : 1;
  const isTransforming = pullDistance > 0 || releasing;

  return (
    <div className="relative min-h-0 flex-1">
      {/* Pull indicator — fixed at top, refresh icon visible and rotating during drag */}
      {showIndicator && (
        <div
          className="fixed left-0 right-0 top-0 z-40 flex items-center justify-center overflow-hidden bg-app-elevated text-app-fg-muted shadow-sm ease-out"
          style={{
            height: indicatorHeight,
            transition: `height ${RELEASE_TRANSITION_MS}ms ease-out`,
          }}
          aria-live="polite"
          aria-busy={isDragLoading}
        >
          {isDragLoading ? (
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
            <>
              {isHolding ? (
                <span className="text-xs font-medium mr-2">
                  Hold… {Math.ceil((1 - holdProgress) * 2)}s
                </span>
              ) : atHoldThreshold ? (
                <span className="text-xs font-medium mr-2">Hold 2s to refresh</span>
              ) : null}
              <svg
                className="w-6 h-6 flex-shrink-0 transition-transform duration-75"
                style={{
                  transform: `rotate(${iconRotationDeg}deg) ${atHoldThreshold ? 'scale(1.15)' : 'scale(1)'}`,
                }}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {isHolding ? (
                  <>
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeOpacity={0.2}
                      fill="none"
                      strokeWidth={2}
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeDasharray={2 * Math.PI * 10}
                      strokeDashoffset={2 * Math.PI * 10 * (1 - holdProgress)}
                      strokeLinecap="round"
                      transform="rotate(-90 12 12)"
                    />
                  </>
                ) : (
                  <>
                    <path d="M3 4v6h6" />
                    <path d="M21 20v-6h-6" />
                    <path d="M5.64 19.36A9 9 0 0 1 4 12a9 9 0 0 1 9-9c2.39 0 4.57.94 6.17 2.47" />
                    <path d="M18.36 4.64A9 9 0 0 1 20 12a9 9 0 0 1-9 9c-2.39 0-4.57-.94-6.17-2.47" />
                  </>
                )}
              </svg>
            </>
          )}
        </div>
      )}

      <div
        className="min-h-0 flex-1"
        style={{
          transform: isTransforming ? `translateY(${pullDistance}px) scale(${scale})` : 'none',
          transition: isTransforming && pullDistance === 0 ? `transform ${RELEASE_TRANSITION_MS}ms ease-out` : 'none',
          willChange: isTransforming ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
