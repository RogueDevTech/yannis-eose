import type { LinksFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useEffect, useState } from 'react';
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
import { usePwaInstall } from '~/hooks/usePwaInstall';
import { useServerAppThemeSync } from '~/hooks/useServerAppThemeSync';
import { useServerFontScaleSync } from '~/hooks/useServerFontScaleSync';
import { ScrollToTopButton } from '~/components/ui/scroll-to-top-button';
import stylesheet from '~/tailwind.css?url';
import { getThemeBootScript } from '~/lib/theme';
import { getFontScaleBootScript } from '~/lib/font-scale';
import { useScrollToTopOnRouteChange } from '~/hooks/useScrollToTopOnRouteChange';
import { isNetworkErrorLike, NETWORK_ERROR_MESSAGE } from '~/lib/network-error';

declare global {
  interface Window {
    __playNotificationSound?: () => void;
    __ENV: {
      API_URL: string;
      EDGE_WORKER_URL: string;
      S3_BUCKET: string;
      S3_REGION: string;
      S3_ENDPOINT?: string;
      VAPID_PUBLIC_KEY?: string;
    };
  }
}

export async function loader() {
  return json({
    ENV: {
      // PUBLIC_API_URL is the browser-reachable API URL (e.g. https://api-yannis.roguedevtech.com).
      // Falls back to API_URL for local dev where both are the same.
      API_URL: process.env.PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:4444',
      EDGE_WORKER_URL: process.env.EDGE_WORKER_URL ?? '',
      S3_BUCKET: process.env.S3_BUCKET ?? '',
      S3_REGION: process.env.S3_REGION ?? 'us-east-1',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
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

    return () => {
      window.cancelAnimationFrame(id);
    };
  }, []);

  useEffect(() => {
    if (isAuthPage || !isLoggedInArea || !canPromptInstall) {
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
            if (accepted) setInstallPromptOpen(false);
          }}
          onClose={() => setInstallPromptOpen(false)}
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
              navigator.serviceWorker.register('/sw.js').then(function(reg) {
                // If there's already a waiting worker on load (e.g. tab was kept open), fire immediately
                if (reg.waiting && navigator.serviceWorker.controller) {
                  window.dispatchEvent(new CustomEvent('yannis:sw-update-ready'));
                }
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

export function ErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const isResponse = isRouteErrorResponse(error);
  const status = isResponse ? error.status : 500;
  const is404 = status === 404;
  const is401 = status === 401;
  const isNetworkIssue = !is404 && !is401 && isNetworkErrorLike(isResponse ? error.data : error, status);

  const title = is404 ? 'Page Not Found' : is401 ? 'Session Expired' : isNetworkIssue ? NETWORK_ERROR_MESSAGE.title : 'Something Went Wrong';

  const description = is404
    ? "The page you're looking for doesn't exist or has been moved."
    : is401
      ? 'Your session has expired. Please sign in again.'
      : isNetworkIssue
        ? NETWORK_ERROR_MESSAGE.description
        : 'An unexpected error occurred. Please try refreshing the page.';

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
        <div className="text-center p-8 max-w-md">
          <p className="text-6xl font-bold text-app-border mb-4">{status}</p>
          <h1 className="text-xl font-bold text-app-fg">{title}</h1>
          <p className="mt-2 text-sm text-app-fg-muted">{description}</p>
          <div className="mt-6 flex gap-3 justify-center">
            {is401 ? (
              <a href="/auth" className="btn-primary">
                Sign In
              </a>
            ) : (
              <>
                <Button
                  variant="primary"
                  loading={refreshLoading}
                  loadingText="Refreshing…"
                  disabled={dashboardLoading}
                  onClick={() => {
                    setRefreshLoading(true);
                    window.location.reload();
                  }}
                >
                  Refresh Page
                </Button>
                <Button
                  variant="secondary"
                  loading={dashboardLoading}
                  loadingText="Opening…"
                  disabled={refreshLoading}
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
        </div>
        <Scripts />
      </body>
    </html>
  );
}
