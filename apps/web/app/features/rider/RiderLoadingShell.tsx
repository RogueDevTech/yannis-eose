import { PageRefreshButton } from '~/components/ui/page-refresh-button';

/** Rider mobile dashboard — delivery queue cards. */
export function RiderLoadingShell() {
  return (
    <div className="space-y-4 px-1" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <div className="h-7 w-48 max-w-[70%] rounded-md bg-app-hover animate-pulse" aria-hidden />
        <PageRefreshButton />
      </div>
      <div className="h-4 w-full max-w-xs rounded bg-app-hover/80 animate-pulse" aria-hidden />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-4 space-y-3">
            <div className="flex justify-between gap-2">
              <div className="h-4 flex-1 rounded bg-app-hover animate-pulse" aria-hidden />
              <div className="h-6 w-20 rounded-full bg-app-hover animate-pulse" aria-hidden />
            </div>
            <div className="h-3 w-4/5 rounded bg-app-hover/80 animate-pulse" aria-hidden />
            <div className="flex gap-2 pt-1">
              <div className="h-9 flex-1 rounded-md bg-app-hover animate-pulse" aria-hidden />
              <div className="h-9 flex-1 rounded-md bg-app-hover animate-pulse" aria-hidden />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
