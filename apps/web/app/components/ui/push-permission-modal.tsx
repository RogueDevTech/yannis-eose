import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '~/components/ui/button';
import { detectBrowser, getDeniedSteps } from '~/lib/push-denied-steps';

/**
 * Returns true if the blocking modal should be shown:
 * - Push is supported in this browser
 * - Permission is not yet granted
 */
export function shouldShowPushModal(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission === 'granted') return false;
  return true;
}

export function isPushDenied(): boolean {
  if (typeof window === 'undefined') return false;
  return 'Notification' in window && Notification.permission === 'denied';
}

interface PushPermissionModalProps {
  onEnable: () => Promise<void>;
  denied?: boolean;
}

export function PushPermissionModal({ onEnable, denied = false }: PushPermissionModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browser = useMemo(() => detectBrowser(), []);
  const deniedSteps = useMemo(() => getDeniedSteps(browser), [browser]);

  useEffect(() => {
    setMounted(true);
    // Prevent body scroll while modal is open
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Block Escape key — this modal is non-dismissible
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  async function handleEnable() {
    if (denied) return;
    setLoading(true);
    setError(null);
    try {
      await onEnable();
    } catch {
      setError('Permission was blocked. Follow the steps below to allow notifications, then reload.');
      setLoading(false);
    }
  }

  function handleLogout() {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/auth/logout';
    document.body.appendChild(form);
    form.submit();
  }

  if (!mounted || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] min-h-dvh w-full">
      {/* Backdrop — no onClick, this is blocking */}
      <div className="absolute inset-0 min-h-dvh w-full bg-black/60 backdrop-blur-sm" aria-hidden />

      {/* Centred panel */}
      <div className="relative z-[1] flex min-h-dvh w-full items-end md:items-center justify-center p-0 md:p-4">
        <div
          className={[
            'w-full md:max-w-md',
            'rounded-t-2xl md:rounded-xl',
            'bg-app-elevated shadow-xl',
            'pb-[max(2.5rem,env(safe-area-inset-bottom))] md:pb-0',
            'max-md:animate-slide-up-from-bottom md:animate-fade-in',
            'border-2',
            denied
              ? 'border-danger-200 dark:border-danger-600/50'
              : 'border-primary-200 dark:border-primary-800',
          ].join(' ')}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className={[
              'flex items-center gap-3 px-4 pt-4 pb-3 sm:px-5 sm:pt-5 border-b',
              denied
                ? 'border-danger-100 dark:border-danger-900/50'
                : 'border-primary-100 dark:border-primary-900/50',
            ].join(' ')}
          >
            <div
              className={[
                'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
                denied
                  ? 'bg-danger-100 dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-danger-500/50'
                  : 'bg-primary-100 dark:bg-primary-900/50',
              ].join(' ')}
            >
              <svg
                className={[
                  'w-5 h-5',
                  denied
                    ? 'text-danger-600 dark:text-danger-400'
                    : 'text-primary-600 dark:text-primary-400',
                ].join(' ')}
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                {denied ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                  />
                )}
              </svg>
            </div>
            <h3
              className={[
                'text-lg font-semibold',
                denied
                  ? 'text-danger-800 dark:text-danger-200'
                  : 'text-primary-700 dark:text-primary-300',
              ].join(' ')}
            >
              {denied ? 'Notifications are blocked' : 'Notifications are required'}
            </h3>
          </div>

          {/* Body */}
          <div className="px-4 sm:px-5 py-4 space-y-4">
            <p className="text-sm text-app-fg-muted">
              {denied
                ? 'You previously blocked notifications. Yannis EOSE requires push notifications to function — you cannot use the platform without them.'
                : 'Yannis EOSE requires push notifications to function. You cannot use the platform without enabling them.'}
            </p>

            {denied && (
              <div className="rounded-lg border border-app-border bg-app-hover px-4 py-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                  How to unblock notifications
                </p>
                <ol className="space-y-2">
                  {deniedSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-app-fg">
                      <span className="mt-px shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-app-elevated border border-app-border text-xs font-semibold text-app-fg-muted">
                        {i + 1}
                      </span>
                      <span>
                        <span className="mr-1">{step.icon}</span>
                        {step.text}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-danger-50 dark:bg-transparent border border-danger-200 dark:border-danger-500/50 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-app-fg">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-4 sm:px-5 pb-4 sm:pb-5 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={handleLogout}
              disabled={loading}
            >
              Log Out
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleEnable}
              loading={loading}
              disabled={denied}
            >
              {denied ? 'Fix in Browser Settings' : 'Enable Notifications'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
