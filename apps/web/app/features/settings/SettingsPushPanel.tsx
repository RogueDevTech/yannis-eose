import { useState, useEffect, useMemo } from 'react';
import { Button } from '~/components/ui/button';
import { usePushSubscription } from '~/hooks/usePushSubscription';
import { detectBrowser, getDeniedSteps } from '~/lib/push-denied-steps';

/**
 * Device-level Web Push subscription (browser permission + service worker).
 * Shown on Settings → Push notifications for all authenticated users.
 */
export function SettingsPushPanel() {
  const {
    isSupported,
    isSubscribed,
    permissionState,
    subscribe,
    unsubscribe,
    isIOS,
    isStandalone,
  } = usePushSubscription();

  const browser = useMemo(() => detectBrowser(), []);
  const deniedSteps = useMemo(() => getDeniedSteps(browser), [browser]);

  const [subscribing, setSubscribing] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const [livePermission, setLivePermission] = useState<NotificationPermission | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setLivePermission(Notification.permission);
    }
  }, [permissionState, isSubscribed]);

  async function handleEnable() {
    setSubscribing(true);
    setPushError(null);
    try {
      await subscribe();
    } catch {
      setPushError(
        'Browser blocked the permission request. Click the lock icon in the address bar → Notifications → Allow, then try again.',
      );
    } finally {
      setSubscribing(false);
    }
  }

  async function handleDisable() {
    setUnsubscribing(true);
    setPushError(null);
    try {
      await unsubscribe();
    } catch {
      setPushError('Could not turn off push on the server. Try again, or revoke site notifications in your browser settings.');
    } finally {
      setUnsubscribing(false);
    }
  }

  const permission = livePermission ?? permissionState;
  const isDenied = permission === 'denied';
  const pushActive = isSubscribed;
  const iosNotInstalled = isIOS && !isStandalone;

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b border-app-border px-4 py-3 sm:gap-3 sm:px-5 sm:py-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/40 sm:h-9 sm:w-9">
            <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-app-fg">Push on this device</p>
            <p className="mt-0.5 text-xs leading-snug text-app-fg-muted">
              Alerts for orders, messages, and updates when the app is in the background
            </p>
          </div>
          {isDenied ? (
            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-danger-50 dark:bg-transparent dark:ring-1 dark:ring-inset dark:ring-danger-500/55 px-2.5 py-0.5 text-xs font-medium text-danger-700 dark:text-danger-300">
              Blocked
            </span>
          ) : pushActive ? (
            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-success-50 dark:bg-success-900/30 px-2.5 py-0.5 text-xs font-medium text-success-700 dark:text-success-400">
              <span className="w-1.5 h-1.5 rounded-full bg-success-500 flex-shrink-0" />
              Active
            </span>
          ) : isSupported ? (
            <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-app-hover px-2.5 py-0.5 text-xs font-medium text-app-fg-muted">
              Off
            </span>
          ) : null}
        </div>

        <div className="space-y-3 px-4 py-3 sm:px-5 sm:py-3.5">
          {!isSupported && !iosNotInstalled && (
            <p className="text-sm leading-snug text-app-fg-muted">
              Push is not supported in this browser. Try Chrome, Edge, or Firefox.
            </p>
          )}

          {iosNotInstalled && (
            <div className="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 dark:border-warning-700/50 dark:bg-warning-900/20">
              <p className="text-sm font-medium text-warning-800 dark:text-warning-300">Add to Home Screen first</p>
              <p className="mt-1 text-xs leading-snug text-warning-700 dark:text-warning-400">
                On iPhone or iPad, use Share → Add to Home Screen, then open the app from your home screen and return here to enable push.
              </p>
            </div>
          )}

          {pushActive && (
            <p className="text-sm leading-snug text-app-fg-muted">
              Push is enabled on this device. You will receive alerts even when the app is in the background.
            </p>
          )}

          {isDenied && (
            <div className="space-y-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 dark:border-danger-500/50 dark:bg-transparent">
              <p className="text-sm font-medium text-danger-800 dark:text-danger-300">Notifications are blocked</p>
              <ol className="space-y-1.5">
                {deniedSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm leading-snug text-danger-800 dark:text-app-fg">
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-danger-300 bg-danger-100 text-xs font-semibold text-danger-700 dark:border-danger-600 dark:bg-transparent dark:text-danger-400">
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

          {!pushActive && !isDenied && isSupported && !iosNotInstalled && (
            <p className="text-sm leading-snug text-app-fg-muted">
              Allow push to get real-time alerts for new orders, status changes, and team messages when you are not on this page.
            </p>
          )}

          {pushError && (
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-2.5 py-1.5 dark:border-danger-500/50 dark:bg-transparent">
              <p className="text-xs text-danger-700 dark:text-app-fg">{pushError}</p>
            </div>
          )}

          {isSupported && pushActive && !iosNotInstalled && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={unsubscribing}
              loadingText="Turning off…"
              onClick={() => void handleDisable()}
            >
              Turn off push on this device
            </Button>
          )}

          {isSupported && !pushActive && !isDenied && !iosNotInstalled && (
            <Button type="button" variant="primary" size="sm" loading={subscribing} loadingText="Enabling…" onClick={() => void handleEnable()}>
              Enable push notifications
            </Button>
          )}
        </div>
      </div>

      <div className="card p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-hover sm:h-9 sm:w-9">
            <svg className="w-5 h-5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-app-fg">In-app notifications</p>
            <p className="mt-0.5 text-xs leading-snug text-app-fg-muted">
              While you are logged in, alerts also appear under the bell icon at the top of the page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
