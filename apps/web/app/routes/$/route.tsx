import type { LoaderFunctionArgs } from '@remix-run/node';
import { Link } from '@remix-run/react';

/**
 * Splat route — catches unmatched URLs.
 * Returns 204 for Chrome DevTools' automatic request (silences console noise).
 * Returns 404 for other unknown paths.
 */
const CHROME_DEVTOOLS_PATH = '/.well-known/appspecific/com.chrome.devtools.json';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.pathname === CHROME_DEVTOOLS_PATH) {
    return new Response(null, { status: 204 });
  }
  throw new Response('Not Found', { status: 404 });
}

export default function CatchAll() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 p-6">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-surface-200 dark:text-surface-700 mb-4">404</p>
        <h1 className="text-xl font-bold text-surface-900 dark:text-white">Page Not Found</h1>
        <p className="mt-2 text-sm text-surface-800 dark:text-surface-400">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6 flex gap-3 justify-center">
          <Link to="/admin" className="btn-primary">Go to Dashboard</Link>
          <Link to="/auth" className="btn-secondary">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
