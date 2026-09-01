import { useEffect, useRef } from 'react';

/**
 * Repeatedly runs `tick` every `intervalMs` for as long as `active` is true.
 *
 * Why this exists: both import surfaces previously inlined
 * `if (pollRef.current) return;` guards inside a `useEffect` whose deps changed
 * on every tick (the freshly-fetched job object, plus row-paging callbacks).
 * React tears the old interval down via the previous cleanup BEFORE re-running
 * the effect, so that early return handed back `undefined` as the new cleanup
 * and the poll died silently — the page then sat frozen while the worker kept
 * importing rows in the background.
 *
 * The fix is to keep the latest `tick` in a ref so the interval itself only
 * depends on `active` + `intervalMs`. The callback can change as often as it
 * likes without restarting (or killing) the timer.
 */
export function useImportJobPoll(
  active: boolean,
  tick: () => void | Promise<void>,
  intervalMs = 2500,
) {
  const tickRef = useRef(tick);
  // Keep the ref pointed at the newest closure without restarting the interval.
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    // Guards against overlapping runs when a poll takes longer than the
    // interval (the dev DB regularly serves 1-3s queries).
    let inFlight = false;

    const run = () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      void Promise.resolve(tickRef.current()).finally(() => {
        inFlight = false;
      });
    };

    const id = setInterval(run, intervalMs);

    // Re-sync the moment the tab comes back to the foreground: browsers throttle
    // background timers hard, so a user returning after a while would otherwise
    // stare at stale numbers until the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [active, intervalMs]);
}
