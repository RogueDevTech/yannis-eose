import { TableCellTextPulse } from '~/components/ui/deferred-skeletons';

/**
 * Route-transition + deferred fallback shell for HR user detail (`UserDetailPage`).
 *
 * Mirrors the live layout: profile header (brand banner + avatar ring), compact
 * Account Information card (dense 3-col grid: dates + onboarding), then section
 * cards that open modals. Only values are pulsed — headings and chrome stay real.
 */
export function UserDetailShellSkeleton() {
  return (
    <div className="w-full space-y-6 animate-fade-in" aria-busy="true" aria-live="polite">
      {/* ─── Profile header card (matches `profileHeaderTone` + structure) ─ */}
      <div className="card p-0 overflow-hidden">
        <div className="h-28 sm:h-32 bg-brand-500 dark:bg-brand-600" aria-hidden />
        <div className="px-4 sm:px-6 pb-5 -mt-12 sm:-mt-14 relative">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-brand-500 dark:bg-brand-600 ring-4 ring-white dark:ring-surface-900 shadow-lg flex-shrink-0 flex items-center justify-center"
              aria-hidden
            >
              <div className="h-8 w-10 sm:h-9 sm:w-11 rounded-md bg-white/25 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0 pb-1 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-2">
                  <TableCellTextPulse className="h-7 sm:h-8 w-48 sm:w-64" />
                  <TableCellTextPulse className="h-4 w-56 sm:w-72" />
                </div>
                <div className="flex gap-2 flex-shrink-0 items-center">
                  <span
                    className="h-9 w-9 rounded-md border border-app-border bg-app-hover/40 inline-flex items-center justify-center shrink-0"
                    aria-hidden
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-app-hover animate-pulse" />
                  </span>
                  <span
                    className="h-9 w-9 rounded-md border border-app-border bg-app-hover/40 inline-flex items-center justify-center shrink-0"
                    aria-hidden
                  >
                    <span className="w-3.5 h-3.5 rounded-full bg-app-hover animate-pulse" />
                  </span>
                  <span className="hidden md:inline-flex h-9 min-w-[5.5rem] px-2 rounded-md border border-app-border bg-app-hover/40 items-center justify-center text-xs text-app-fg-muted">
                    Tools
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {['w-20', 'w-16', 'w-24', 'w-32'].map((w, i) => (
                  <span
                    key={i}
                    className="h-6 inline-flex items-center px-2.5 py-0.5 rounded-full bg-app-hover"
                    aria-hidden
                  >
                    <TableCellTextPulse className={`${w} h-3`} />
                  </span>
                ))}
              </div>
              <TableCellTextPulse className="h-3 w-full max-w-md" />
            </div>
          </div>
        </div>
      </div>

      {/* ─── Account Information — dense grid + onboarding affordances (matches DescriptionList dense / grid-cols-3) ─ */}
      <div className="card space-y-3 !p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-app-fg">Account Information</h2>
          <span className="text-xs font-medium text-app-fg-muted shrink-0 self-start sm:self-auto">
            Loading…
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-x-3 gap-y-2 sm:gap-x-4 sm:gap-y-2.5 sm:grid-cols-3">
          {(['Member Since', 'Last Updated', 'Onboarding'] as const).map((label) => (
            <div key={label} className="flex flex-col gap-px">
              <dt className="text-micro font-semibold uppercase tracking-wide text-app-fg-muted">
                {label}
              </dt>
              <dd className="min-h-[1.25rem]">
                {label === 'Onboarding' ? (
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:flex-wrap sm:gap-2 pt-0.5">
                    <span
                      className="inline-flex items-center h-6 min-w-[6.5rem] rounded-full border border-app-border bg-app-hover animate-pulse"
                      aria-hidden
                    />
                    <span
                      className="h-7 w-[7.25rem] max-w-full rounded-md border border-app-border bg-app-hover/70 animate-pulse"
                      aria-hidden
                    />
                  </div>
                ) : (
                  <TableCellTextPulse className="h-3.5 w-28 max-w-full mt-0.5" />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ─── Section cards — same chrome as `SectionCard` (modal entry points) ─ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="text-left rounded-lg border border-app-border bg-app-hover px-4 py-3"
            aria-hidden
          >
            <TableCellTextPulse className="h-4 w-[7.5rem] max-w-full" />
            <span className="block text-xs text-app-fg-muted mt-0.5">View details →</span>
          </div>
        ))}
      </div>
    </div>
  );
}
