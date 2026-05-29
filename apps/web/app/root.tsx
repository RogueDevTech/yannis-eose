import type { LinksFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
  useLoaderData,
  useNavigate,
  useRouteError,
} from '@remix-run/react';
import { PwaInstallPrompt } from '~/components/ui/pwa-install-prompt';
import { dismissInstallPromotion, isInstallPromotionDismissed } from '~/lib/install-promotion-dismiss';
import { usePwaInstall } from '~/hooks/usePwaInstall';
import { useServerAppThemeSync } from '~/hooks/useServerAppThemeSync';
import { useServerFontScaleSync } from '~/hooks/useServerFontScaleSync';
import { ScrollToTopButton } from '~/components/ui/scroll-to-top-button';
import stylesheet from '~/tailwind.css?url';
import { getThemeBootScript } from '~/lib/theme';
import { getFontScaleBootScript } from '~/lib/font-scale';
import { useScrollToTopOnRouteChange } from '~/hooks/useScrollToTopOnRouteChange';
import {
  getNetworkErrorCopy,
  isNetworkErrorLike,
  normalizeRouteErrorData,
} from '~/lib/network-error';

declare global {
  interface Window {
    __playNotificationSound?: () => void;
    __ENV: {
      API_URL: string;
      EDGE_WORKER_URL: string;
      OBJECT_STORAGE_PROVIDER?: string;
      OBJECT_STORAGE_BUCKET: string;
      OBJECT_STORAGE_PUBLIC_BASE_URL?: string;
      ASSET_ENV_PREFIX: string;
      VAPID_PUBLIC_KEY?: string;
    };
  }
}

export async function loader() {
  return json({
    ENV: {
      // PUBLIC_API_URL is the browser-reachable API URL (e.g. https://api-yannis.roguedevtech.com).
      // Empty string: client uses `getBrowserApiBaseUrl()` → same-origin (Vite /trpc + /socket.io proxy in dev).
      API_URL: process.env.PUBLIC_API_URL ?? process.env.API_URL ?? '',
      EDGE_WORKER_URL: process.env.EDGE_WORKER_URL ?? '',
      OBJECT_STORAGE_PROVIDER: process.env.OBJECT_STORAGE_PROVIDER ?? '',
      OBJECT_STORAGE_BUCKET:
        process.env.OBJECT_STORAGE_BUCKET ?? process.env.GCS_BUCKET ?? process.env.S3_BUCKET ?? '',
      OBJECT_STORAGE_PUBLIC_BASE_URL:
        process.env.OBJECT_STORAGE_PUBLIC_BASE_URL ?? process.env.GCS_PUBLIC_BASE_URL ?? '',
      ASSET_ENV_PREFIX: process.env.ASSET_ENV_PREFIX ?? 'dev',
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
    },
  });
}

const THEME_SCRIPT = getThemeBootScript();
const FONT_SCALE_SCRIPT = getFontScaleBootScript();

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
  { rel: 'icon', type: 'image/png', href: '/assets/favicon-32.png', sizes: '32x32' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
  { rel: 'apple-touch-icon', href: '/assets/icon-180.png', sizes: '180x180' },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)',
  },
  {
    rel: 'apple-touch-startup-image',
    href: '/assets/icon-512-maskable.png',
    media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)',
  },
];

export default function App() {
  const { ENV } = useLoaderData<typeof loader>();
  const location = useLocation();
  const { install, canPromptInstall, isIosManualInstall } = usePwaInstall();
  const envScript = JSON.stringify(ENV).replace(/<\/script>/gi, '<\\/script>');
  const [isBooting, setIsBooting] = useState(true);
  const [installPromptOpen, setInstallPromptOpen] = useState(false);
  const isAuthPage = location.pathname.startsWith('/auth');
  const isLoggedInArea =
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/hr') ||
    location.pathname.startsWith('/tpl') ||
    location.pathname.startsWith('/rider');

  useServerAppThemeSync(isLoggedInArea);
  useServerFontScaleSync(isLoggedInArea);
  useScrollToTopOnRouteChange();

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setIsBooting(false);
    });
    // We rendered successfully — any retry counter from a prior boundary
    // fire on this tab is now stale.
    clearAutoRetryAttempt();

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, []);

  useEffect(() => {
    if (isAuthPage || !isLoggedInArea || !canPromptInstall) {
      setInstallPromptOpen(false);
      return;
    }
    if (isInstallPromotionDismissed()) {
      setInstallPromptOpen(false);
      return;
    }
    setInstallPromptOpen(true);
  }, [canPromptInstall, isAuthPage, isLoggedInArea]);

  return (
    <html lang="en" className="h-full" data-app-theme="light" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1565C0" />
        <meta name="description" content="Yannis EOSE — Enterprise Operations & Sales Engine" />
        <meta property="og:title" content="Yannis EOSE" />
        <meta property="og:description" content="Enterprise Operations & Sales Engine" />
        <meta property="og:image" content="/assets/yannis-logo-white-bg.png" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content="Yannis EOSE" />
        <meta name="twitter:description" content="Enterprise Operations & Sales Engine" />
        <meta name="twitter:image" content="/assets/yannis-logo-white-bg.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Yannis" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: FONT_SCALE_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        {isBooting ? (
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0f172a]"
            aria-label="Loading Yannis EOSE"
          >
            <img
              src="/assets/icon-192.png"
              alt="Yannis EOSE logo"
              className="h-20 w-20 rounded-2xl shadow-xl"
            />
          </div>
        ) : null}
        <Outlet />
        <PwaInstallPrompt
          open={installPromptOpen}
          isIosInstructions={isIosManualInstall}
          onInstall={async () => {
            const accepted = await install();
            if (accepted) {
              dismissInstallPromotion();
              setInstallPromptOpen(false);
            }
          }}
          onClose={() => {
            dismissInstallPromotion();
            setInstallPromptOpen(false);
          }}
        />
        <ScrollToTopButton />
        <ScrollRestoration getKey={(loc) => loc.key} />
        <script dangerouslySetInnerHTML={{ __html: `window.__ENV = ${envScript};` }} />
        <Scripts />
        <script
          dangerouslySetInnerHTML={{
            __html: `
          if ('serviceWorker' in navigator) {
            var isLocalDevHost =
              window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1';
            if (isLocalDevHost) {
              // Dev guard: avoid stale cached JS chunks from service worker during HMR.
              // A stale SW can keep serving old assets and leave the app stuck on boot splash.
              navigator.serviceWorker.getRegistrations().then(function(regs) {
                regs.forEach(function(reg) { reg.unregister(); });
              });
              if (window.caches && typeof window.caches.keys === 'function') {
                window.caches.keys().then(function(keys) {
                  keys.forEach(function(key) { window.caches.delete(key); });
                });
              }
            } else {
              window.addEventListener('load', function() {
              // updateViaCache:'none' — never let the HTTP cache serve a stale
              // /sw.js, so a new deploy's service worker is always detected.
              navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(function(reg) {
                // Re-surface the prompt whenever a waiting worker exists. We want
                // the user to ALWAYS see "Update Required" while one is pending —
                // not just on first detection — so they feel the update is being
                // applied rather than wondering if anything's happening.
                function surfaceIfWaiting() {
                  if (reg.waiting && navigator.serviceWorker.controller) {
                    window.dispatchEvent(new CustomEvent('yannis:sw-update-ready'));
                  }
                }
                // If there's already a waiting worker on load (e.g. tab was kept open), fire immediately
                surfaceIfWaiting();
                reg.addEventListener('updatefound', function() {
                  var newWorker = reg.installing;
                  if (newWorker) {
                    newWorker.addEventListener('statechange', function() {
                      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New SW is waiting — prompt user to update
                        window.dispatchEvent(new CustomEvent('yannis:sw-update-ready'));
                      }
                    });
                  }
                });
                // A backgrounded PWA only checks for a new service worker on
                // cold start. Re-check every time the app returns to the
                // foreground so a long-lived installed session still picks up
                // deploys without the user fully quitting the app. Also
                // re-surface the prompt if a waiting worker already exists —
                // the foreground return is exactly when the user is most likely
                // to act on it.
                document.addEventListener('visibilitychange', function() {
                  if (document.visibilityState === 'visible') {
                    reg.update().catch(function() {});
                    surfaceIfWaiting();
                  }
                });
                // Foreground heartbeat: every 60s re-check for an update AND
                // re-surface the prompt if one is already waiting. Keeps a
                // long-lived foreground tab from going stale or losing the
                // modal between user interactions.
                setInterval(function() {
                  reg.update().catch(function() {});
                  surfaceIfWaiting();
                }, 60000);
              });
              // Listen for sync completion messages from SW
              navigator.serviceWorker.addEventListener('message', function(event) {
                if (event.data && event.data.type === 'SYNC_COMPLETE') {
                  window.dispatchEvent(new CustomEvent('yannis:sync', { detail: event.data }));
                }
                if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
                  window.location.href = event.data.url;
                }
                if (event.data && event.data.type === 'PLAY_NOTIFICATION_SOUND' && typeof window.__playNotificationSound === 'function') {
                  window.__playNotificationSound();
                }
                if (event.data && event.data.type === 'PUSH_NOTIFICATION_RECEIVED') {
                  // Refresh the in-app notification bell so the unread count updates immediately
                  window.dispatchEvent(new CustomEvent('yannis:push-received', { detail: event.data }));
                }
              });
              });
            }
          }
        `,
          }}
        />
      </body>
    </html>
  );
}

/**
 * Auto-retry config for network-type loader failures. Delays grow so the
 * server has a chance to recover between attempts; max attempts capped so
 * we stop hammering after ~21s total if it stays down.
 */
const AUTO_RETRY_DELAYS_S = [3, 6, 12] as const;
const MAX_AUTO_RETRIES = AUTO_RETRY_DELAYS_S.length;
const AUTO_RETRY_STORAGE_KEY = 'yannis:auto-retry';
const AUTO_RETRY_STORAGE_WINDOW_MS = 60_000;

function readPriorAutoRetryAttempt(pathname: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(AUTO_RETRY_STORAGE_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw) as { path?: string; count?: number; at?: number };
    if (data.path !== pathname) return 0;
    if (typeof data.at !== 'number' || Date.now() - data.at > AUTO_RETRY_STORAGE_WINDOW_MS) {
      window.sessionStorage.removeItem(AUTO_RETRY_STORAGE_KEY);
      return 0;
    }
    return typeof data.count === 'number' ? Math.max(0, Math.min(MAX_AUTO_RETRIES, data.count)) : 0;
  } catch {
    return 0;
  }
}

function persistAutoRetryAttempt(pathname: string, count: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      AUTO_RETRY_STORAGE_KEY,
      JSON.stringify({ path: pathname, count, at: Date.now() }),
    );
  } catch {}
}

export function clearAutoRetryAttempt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(AUTO_RETRY_STORAGE_KEY);
  } catch {}
}

/**
 * Shrink long path segments (typically UUIDs) so the context line stays on
 * one line on mobile but the user can still recognise which resource failed.
 */
function truncatePathSegment(seg: string): string {
  if (seg.length <= 12) return seg;
  return `${seg.slice(0, 6)}…${seg.slice(-4)}`;
}

function formatErrorContextLabel(pathname: string, search: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const base = parts.length === 0 ? '/' : `/${parts.map(truncatePathSegment).join('/')}`;
  return search ? `${base}${search}` : base;
}

type ErrorIconKind = 'cloud-off' | 'wifi-off' | 'alert' | 'not-found' | 'lock';

function ErrorBoundaryIcon({ kind }: { kind: ErrorIconKind }) {
  const common = {
    className: 'w-12 h-12 mx-auto text-app-fg-muted',
    fill: 'none' as const,
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'cloud-off':
      return (
        <svg {...common}>
          <path d="M3 3l18 18" />
          <path d="M9.41 5.51A6 6 0 0 1 19 11h.5a3.5 3.5 0 0 1 2.39 6.04" />
          <path d="M16 19H7a4 4 0 0 1-2.4-7.2" />
        </svg>
      );
    case 'wifi-off':
      return (
        <svg {...common}>
          <path d="M3 3l18 18" />
          <path d="M8.5 16.5a5 5 0 0 1 7 0" />
          <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
          <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
          <path d="M16.85 11.25a10 10 0 0 0-2.2-1.4" />
          <path d="M5 12.55a10 10 0 0 1 5.17-2.39" />
          <circle cx="12" cy="20" r="0.5" />
        </svg>
      );
    case 'not-found':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
          <path d="m14 8-6 6" />
          <path d="m8 8 6 6" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      );
    case 'alert':
    default:
      return (
        <svg {...common}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <circle cx="12" cy="17" r="0.5" />
        </svg>
      );
  }
}

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();
  const [manualRetryLoading, setManualRetryLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [autoRetryAttempt, setAutoRetryAttempt] = useState(0);
  const [secondsUntilRetry, setSecondsUntilRetry] = useState<number | null>(null);
  const [detailsCopied, setDetailsCopied] = useState(false);

  const isResponse = isRouteErrorResponse(error);
  const status = isResponse ? error.status : 500;
  const is404 = status === 404;
  const is401 = status === 401;
  const errorPayload = isResponse ? normalizeRouteErrorData(error.data) : error;
  const isNetworkIssue = !is404 && !is401 && isNetworkErrorLike(errorPayload, status);
  const networkCopy = isNetworkIssue ? getNetworkErrorCopy(errorPayload, status) : null;

  // Hydrate online status + restore retry counter from the previous attempt
  // (a successful render mounts <App> instead, which clears the counter).
  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine);
    }
    setAutoRetryAttempt(readPriorAutoRetryAttempt(location.pathname));
  }, [location.pathname, error]);

  // React to connectivity changes so the countdown pauses while offline
  // and resumes the moment the device is back online.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const exhaustedAutoRetries = isNetworkIssue && autoRetryAttempt >= MAX_AUTO_RETRIES;
  const canAutoRetry =
    isNetworkIssue &&
    !exhaustedAutoRetries &&
    !manualRetryLoading &&
    !dashboardLoading;

  // Auto-retry countdown — silent fallback on the "we'll retry shortly" copy.
  useEffect(() => {
    if (!canAutoRetry || !isOnline) {
      setSecondsUntilRetry(null);
      return;
    }
    const delay = AUTO_RETRY_DELAYS_S[autoRetryAttempt] ?? AUTO_RETRY_DELAYS_S[MAX_AUTO_RETRIES - 1]!;
    setSecondsUntilRetry(delay);
    const tickId = window.setInterval(() => {
      setSecondsUntilRetry((s) => (s !== null && s > 1 ? s - 1 : 0));
    }, 1000);
    const fireId = window.setTimeout(() => {
      persistAutoRetryAttempt(location.pathname, autoRetryAttempt + 1);
      navigate(location.pathname + location.search, { replace: true });
    }, delay * 1000);
    return () => {
      window.clearInterval(tickId);
      window.clearTimeout(fireId);
    };
  }, [canAutoRetry, isOnline, autoRetryAttempt, location.pathname, location.search, navigate]);

  const iconKind: ErrorIconKind = is404
    ? 'not-found'
    : is401
      ? 'lock'
      : isNetworkIssue
        ? !isOnline
          ? 'wifi-off'
          : 'cloud-off'
        : 'alert';

  const title = is404
    ? 'Page Not Found'
    : is401
      ? 'Session Expired'
      : networkCopy
        ? !isOnline
          ? "You're offline"
          : networkCopy.title
        : 'Something Went Wrong';

  const description = is404
    ? "The page you're looking for doesn't exist or has been moved."
    : is401
      ? 'Your session has expired. Please sign in again.'
      : networkCopy
        ? !isOnline
          ? "Your device lost connection. We'll retry as soon as you're back online."
          : exhaustedAutoRetries
            ? `${networkCopy.description} Auto-retry stopped — tap Try Again when you're ready.`
            : networkCopy.description
        : 'An unexpected error occurred. Please try refreshing the page.';

  const contextLabel = useMemo(
    () => formatErrorContextLabel(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const detailsLine = useMemo(() => {
    const parts: string[] = [];
    if (networkCopy?.code) parts.push(networkCopy.code);
    if (networkCopy?.upstreamStatus != null) {
      parts.push(`HTTP ${networkCopy.upstreamStatus}`);
    } else if (isResponse) {
      parts.push(`HTTP ${status}`);
    }
    return parts.join(' · ');
  }, [networkCopy?.code, networkCopy?.upstreamStatus, isResponse, status]);

  const handleCopyDetails = async () => {
    const lines = [
      'Yannis EOSE error report',
      `Path: ${location.pathname}${location.search}`,
      `Status: ${status}`,
    ];
    if (detailsLine) lines.push(`Details: ${detailsLine}`);
    lines.push(`Time: ${new Date().toISOString()}`);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(lines.join('\n'));
        setDetailsCopied(true);
        window.setTimeout(() => setDetailsCopied(false), 2000);
      }
    } catch {}
  };

  const handleManualRetry = () => {
    setManualRetryLoading(true);
    persistAutoRetryAttempt(location.pathname, autoRetryAttempt + 1);
    navigate(location.pathname + location.search, { replace: true });
  };

  const retryButtonLabel =
    !isOnline
      ? 'Waiting for connection'
      : canAutoRetry && secondsUntilRetry !== null
        ? `Try Again (${secondsUntilRetry}s)`
        : 'Try Again';

  return (
    <html lang="en" className="h-full" data-app-theme="light" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} | Yannis EOSE`}</title>
        <link rel="stylesheet" href={stylesheet} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: FONT_SCALE_SCRIPT }} />
        <Links />
      </head>
      <body className="h-full flex items-center justify-center bg-app-canvas">
        <div className="text-center p-6 sm:p-8 max-w-md w-full">
          <ErrorBoundaryIcon kind={iconKind} />
          <h1 className="mt-4 text-xl font-bold text-app-fg">{title}</h1>
          <p className="mt-2 text-sm text-app-fg-muted">{description}</p>
          {isNetworkIssue && !is401 && (
            <p className="mt-3 text-xs text-app-fg-muted/80 font-mono break-all" aria-live="polite">
              {contextLabel}
            </p>
          )}
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            {is401 ? (
              <a href="/auth" className="btn-primary">
                Sign In
              </a>
            ) : (
              <>
                <Button
                  variant="primary"
                  loading={manualRetryLoading}
                  loadingText="Retrying…"
                  disabled={dashboardLoading || !isOnline}
                  onClick={handleManualRetry}
                >
                  {retryButtonLabel}
                </Button>
                <Button
                  variant="secondary"
                  loading={dashboardLoading}
                  loadingText="Opening…"
                  disabled={manualRetryLoading}
                  onClick={() => {
                    setDashboardLoading(true);
                    navigate('/admin');
                  }}
                >
                  Back to Dashboard
                </Button>
              </>
            )}
          </div>
          {isNetworkIssue && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-app-fg-muted/70">
              {detailsLine && (
                <span className="inline-flex items-center rounded-full border border-app-border/60 px-2 py-0.5">
                  {detailsLine}
                </span>
              )}
              <button
                type="button"
                onClick={handleCopyDetails}
                className="inline-flex items-center rounded-full border border-app-border/60 px-2 py-0.5 hover:bg-app-border/30 transition-colors"
              >
                {detailsCopied ? 'Copied ✓' : 'Copy details'}
              </button>
            </div>
          )}
        </div>
        <Scripts />
      </body>
    </html>
  );
}
