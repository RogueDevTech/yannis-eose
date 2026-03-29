/**
 * Route transition loader — gradient spinner style, used in dashboard layout.
 * Uses same background as the overlay so it blends in.
 * Fills content area height and centers the loader.
 */
export function RouteLoader() {
  return (
    <div className="flex min-h-[calc(100vh-var(--header-height)-3rem)] flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 flex items-center justify-center">
        <svg
          className="w-10 h-10 animate-spin text-brand-500 dark:text-brand-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="32 32"
            strokeDashoffset="8"
            opacity="0.9"
          />
        </svg>
      </div>
      <p className="text-sm font-medium text-app-fg-muted">Loading…</p>
    </div>
  );
}
