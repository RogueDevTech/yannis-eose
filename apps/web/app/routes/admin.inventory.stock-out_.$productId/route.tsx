import { defer } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getCurrentUser,
  getSessionCookie,
  parsePerPage,
  requirePermission,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { handleExportReportAction } from '~/lib/export-report.server';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { parseStockOutPeriod } from '~/features/inventory/stock-out-period';
import type { StockOutSummary } from '~/features/inventory/StockOutPage';
import {
  StockOutProductPage,
  type StockOutProductPageData,
  type StockOutTransaction,
} from '~/features/inventory/StockOutProductPage';
import { StockOutProductLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Product stock out — Yannis EOSE' }];

type TransactionsResult = {
  transactions: StockOutTransaction[];
  totalQty: number;
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'inventory.read');
  const productId = (params['productId'] ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(productId)) {
    throw new Response('Product not found', { status: 404 });
  }

  const url = new URL(request.url);
  const { startDate, endDate, periodAllTime } = parseStockOutPeriod(url.searchParams);
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const { perPage } = parsePerPage(url.searchParams, { defaultPerPage: 50 });

  const cookie = getSessionCookie(request);
  const opt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const period: Record<string, string> = { productId };
  if (startDate) period['startDate'] = startDate;
  if (endDate) period['endDate'] = endDate;
  const q = (input: unknown) => encodeURIComponent(JSON.stringify(input));

  const pageData = (async (): Promise<StockOutProductPageData> => {
    const [user, productRes, summaryRes, txRes] = await Promise.all([
      getCurrentUser(request),
      apiRequest<{ result?: { data?: { name?: string } } }>(`/trpc/products.getById?input=${q({ productId })}`, opt),
      apiRequest<{ result?: { data?: StockOutSummary } }>(`/trpc/inventory.stockOutSummary?input=${q(period)}`, opt),
      apiRequest<{ result?: { data?: TransactionsResult } }>(
        `/trpc/inventory.stockOutTransactions?input=${q({ ...period, page, limit: perPage })}`,
        opt,
      ),
    ]);

    const perms = new Set((user?.permissions ?? []).map((p: string) => canonicalPermissionCode(p)));
    const canExport = !!user && (isAdminLevel(user) || perms.has(canonicalPermissionCode('inventory.export')));
    const tx = txRes.ok ? txRes.data?.result?.data ?? null : null;
    const summary = summaryRes.ok ? summaryRes.data?.result?.data?.products[0] ?? null : null;
    // A product outside the caller's company comes back NOT_FOUND; the stock queries are
    // company-scoped too, so nothing leaks either way.
    const failed = !productRes.ok ? productRes : !summaryRes.ok ? summaryRes : !txRes.ok ? txRes : null;

    return {
      productId,
      productName: productRes.data?.result?.data?.name ?? summary?.productName ?? 'Product',
      summary,
      transactions: tx?.transactions ?? [],
      transactionsTotalQty: tx?.totalQty ?? 0,
      total: tx?.pagination.total ?? 0,
      totalPages: tx?.pagination.totalPages ?? 1,
      page,
      limit: perPage,
      loadError: failed ? extractApiErrorMessage(failed.data, 'Could not load stock out.') : null,
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

export default function StockOutProductRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<StockOutProductLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <StockOutProductPage {...data} />}
    </CachedAwait>
  );
}
