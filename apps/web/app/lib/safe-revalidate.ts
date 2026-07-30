/**
 * App-wide guard for Remix `revalidate()` after a backgrounded PWA/tab resumes.
 *
 * iOS/Android often wake JS before the network stack is ready. Any page that
 * calls `useRevalidator().revalidate()` in that window can throw
 * `TypeError: Failed to fetch` and replace a working UI with the ErrorBoundary.
 * That looked page-specific in reports (path = whatever was open) but the
 * failure mode is shared.
 *
 * Call {@link installResumeSettleTracking} once from the root App, then route
 * automatic revalidates through {@link runSafeRevalidate}.
 */

const RESUME_SETTLE_MS = 800;

let settleUntil = 0;
let trackingInstalled = false;

/** Mark the next ~800ms as unsafe for automatic loader revalidation. */
export function markResumeSettle(): void {
  settleUntil = Date.now() + RESUME_SETTLE_MS;
}

/**
 * Install once (root App). Tracks `visibilitychange` → visible and `pageshow`
 * (bfcache restore) so every surface shares the same settle window.
 */
export function installResumeSettleTracking(): void {
  if (typeof window === 'undefined' || trackingInstalled) return;
  trackingInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markResumeSettle();
  });
  window.addEventListener('pageshow', (e) => {
    // bfcache restore — network is often not ready on the first tick.
    if (e.persisted) markResumeSettle();
  });
}

export function isResumeSettling(): boolean {
  return Date.now() < settleUntil;
}

export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * True when an automatic revalidate is safe to fire (online + past resume settle).
 * Manual user actions (Try Again, pull-to-refresh) may ignore this.
 */
export function canSafeRevalidate(): boolean {
  return isBrowserOnline() && !isResumeSettling();
}

/**
 * Run `revalidate` now if safe; otherwise retry once after the settle window
 * (and after `online` if currently offline). Never queues more than one retry.
 */
export function runSafeRevalidate(revalidate: () => void): void {
  if (typeof window === 'undefined') {
    revalidate();
    return;
  }

  if (canSafeRevalidate()) {
    revalidate();
    return;
  }

  const delay = Math.max(settleUntil - Date.now(), 0) + 50;
  const tryFire = () => {
    if (!isBrowserOnline()) {
      window.addEventListener('online', tryFire, { once: true });
      return;
    }
    if (isResumeSettling()) {
      window.setTimeout(tryFire, Math.max(settleUntil - Date.now(), 50));
      return;
    }
    revalidate();
  };

  window.setTimeout(tryFire, delay);
}
