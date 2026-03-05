import type { LinksFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Button } from '~/components/ui/button';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from '@remix-run/react';
import stylesheet from '~/tailwind.css?url';

declare global {
  interface Window {
    __playNotificationSound?: () => void;
    __ENV: {
      API_URL: string;
      EDGE_WORKER_URL: string;
      S3_BUCKET: string;
      S3_REGION: string;
      S3_ACCESS_KEY_ID: string;
      S3_SECRET_ACCESS_KEY: string;
      S3_ENDPOINT?: string;
      VAPID_PUBLIC_KEY?: string;
    };
  }
}

export async function loader() {
  return json({
    ENV: {
      API_URL: process.env.API_URL ?? 'http://localhost:4444',
      EDGE_WORKER_URL: process.env.EDGE_WORKER_URL ?? '',
      S3_BUCKET: process.env.S3_BUCKET ?? '',
      S3_REGION: process.env.S3_REGION ?? 'us-east-1',
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '',
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '',
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
    },
  });
}

/** Theme init script — runs before paint so error boundaries and standalone pages respect dark mode */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('yannis_theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark');else document.documentElement.classList.remove('dark');}catch(e){}})();`;

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: stylesheet },
  { rel: 'icon', type: 'image/png', href: '/assets/yannis-logo1.png' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
  { rel: 'apple-touch-icon', href: '/assets/yannis-logo1.png' },
];

export default function App() {
  const { ENV } = useLoaderData<typeof loader>();
  const envScript = JSON.stringify(ENV).replace(/<\/script>/gi, '<\\/script>');

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#6366f1" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        <Outlet />
        <ScrollRestoration />
        <script dangerouslySetInnerHTML={{ __html: `window.__ENV = ${envScript};` }} />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').then(function(reg) {
                reg.addEventListener('updatefound', function() {
                  var newWorker = reg.installing;
                  if (newWorker) {
                    newWorker.addEventListener('statechange', function() {
                      if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                        // New version available — could show update prompt
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
              });
            });
          }
        `}} />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);
  const status = isResponse ? error.status : 500;
  const is404 = status === 404;
  const is401 = status === 401;

  const title = is404
    ? 'Page Not Found'
    : is401
    ? 'Session Expired'
    : 'Something Went Wrong';

  const description = is404
    ? "The page you're looking for doesn't exist or has been moved."
    : is401
    ? 'Your session has expired. Please sign in again.'
    : 'An unexpected error occurred. Please try refreshing the page.';

  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${title} | Yannis EOSE`}</title>
        <link rel="stylesheet" href={stylesheet} />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Links />
      </head>
      <body className="h-full flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="text-center p-8 max-w-md">
          <p className="text-6xl font-bold text-surface-200 dark:text-surface-700 mb-4">
            {status}
          </p>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">{title}</h1>
          <p className="mt-2 text-sm text-surface-800 dark:text-surface-200">{description}</p>
          <div className="mt-6 flex gap-3 justify-center">
            {is401 ? (
              <a href="/auth" className="btn-primary">Sign In</a>
            ) : (
              <>
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Refresh Page
                </Button>
                <a href="/admin" className="btn-secondary">Back to Dashboard</a>
              </>
            )}
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}
