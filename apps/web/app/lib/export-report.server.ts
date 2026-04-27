import { data } from '@remix-run/node';
import { apiRequest, getSessionCookie, safeStatus } from './api.server';
import { extractApiErrorMessage } from './api-error';

export type ExportReportActionData =
  | { ok: true; filename: string; csvContent: string }
  | { ok: false; error: string };

export async function handleExportReportAction(request: Request) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  if (intent !== 'exportReport') return null;

  const reportKey = formData.get('reportKey')?.toString() ?? '';
  const datePreset = formData.get('datePreset')?.toString() ?? 'this_month';
  const startDate = formData.get('startDate')?.toString() ?? '';
  const endDate = formData.get('endDate')?.toString() ?? '';
  const columnsRaw = formData.get('columns')?.toString() ?? '[]';
  const filtersRaw = formData.get('filters')?.toString() ?? '{}';

  let columns: string[] = [];
  let filters: Record<string, unknown> = {};
  try {
    columns = JSON.parse(columnsRaw) as string[];
  } catch {
    return data({ ok: false as const, error: 'Invalid columns payload' } satisfies ExportReportActionData, { status: 400 });
  }
  try {
    filters = JSON.parse(filtersRaw) as Record<string, unknown>;
  } catch {
    return data({ ok: false as const, error: 'Invalid filters payload' } satisfies ExportReportActionData, { status: 400 });
  }

  const res = await apiRequest<{ result?: { data?: { filename: string; csvContent: string } } }>('/trpc/reports.exportCsv', {
    method: 'POST',
    cookie,
    timeoutMs: 120_000,
    body: {
      reportKey,
      columns,
      dateRange: {
        preset: datePreset,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
      filters,
    },
  });

  if (!res.ok) {
    return data(
      { ok: false as const, error: extractApiErrorMessage(res.data, 'Failed to export report') } satisfies ExportReportActionData,
      { status: safeStatus(res.status) },
    );
  }

  const payload = res.data?.result?.data;
  if (!payload?.csvContent || !payload.filename) {
    return data({ ok: false as const, error: 'Export returned no data' } satisfies ExportReportActionData, { status: 500 });
  }

  return data({
    ok: true as const,
    filename: payload.filename,
    csvContent: payload.csvContent,
  } satisfies ExportReportActionData);
}
