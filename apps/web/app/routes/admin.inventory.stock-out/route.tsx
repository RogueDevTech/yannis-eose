import { defer } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermission } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { handleExportReportAction } from '~/lib/export-report.server';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { getLagosCalendarYmd } from '~/lib/order-delivery-today';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { StockOutPage, type StockOutPageData, type StockOutSummary } from '~/features/inventory/StockOutPage';
import { StockOutLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Stock out — Yannis EOSE' }];

const EMPTY_SUMMARY: StockOutSummary = {
  products: [],
  totals: { soldQty: 0, writtenOffQty: 0, totalQty: 0, transactionCount: 0 },
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'inventory.read');

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  // Default: this month, on the Lagos calendar (the API reads dates as WAT days).
  // Whole days only, so the summary, its transactions and the export share one window.
  const today = getLagosCalendarYmd();
  const startDate = periodAllTime ? null : (url.searchParams.get('startDate')?.trim() || `${today.slice(0, 8)}01`).slice(0, 10);
  const endDate = periodAllTime ? null : (url.searchParams.get('endDate')?.trim() || today).slice(0, 10);

  const pageData = (async (): Promise<StockOutPageData> => {
    const user = await getCurrentUser(request);
    const perms = new Set((user?.permissions ?? []).map((p: string) => canonicalPermissionCode(p)));
    const canExport = !!user && (isAdminLevel(user) || perms.has(canonicalPermissionCode('inventory.export')));

    const input: Record<string, string> = {};
    if (startDate) input['startDate'] = startDate;
    if (endDate) input['endDate'] = endDate;
    const res = await apiRequest<{ result?: { data?: StockOutSummary } }>(
      `/trpc/inventory.stockOutSummary?input=${encodeURIComponent(JSON.stringify(input))}`,
      { method: 'GET', cookie: getSessionCookie(request) },
    );

    return {
      summary: res.ok ? res.data?.result?.data ?? EMPTY_SUMMARY : EMPTY_SUMMARY,
      loadError: res.ok ? null : extractApiErrorMessage(res.data, 'Could not load stock out.'),
      startDate,
      endDate,
      periodAllTime,
      canExport,
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const exportResponse = await handleExportReportAction(request);
  if (exportResponse) return exportResponse;
  return null;
}

export default function StockOutRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<StockOutLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <StockOutPage {...data} />}
    </CachedAwait>
  );
}
