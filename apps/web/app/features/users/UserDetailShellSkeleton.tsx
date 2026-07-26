import { OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';

/**
 * Route-transition + deferred fallback shell for HR user detail (`UserDetailPage`).
 *
 * Mirrors the live layout: blue identity hero (name/email), action toolbar,
 * overview matrix strip, then destination section cards.
 * Only values are pulsed — headings and chrome stay real.
 */
export function UserDetailShellSkeleton() {
  return (
    <div className="w-full space-y-3 animate-fade-in" aria-busy="true" aria-live="polite">
      {/* ─── Profile identity hero + action bar ─ */}
      <div className="card p-0 overflow-hidden">
        <div className="relative isolate overflow-hidden bg-brand-600 dark:bg-brand-700">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage:
                'radial-gradient(ellipse 80% 60% at 100% 0%, rgba(255,255,255,0.22), transparent 55%), radial-gradient(ellipse 50% 40% at 0% 100%, rgba(0,0,0,0.18), transparent 50%)',
            }}
            aria-hidden
          />
          <div className="relative px-4 sm:px-6 pt-3 sm:pt-4 pb-3.5 sm:pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5" aria-hidden>
                <span className="block h-7 sm:h-8 w-48 sm:w-64 rounded-md bg-white/25 animate-pulse" />
                <span className="block h-4 w-56 sm:w-72 rounded-md bg-white/20 animate-pulse" />
              </div>
              <div className="md:hidden flex items-center gap-2 shrink-0" aria-hidden>
                <span className="h-9 w-9 rounded-lg bg-white/15 border border-white/20" />
                <span className="h-9 w-9 rounded-lg bg-white/15 border border-white/20" />
              </div>
            </div>
          </div>
        </div>

        <div className="hidden md:block border-t border-app-border bg-app-elevated px-4 sm:px-6 py-2">
          <div className="flex flex-wrap items-center gap-2" aria-hidden>
            {['w-20', 'w-24', 'w-[7.5rem]', 'w-24', 'w-[7.25rem]', 'w-24'].map((w, i) => (
              <span
                key={i}
                className={`h-8 ${w} rounded-md border border-app-border bg-app-hover/60 animate-pulse`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ─── Overview matrix ─ */}
      <OverviewStatStripSkeleton
        count={4}
        labels={['Role', 'Status', 'Last active', 'Phone']}
        tileClassName="!py-1.5 !px-2.5"
      />

      {/* ─── Section cards (modal / page destinations) ─ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {(
          [
            ['Account Information', 'Membership dates and onboarding'],
            ['Permissions', 'Effective access and grants'],
            ['Branches', 'Branch memberships'],
            ['Payslips & history', 'Paid payouts and PDFs'],
            ['Earnings outlook', 'Projected pay breakdown'],
            ['Activity', 'Audit trail for this user'],
          ] as const
        ).map(([label, description]) => (
          <div
            key={label}
            className="rounded-xl border border-app-border bg-app-elevated px-4 py-4"
            aria-hidden
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <span className="block text-sm font-semibold text-app-fg">{label}</span>
                <span className="block text-xs text-app-fg-muted leading-snug">{description}</span>
              </div>
              <span className="shrink-0 text-brand-600 dark:text-brand-400 text-sm font-medium opacity-50">
                →
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
