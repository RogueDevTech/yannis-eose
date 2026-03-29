/**
 * Offline fallback page — shown when the app is offline and the requested
 * page is not cached.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app-canvas p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-warning-100 dark:bg-warning-900/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M8.464 15.536a5 5 0 010-7.072M15.536 8.464a5 5 0 010 7.072" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-app-fg mb-2">
          You are offline
        </h1>
        <p className="text-app-fg-muted mb-6">
          Your internet connection is currently unavailable. Any pending actions will be synced automatically when you reconnect.
        </p>
        <div className="space-y-3">
          <a
            href="javascript:window.location.reload()"
            className="block w-full px-4 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors text-center"
          >
            Try again
          </a>
          <a
            href="javascript:void(window.history.length>1?window.history.back():window.location.assign('/admin'))"
            className="block w-full px-4 py-2.5 bg-app-hover text-app-fg-muted rounded-lg font-medium border border-app-border hover:bg-app-elevated transition-colors text-center"
          >
            Go back
          </a>
        </div>
        <p className="mt-6 text-xs text-app-fg-muted">
          Delivery confirmations and order updates saved offline will sync within 30 seconds of reconnection.
        </p>
      </div>
    </div>
  );
}
