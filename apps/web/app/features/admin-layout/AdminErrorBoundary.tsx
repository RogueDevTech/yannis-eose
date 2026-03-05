import { useEffect, useState } from 'react';
import { Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import type { AdminErrorBoundaryProps } from './types';

const AUTO_REFRESH_SECONDS = 10;

/** Sync theme from localStorage when error boundary mounts (DashboardLayout may not have run) */
function useThemeSync() {
  useEffect(() => {
    try {
      const t = localStorage.getItem('yannis_theme');
      if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {
      // ignore
    }
  }, []);
}

export function AdminErrorBoundary({ error: _error, isResponse, status, errorData }: AdminErrorBoundaryProps) {
  useThemeSync();
  const is401 = status === 401;
  const is403 = status === 403;
  const is404 = status === 404;

  // Session expired — redirect to login
  if (is401) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-warning-50 dark:bg-warning-700/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Session Expired</h1>
          <p className="mt-2 text-sm text-surface-800 dark:text-surface-200">
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
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-danger-50 dark:bg-danger-700/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Access Denied</h1>
          <p className="mt-2 text-sm text-surface-800 dark:text-surface-200">
            You don't have permission to access this page.
          </p>
          <Link to="/admin" className="mt-4 inline-block btn-primary">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  // 404 — page not found
  if (is404) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-700 dark:text-surface-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Page Not Found</h1>
          <p className="mt-2 text-sm text-surface-800 dark:text-surface-200">
            The page you're looking for doesn't exist or has been moved.
          </p>
          <Link to="/admin" className="mt-4 inline-block btn-primary">Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  // Generic server error — with countdown progress bar and auto-refresh
  return (
    <GenericErrorWithProgressBar
      errorData={isResponse ? errorData : undefined}
      onRefresh={() => window.location.reload()}
    />
  );
}

function GenericErrorWithProgressBar({
  errorData,
  onRefresh,
}: {
  errorData?: unknown;
  onRefresh: () => void;
}) {
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);

  useEffect(() => {
    if (countdown <= 0) {
      onRefresh();
      return;
    }
    const id = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(id);
  }, [countdown, onRefresh]);

  const progressPercent = (countdown / AUTO_REFRESH_SECONDS) * 100;

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-6">
      <div className="text-center max-w-md w-full">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-danger-50 dark:bg-danger-700/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-surface-900 dark:text-white">Something Went Wrong</h1>
        <p className="mt-2 text-sm text-surface-800 dark:text-surface-200">
          An unexpected error occurred. Refreshing automatically in {countdown}s, or use the buttons below.
        </p>
        {errorData != null ? (
          <p className="mt-2 text-xs text-surface-700 dark:text-surface-300 font-mono bg-surface-100 dark:bg-surface-800 rounded p-2 text-left overflow-auto max-h-24">
            {typeof errorData === 'string' ? errorData : JSON.stringify(errorData)}
          </p>
        ) : null}
        <div className="mt-4 w-full h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={AUTO_REFRESH_SECONDS - countdown} aria-valuemin={0} aria-valuemax={AUTO_REFRESH_SECONDS} aria-label="Auto-refresh countdown">
          <div
            className="h-full bg-brand-500 dark:bg-brand-400 rounded-full transition-all duration-1000 ease-linear origin-left"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-4 flex gap-2 justify-center">
          <Button variant="primary" onClick={onRefresh}>
            Refresh Now
          </Button>
          <Link to="/admin" className="btn-secondary">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
