import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { useLoginModalGate } from '~/contexts/login-modal-gate';

/**
 * localStorage key — the modal's exponential-backoff cooldown survives across
 * logouts so a busy staff member who keeps skipping isn't asked again on every
 * fresh login. Cleared when they click Start (they're engaging) or when the
 * onboarding status moves out of NOT_STARTED / IN_PROGRESS server-side.
 *
 * Schema: `{ nextShowAt: epoch_ms, skipCount: number }`
 */
const SKIP_KEY = 'yannis-onboarding-nudge-skipped';

interface SkipState {
  /** Epoch ms — modal is suppressed until `Date.now() >= nextShowAt`. */
  nextShowAt: number;
  /** How many times the user has skipped — drives the doubling delay. */
  skipCount: number;
}

/** Days until the next prompt = `2 ** skipCount`, capped so we don't reach
 *  silly numbers. Sequence: 2, 4, 8, 16, 30 (capped), 30, 30, … */
const MAX_SKIP_DAYS = 30;
function daysUntilNextNudge(skipCount: number): number {
  if (skipCount < 1) return 2;
  return Math.min(2 ** skipCount, MAX_SKIP_DAYS);
}

function readSkipState(): SkipState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SKIP_KEY);
    if (!raw) return null;
    // Legacy: pre-2026-05 the key held the literal string '1' from the
    // sessionStorage era. Treat it as "skipped recently" with the smallest
    // backoff so existing skip preferences carry forward without surprise.
    if (raw === '1') {
      return { nextShowAt: Date.now() + daysUntilNextNudge(1) * 86_400_000, skipCount: 1 };
    }
    const parsed = JSON.parse(raw) as Partial<SkipState>;
    if (typeof parsed?.nextShowAt !== 'number' || typeof parsed?.skipCount !== 'number') {
      return null;
    }
    return parsed as SkipState;
  } catch {
    return null;
  }
}

function writeSkipState(state: SkipState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SKIP_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota) — fail silently. The user
    // will just see the prompt again next login; acceptable.
  }
}

function clearSkipState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SKIP_KEY);
  } catch {
    // ignored
  }
}

interface OnboardingNudgeProps {
  /** Whether to render at all — the layout decides based on session state. */
  enabled: boolean;
}

/**
 * Phase 22 — login-time nudge encouraging staff to complete their onboarding.
 *
 * Behaviour:
 *   • On mount, fetches the caller's onboarding status from `/trpc/onboarding.get`.
 *   • If status is NOT_STARTED or IN_PROGRESS, opens a modal with two CTAs:
 *       - "Start" → navigates to `/admin/onboarding` AND clears the skip cooldown
 *         (they're engaging — fresh slate next time).
 *       - "Skip"  → dismisses the popup AND extends the cooldown using an
 *         exponential-backoff schedule (CEO directive 2026-05-10): the first
 *         skip suppresses for 2 days, the next for 4, then 8, 16, capped at 30.
 *         Stored in `localStorage` so it survives logouts.
 *   • Suppressed entirely when the caller is mirroring another user (we read the
 *     `data-mirror` attribute on `<html>` set by `DashboardLayout`).
 *   • The popup never blocks anything — accounts stay ACTIVE regardless of
 *     onboarding state. This is purely an encouragement.
 *   • Uses `LoginModalGate` so the dismissible push prompt in the layout never
 *     stacks on top of this modal — push waits until this flow is clear.
 */
export function OnboardingNudge({ enabled }: OnboardingNudgeProps) {
  const [open, setOpen] = useState(false);
  const { setOnboardingGate } = useLoginModalGate();

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    // Don't pester admins while they're impersonating someone else.
    if (document.documentElement.dataset['mirror'] === '1') return;
    // Exponential-backoff cooldown — if the user skipped within the current
    // window, suppress the modal entirely and let the layout move on.
    const skip = readSkipState();
    if (skip && Date.now() < skip.nextShowAt) {
      setOnboardingGate('clear');
      return;
    }

    let cancelled = false;
    // Resource route on the web app — the API lives on a different origin in
    // both dev and prod, so the browser can't hit `/trpc/...` directly.
    // `/api/onboarding-status` proxies server-side via apiRequest.
    fetch('/api/onboarding-status', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json()) as { status?: string | null };
        return body?.status ?? null;
      })
      .then((status) => {
        if (cancelled) return;
        if (status === 'NOT_STARTED' || status === 'IN_PROGRESS') {
          setOpen(true);
          setOnboardingGate('blocking');
        } else {
          setOnboardingGate('clear');
        }
      })
      .catch(() => {
        if (!cancelled) setOnboardingGate('clear');
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, setOnboardingGate]);

  const releaseGate = () => {
    setOpen(false);
    setOnboardingGate('clear');
  };

  const handleSkip = () => {
    // Exponential-backoff cooldown: 2, 4, 8, 16, 30, 30, … days. The
    // existing `skipCount` is incremented so the doubling continues across
    // logouts; only `Start` (or a server-side status flip) resets it.
    const previous = readSkipState();
    const nextSkipCount = (previous?.skipCount ?? 0) + 1;
    const nextShowAt = Date.now() + daysUntilNextNudge(nextSkipCount) * 86_400_000;
    writeSkipState({ nextShowAt, skipCount: nextSkipCount });
    releaseGate();
  };

  const handleStart = () => {
    // User is engaging — wipe the cooldown so the next prompt (if their
    // status hasn't moved out of NOT_STARTED / IN_PROGRESS by then) starts
    // the doubling sequence over from 2 days.
    clearSkipState();
    releaseGate();
  };

  return (
    <Modal
      open={open}
      onClose={handleSkip}
      maxWidth="max-w-md"
      role="dialog"
      contentClassName="p-6 space-y-4"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/30">
          <svg
            className="h-5 w-5 text-brand-600 dark:text-brand-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-app-fg">Complete your onboarding</h2>
          <p className="mt-1 text-sm text-app-fg-muted leading-relaxed">
            Help HR keep your records up to date — gender, date of birth, proof of
            address, and two guarantors. You can save and come back to it anytime.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 text-xs text-app-fg-muted">
        This doesn't affect your access — your account stays active either way. It
        only takes a few minutes.
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
          Skip for now
        </Button>
        <Link to="/admin/onboarding" className="btn-primary btn-sm" onClick={handleStart}>
          Start
        </Link>
      </div>
    </Modal>
  );
}
