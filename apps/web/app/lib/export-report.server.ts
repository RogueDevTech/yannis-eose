import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, safeStatus } from './api.server';

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
    return json({ error: 'Invalid columns payload' }, { status: 400 });
  }
  try {
    filters = JSON.parse(filtersRaw) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid filters payload' }, { status: 400 });
  }

  const res = await apiRequest<{ result?: { data?: { filename: string; csvContent: string } } }>('/trpc/reports.exportCsv', {
    method: 'POST',
    cookie,
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
    const errorData = res.data as { error?: { message?: string } };
    return json({ error: errorData?.error?.message ?? 'Failed to export report' }, { status: safeStatus(res.status) });
  }

  const data = res.data?.result?.data;
  if (!data?.csvContent || !data.filename) {
    return json({ error: 'Export returned no data' }, { status: 500 });
  }

  return new Response(data.csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${data.filename}"`,
    },
  });
}

