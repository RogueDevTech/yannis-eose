import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requireRole } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { ReportShell } from '~/features/reports/ReportShell';
import { getReportBySlug } from '~/features/reports/report-registry';

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.report ? `${data.report.title} — Reports` : 'Report — Yannis EOSE' },
];

/** Admin-level roles that may access the centralized Reports module. */
const REPORTS_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireRole(request, REPORTS_ROLES);

  const slug = params['slug'] ?? '';
  const report = getReportBySlug(slug);
  if (!report) {
    return json({ report: null, rows: [], startDate: '', endDate: '', periodAllTime: false });
  }

  const url = new URL(request.url);
  const startDate = url.searchParams.get('startDate') ?? '';
  const endDate = url.searchParams.get('endDate') ?? '';
  const periodAllTime = url.searchParams.get('period') === 'all_time';

  // Phase A: no report is wired to a data source yet, so rows are empty. Phase
  // B/C attach a per-slug fetcher here that calls the report's tRPC procedure
  // with the resolved date window and returns flat rows for the shell.
  const rows: Array<Record<string, unknown>> = [];

  return json({
    report: {
      slug: report.slug,
      title: report.title,
      description: report.description,
      status: report.status,
      columns: report.columns ?? [],
      defaultColumns: report.defaultColumns ?? [],
    },
    rows,
    startDate,
    endDate,
    periodAllTime,
  });
}

export default function ReportDetailRoute() {
  const { report, rows, startDate, endDate, periodAllTime } = useLoaderData<typeof loader>();

  if (!report) {
    return (
      <div className="space-y-4">
        <PageHeader title="Report not found" backTo="/admin/reports" />
        <EmptyState
          title="Unknown report"
          description="This report does not exist. Pick one from the Reports catalog."
        />
      </div>
    );
  }

  // Not-yet-wired categories render through the shell chrome with a clear
  // "coming soon" empty state, so the module is navigable end to end in Phase A.
  if (report.status !== 'live' || report.columns.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={report.title}
          description={report.description}
          backTo="/admin/reports"
        />
        <EmptyState
          title="Coming soon"
          description="This report is being wired up. The date filters, column picker, and export will appear here once its data source is connected."
        />
      </div>
    );
  }

  return (
    <ReportShell
      title={report.title}
      description={report.description}
      columns={report.columns}
      defaultColumns={report.defaultColumns}
      rows={rows}
      startDate={startDate}
      endDate={endDate}
      periodAllTime={periodAllTime}
      exportFilenamePrefix={report.slug}
    />
  );
}
