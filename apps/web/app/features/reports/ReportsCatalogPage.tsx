import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import {
  REPORTS,
  REPORT_GROUP_ORDER,
  type ReportDef,
  type ReportCategoryGroup,
} from './report-registry';

/**
 * Reports catalog — the Admin → Reports landing page. Renders every report
 * category from the registry, grouped, as tappable cards. Live reports link to
 * their report route; planned reports render disabled with a "Coming soon"
 * hint so the hub is fully navigable while categories are wired up.
 *
 * Admin-level only; the route loader enforces the gate server-side.
 */
export function ReportsCatalogPage() {
  const byGroup = new Map<ReportCategoryGroup, ReportDef[]>();
  for (const g of REPORT_GROUP_ORDER) byGroup.set(g, []);
  for (const r of REPORTS) {
    const list = byGroup.get(r.group);
    if (list) list.push(r);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Generate business reports across the platform for any period, pick the columns you need, and export."
      />

      {REPORT_GROUP_ORDER.map((group) => {
        const items = byGroup.get(group) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <h2 className="text-sm font-semibold text-app-fg-muted uppercase tracking-wide">
              {group}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((r) => (
                <ReportCard key={r.slug} report={r} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ReportCard({ report }: { report: ReportDef }) {
  const isLive = report.status === 'live';

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-app-fg text-sm">{report.title}</h3>
        {!isLive && (
          <span className="shrink-0 inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-2xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Coming soon
          </span>
        )}
      </div>
      <p className="text-xs text-app-fg-muted leading-relaxed">{report.description}</p>
    </>
  );

  if (isLive) {
    return (
      <Link
        to={`/admin/reports/${report.slug}`}
        className="list-panel p-4 space-y-2 block hover:border-brand-500/60 hover:bg-app-hover transition-colors"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="list-panel p-4 space-y-2 opacity-60 cursor-not-allowed" aria-disabled="true">
      {body}
    </div>
  );
}
