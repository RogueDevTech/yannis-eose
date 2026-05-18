import { useEffect, useState } from 'react';
import { useSlowConnection, type SlowConnectionReason } from '~/hooks/useSlowConnection';

/**
 * Subtle banner that appears when the active navigation is slower than expected
 * or the user is on a known-slow connection. Mounted once per layout (Dashboard,
 * TPL, Rider). Auto-hides when the navigation finishes; doesn't interrupt the
 * user — informational only.
 *
 * Distinct from the connection-issue **modal** (which fires when a request fails
 * outright). This toast fires when a request is *succeeding but slow* — so users
 * understand the wait without thinking the app froze.
 */

const COPY_BY_REASON: Record<SlowConnectionReason, { title: string; description: string }> = {
  'slow-load': {
    title: 'This is taking longer than usual',
    description: 'Server is slow to respond — hold tight, we’re still loading.',
  },
  'slow-network': {
    title: 'Slow network detected',
    description: 'Your connection is limited — pages may take longer to load than usual.',
  },
};

export function SlowConnectionToast() {
  const { isSlow, reason } = useSlowConnection();
  // Latch once visible so the toast doesn't flicker if the reason briefly flips
  // between 'slow-load' and 'slow-network' on the same navigation.
  const [pinnedReason, setPinnedReason] = useState<SlowConnectionReason | null>(null);

  useEffect(() => {
    if (isSlow && reason) {
      setPinnedReason(reason);
      return;
    }
    if (!isSlow) {
      setPinnedReason(null);
    }
  }, [isSlow, reason]);

  if (!pinnedReason) return null;
  const copy = COPY_BY_REASON[pinnedReason];

  return (
    <div
      className="
        pointer-events-none fixed inset-x-0 top-3 z-[85] flex justify-center px-4
        animate-fade-in
      "
      role="status"
      aria-live="polite"
    >
      <div
        className="
          pointer-events-auto flex items-start gap-3 max-w-sm w-full
          rounded-lg border border-app-border bg-app-elevated shadow-lg
          px-3.5 py-2.5
        "
      >
        <span
          className="mt-0.5 inline-block h-2 w-2 rounded-full bg-warning-500 animate-pulse shrink-0"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-app-fg leading-tight">{copy.title}</p>
          <p className="mt-0.5 text-xs text-app-fg-muted">{copy.description}</p>
        </div>
      </div>
    </div>
  );
}
