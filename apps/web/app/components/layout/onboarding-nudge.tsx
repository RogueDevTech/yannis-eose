import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { useLoginModalGate } from '~/contexts/login-modal-gate';

const SKIP_KEY = 'yannis-onboarding-nudge-skipped';

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
 *       - "Start" → navigates to `/admin/onboarding`
 *       - "Skip"  → dismisses the popup AND writes `yannis-onboarding-nudge-skipped`
 *                  to sessionStorage so the user isn't pestered every page-nav.
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
    // User chose Skip earlier this session — respect that until next login.
    if (window.sessionStorage.getItem(SKIP_KEY) === '1') {
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
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SKIP_KEY, '1');
    }
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
        <Link to="/admin/onboarding" className="btn-primary btn-sm" onClick={releaseGate}>
          Start
        </Link>
      </div>
    </Modal>
  );
}
