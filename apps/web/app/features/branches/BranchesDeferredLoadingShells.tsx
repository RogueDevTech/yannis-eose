import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';

/** `/admin/branches` — list shell. */
export function BranchesListLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Branch Management"
        description="Manage company branches and tenant separation. Each branch has its own data scope."
        actions={
          <Button variant="primary" size="sm" disabled className="opacity-60">
            + New Branch
          </Button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <article
            key={i}
            className="relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm flex flex-col min-h-[180px]"
            aria-hidden
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="h-6 w-40 rounded bg-app-hover animate-pulse" />
              <div className="h-6 w-16 rounded-full bg-app-hover animate-pulse shrink-0" />
            </div>

            <div className="text-sm text-app-fg-muted mb-4 flex-1">
              <span className="inline-flex items-center rounded-md border border-app-border bg-app-hover px-1.5 py-0.5">
                <span className="h-3 w-10 rounded bg-app-border/80 animate-pulse" />
              </span>
              <span className="mx-1.5">·</span>
              <span className="inline-block h-3 w-24 rounded bg-app-hover animate-pulse align-middle" />
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-app-border">
              <Button type="button" variant="primary" size="sm" disabled className="gap-1.5 shrink-0">
                Edit
              </Button>
              <span className="ml-auto text-xs font-medium text-app-fg-muted inline-flex items-center gap-1">
                View details
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/** `/admin/branches/:id` — detail shell (branch name unknown until load). */
export function BranchDetailLoadingShell({
  canManageCSTeams = true,
  canManageMarketingTeams = true,
}: {
  canManageCSTeams?: boolean;
  canManageMarketingTeams?: boolean;
}) {
  const departments = [
    { title: 'Customer support', code: 'CS', description: 'Manage customer support' },
    { title: 'Marketing', code: 'MARKETING', description: 'Manage marketing' },
  ].filter((dept) =>
    dept.code === 'CS' ? canManageCSTeams : canManageMarketingTeams,
  );
  const visibleDepartments = departments.length > 0
    ? departments
    : [
        { title: 'Customer support', code: 'CS', description: 'Manage customer support' },
        { title: 'Marketing', code: 'MARKETING', description: 'Manage marketing' },
      ];

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="bg-app-elevated rounded-xl border border-app-border shadow-sm p-5">
        <div className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All branches
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-app-hover animate-pulse shrink-0" aria-hidden />
            <div className="min-w-0 space-y-2">
              <div className="h-7 w-48 rounded bg-app-hover animate-pulse" aria-hidden />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center rounded-md border border-app-border bg-app-hover px-1.5 py-0.5">
                  <span className="h-3 w-10 rounded bg-app-border/80 animate-pulse" aria-hidden />
                </span>
                <span aria-hidden>·</span>
                <span className="inline-block h-3 w-24 rounded bg-app-hover animate-pulse" aria-hidden />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-16 rounded-full bg-app-hover animate-pulse" aria-hidden />
            <Button type="button" variant="primary" size="sm" disabled>
              Edit
            </Button>
          </div>
        </div>
      </div>

      {/* Department cards skeleton — department identity pulses too so route
          transition shells don't reveal branch-specific sections before access
          checks / loader data resolve. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {visibleDepartments.map((dept) => (
          <article
            key={dept.code}
            className="relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm flex flex-col min-h-[180px]"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="h-5 w-36 rounded bg-app-hover animate-pulse min-w-0 flex-1" aria-hidden />
              <span className="shrink-0 inline-flex items-center rounded-md px-2 py-0.5 bg-app-hover">
                <span className="h-3 w-10 rounded bg-app-border/80 animate-pulse" aria-hidden />
              </span>
            </div>

            <div className="text-sm text-app-fg-muted mb-4 flex-1">
              <span className="inline-flex items-center rounded-md border border-app-border bg-app-hover px-1.5 py-0.5">
                <span className="h-3 w-8 rounded bg-app-border/80 animate-pulse" aria-hidden />
              </span>
              <span className="mx-1.5">·</span>
              <span className="inline-block h-3 w-20 rounded bg-app-hover animate-pulse align-middle" aria-hidden />
              <div className="mt-2 space-y-2" aria-hidden>
                <div className="h-3 w-32 rounded bg-app-hover animate-pulse" />
                <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {['Members', 'Teams', 'Supervisors'].map((label) => (
                <div key={label} className="rounded-lg border border-app-border bg-app-hover/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-app-fg-muted">
                    {label}
                  </p>
                  <div className="mt-1 h-6 w-8 rounded bg-app-hover animate-pulse" aria-hidden />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-app-border">
              <span className="ml-auto text-xs font-medium text-app-fg-muted inline-flex items-center gap-1">
                View details
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
