import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { requireRole, apiRequest, getSessionCookie } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { ReportShell } from '~/features/reports/ReportShell';
import { getReportBySlug } from '~/features/reports/report-registry';

/**
 * Maps a report slug to the tRPC query that supplies its rows. Only slugs
 * present here are 'live'; others fall through to the "coming soon" state.
 * Each entry returns the flat row array the ReportShell renders.
 */
const REPORT_FETCHERS: Record<
  string,
  string // tRPC procedure path under /trpc
> = {
  'product-performance': 'reports.productPerformance',
  'customer-acquisition-funnel': 'reports.customerAcquisitionFunnel',
};

async function fetchReportRows(
  procedure: string,
  input: { startDate?: string; endDate?: string },
  cookie: string | undefined,
): Promise<Array<Record<string, unknown>>> {
  const encoded = encodeURIComponent(JSON.stringify(input));
  const res = await apiRequest<unknown>(`/trpc/${procedure}?input=${encoded}`, {
    method: 'GET',
    cookie,
  });
  if (!res.ok) return [];
  const data = (res.data as { result?: { data?: unknown } })?.result?.data;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

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

  // Wired reports fetch their rows from the mapped tRPC procedure for the
  // resolved date window. All-time passes no dates (the procedure treats
  // absent start/end as unbounded). Unwired slugs return no rows and render
  // the "coming soon" state.
  let rows: Array<Record<string, unknown>> = [];
  const procedure = REPORT_FETCHERS[slug];
  if (procedure) {
    const cookie = getSessionCookie(request);
    const input: { startDate?: string; endDate?: string } = periodAllTime
      ? {}
      : {
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        };
    rows = await fetchReportRows(procedure, input, cookie);
  }

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
