import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import type { AdminErrorBoundaryProps } from './types';
import { applyAppTheme, readStoredThemeId } from '~/lib/theme';
import {
  getNetworkErrorCopy,
  isNetworkErrorLike,
  normalizeRouteErrorData,
} from '~/lib/network-error';

/**
 * Auto-refresh window for the connection-issue modal. Set generously so users on
 * slow networks have time to read, decide, and act before the page reloads on them.
 */
const AUTO_REFRESH_SECONDS = 30;

/** Sync theme from localStorage when error boundary mounts (DashboardLayout may not have run) */
function useThemeSync() {
  useEffect(() => {
    try {
      applyAppTheme(readStoredThemeId());
    } catch {
      applyAppTheme('system');
    }
  }, []);
}

export function AdminErrorBoundary({
  error: _error,
  isResponse,
  status,
  errorData,
  homePath = '/admin',
  homeLabel = 'Dashboard',
}: AdminErrorBoundaryProps) {
  useThemeSync();
  const is401 = status === 401;
  const is403 = status === 403;
  const is404 = status === 404;
  const homeButtonLabel = `Back to ${homeLabel}`;

  // Session expired — redirect to login
  if (is401) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-canvas p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning-50 dark:bg-warning-700/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-app-fg">Session Expired</h1>
          <p className="mt-2 text-sm text-app-fg-muted">
            Your session has expired. Please sign in again to continue.
          </p>
          <Link to="/auth" className="mt-4 inline-block btn-primary">Sign In</Link>
        </div>
      </div>
    );
  }

  // Forbidden — role check failed
  if (is403) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-canvas p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-danger-50 dark:bg-danger-700/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-app-fg">Access Denied</h1>
          <p className="mt-2 text-sm text-app-fg-muted">
            You don't have permission to access this page.
          </p>
          <Link to={homePath} className="mt-4 inline-block btn-primary">{homeButtonLabel}</Link>
        </div>
      </div>
    );
  }

  // 404 — page not found
  if (is404) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-canvas p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-app-hover border border-app-border flex items-center justify-center">
            <svg className="w-8 h-8 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-app-fg">Page Not Found</h1>
          <p className="mt-2 text-sm text-app-fg-muted">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <Link to={homePath} className="mt-4 inline-block btn-primary">{homeButtonLabel}</Link>
        </div>
      </div>
    );
  }

  // Network / transient server error — render as a Modal overlay on top of a
  // minimal "page couldn't load" placeholder so the admin shell (sidebar + header,
  // already preserved by the parent layout) stays interactive underneath.
  const normalizedPayload = isResponse ? normalizeRouteErrorData(errorData) : _error;
  const isNetworkIssue = isNetworkErrorLike(normalizedPayload, status);

  if (isNetworkIssue) {
    return (
      <NetworkErrorModalLayout
        payload={normalizedPayload}
        status={status}
        homePath={homePath}
        onRefresh={() => window.location.reload()}
      />
    );
  }

  // Non-network unexpected error — keep the previous full-page treatment so the
  // user gets the dramatic "Something went wrong" hint with the technical detail
  // visible and the auto-refresh countdown running.
  return (
    <GenericErrorWithProgressBar
      errorData={isResponse ? errorData : undefined}
      variant="server"
      homePath={homePath}
      homeLabel={homeLabel}
      onRefresh={() => window.location.reload()}
    />
  );
}

/**
 * Network / connection-issue layout — a modal overlay on top of a placeholder content
 * area. Rendered in place of the failed route's `<Outlet>` content; the parent admin
 * route's `<DashboardLayout>` (sidebar + header) stays mounted around it.
 *
 * The modal:
 * - Shows a code-specific title + description (timeout vs unreachable vs 5xx vs rate-limited).
 * - Auto-refreshes after `AUTO_REFRESH_SECONDS` so a transient blip self-resolves.
 * - Lets the user choose: Refresh now (force reload), Go back (return to the previous
 *   page they navigated from — typically still mounted in browser history), or Dashboard.
 * - Renders as `role="alertdialog"` and is NOT dismissable by clicking the backdrop —
 *   the user must pick an action so we don't leave them on an empty page.
 */
function NetworkErrorModalLayout({
  payload,
  status,
  homePath,
  onRefresh,
}: {
  payload: unknown;
  status: number;
  homePath: string;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [backLoading, setBackLoading] = useState(false);

  useEffect(() => {
    if (countdown <= 0) {
      onRefresh();
      return;
    }
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown, onRefresh]);

  const copy = getNetworkErrorCopy(payload, status);
  const progressPercent = (countdown / AUTO_REFRESH_SECONDS) * 100;
  const showCode = copy.code != null;
  const showUpstream = copy.upstreamStatus != null;

  const goBack = () => {
    setBackLoading(true);
    // -1 returns to whichever entry the user was on before this failed navigation.
    // Falls back to the surface's home (/admin, /tpl, /rider, ...) when the user
    // landed here directly via a deep link with no history to step back through.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(homePath);
    }
  };

  return (
    <>
      {/* Placeholder where the failed route's content would have rendered. Kept
          intentionally light so the modal is the visual focus. */}
      <div className="min-h-[60vh] flex items-center justify-center p-6" aria-hidden>
        <div className="text-center max-w-sm opacity-60">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-app-hover border border-app-border flex items-center justify-center">
            <svg className="w-6 h-6 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3v.008m-9-3.758a9 9 0 1118 0 9 9 0 01-18 0z" />
            </svg>
          </div>
          <p className="text-sm text-app-fg-muted">This page couldn’t load right now.</p>
        </div>
      </div>

      <Modal
        open
        onClose={() => {
          /* non-dismissable — user picks an action below */
        }}
        role="alertdialog"
        aria-labelledby="network-error-title"
        aria-describedby="network-error-description"
        backdropBlur
        maxWidth="max-w-md"
        contentClassName="p-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-warning-50 dark:bg-warning-700/20 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="network-error-title" className="text-base font-semibold text-app-fg">
              {copy.title}
            </h2>
            <p id="network-error-description" className="mt-1 text-sm text-app-fg-muted">
              {copy.description}
            </p>
            {(showCode || showUpstream) && (
              <p className="mt-2 inline-flex flex-wrap items-center gap-2 text-mini font-mono text-app-fg-muted">
                {showCode ? (
                  <span className="rounded bg-app-hover border border-app-border px-1.5 py-0.5">
                    {copy.code}
                  </span>
                ) : null}
                {showUpstream ? (
                  <span className="rounded bg-app-hover border border-app-border px-1.5 py-0.5">
                    HTTP {copy.upstreamStatus}
                  </span>
                ) : null}
              </p>
            )}
          </div>
        </div>

        <div
          className="mt-4 w-full h-1.5 bg-app-border rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={AUTO_REFRESH_SECONDS - countdown}
          aria-valuemin={0}
          aria-valuemax={AUTO_REFRESH_SECONDS}
          aria-label="Auto-retry countdown"
        >
          <div
            className="h-full bg-brand-500 dark:bg-brand-400 rounded-full transition-all duration-1000 ease-linear origin-left"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-1.5 text-mini text-app-fg-muted">
          Retrying automatically in {countdown}s.
        </p>

        <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={refreshLoading || backLoading}
            onClick={goBack}
          >
            Go back
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={refreshLoading}
            loadingText="Refreshing…"
            disabled={backLoading}
            onClick={() => {
              setRefreshLoading(true);
              onRefresh();
            }}
          >
            Try again
          </Button>
        </div>
      </Modal>
    </>
  );
}

function GenericErrorWithProgressBar({
  errorData,
  variant,
  onRefresh,
  homePath,
  homeLabel,
}: {
  errorData?: unknown;
  /**
   * Currently always `'server'` — the network branch was split out into
   * `<NetworkErrorModalLayout>` so connection issues stay non-disruptive.
   * Type kept open in case a future caller wants the dramatic full-page treatment
   * for a different category.
   */
  variant: 'server';
  onRefresh: () => void;
  homePath: string;
  homeLabel: string;
}) {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  useEffect(() => {
    if (countdown <= 0) {
      onRefresh();
      return;
    }
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown, onRefresh]);

  const progressPercent = (countdown / AUTO_REFRESH_SECONDS) * 100;
  const title = 'Something Went Wrong';
  const description = `An unexpected error occurred. Refreshing automatically in ${countdown}s, or use the buttons below.`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-canvas p-6">
      <div className="text-center max-w-md w-full">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-danger-50 dark:bg-danger-700/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-app-fg">{title}</h1>
        <p className="mt-2 text-sm text-app-fg-muted">{description}</p>
        {errorData != null ? (
          <p className="mt-2 text-xs text-app-fg-muted font-mono bg-app-hover border border-app-border rounded p-2 text-left overflow-auto max-h-24">
            {typeof errorData === 'string' ? errorData : JSON.stringify(errorData)}
          </p>
        ) : null}
        <div className="mt-4 w-full h-2 bg-app-border rounded-full overflow-hidden" role="progressbar" aria-valuenow={AUTO_REFRESH_SECONDS - countdown} aria-valuemin={0} aria-valuemax={AUTO_REFRESH_SECONDS} aria-label="Auto-refresh countdown">
          <div
            className="h-full bg-brand-500 dark:bg-brand-400 rounded-full transition-all duration-1000 ease-linear origin-left"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-4 flex gap-2 justify-center">
          <Button
            variant="primary"
            loading={refreshLoading}
            loadingText="Refreshing…"
            disabled={dashboardLoading}
            onClick={() => {
              setRefreshLoading(true);
              onRefresh();
            }}
          >
            Refresh Now
          </Button>
          <Button
            variant="secondary"
            loading={dashboardLoading}
            loadingText="Opening…"
            disabled={refreshLoading}
            onClick={() => {
              setDashboardLoading(true);
              navigate(homePath);
            }}
          >
            Back to {homeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
