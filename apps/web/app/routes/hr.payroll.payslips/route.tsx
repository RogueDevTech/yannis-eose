import { defer, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
} from '~/lib/api.server';
import { PayrollPayslipsPage } from '~/features/hr/PayrollPayslipsPage';
import { PayrollPayslipsLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayslipListItem } from '~/features/hr/payroll-prd-types';
import type { BranchOption } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Payslips — Yannis EOSE' }];

const VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'FINANCE_OFFICER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

const PAGE_SIZE = 20;

/** Map a calendar day to payroll period month (`YYYY-MM-01`). */
function periodMonthFromYmd(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return `${ymd.slice(0, 7)}-01`;
}

/** Return current month boundaries as YYYY-MM-DD strings. */
function currentMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const startDate = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const endDate = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const pageRaw = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const department = url.searchParams.get('department') || undefined;
  const branchId = url.searchParams.get('branchId') || undefined;
  const search = url.searchParams.get('search') || undefined;

  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const defaults = currentMonthRange();
  const startDate = url.searchParams.get('startDate') || defaults.startDate;
  const endDate = url.searchParams.get('endDate') || defaults.endDate;

  const fromMonth = periodAllTime ? '' : (periodMonthFromYmd(startDate) ?? '');
  const toMonth = periodAllTime ? '' : (periodMonthFromYmd(endDate) ?? '');

  const pageData = (async () => {
    const input: Record<string, unknown> = { page, limit: PAGE_SIZE };
    if (department) input.department = department;
    if (branchId) input.branchId = branchId;
    if (fromMonth) input.fromMonth = fromMonth;
    if (toMonth) input.toMonth = toMonth;
    if (search) input.search = search;

    const [res, branchesRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/hr.listPayslips?input=${encodeURIComponent(JSON.stringify(input))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    ]);

    const payload = res.ok
      ? (res.data as { result?: { data?: { items: PayslipListItem[]; page: number; limit: number; total: number } } })
          ?.result?.data
      : null;

    const branches: BranchOption[] = branchesRes.ok
      ? ((branchesRes.data as { result?: { data?: BranchOption[] } })?.result?.data ?? [])
      : [];

    return {
      items: payload?.items ?? [],
      page: payload?.page ?? page,
      limit: payload?.limit ?? PAGE_SIZE,
      total: payload?.total ?? 0,
      branches,
      filters: { department, branchId, startDate, endDate, periodAllTime, search },
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function PayrollPayslipsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollPayslipsLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollPayslipsPage
          items={data.items}
          page={data.page}
          limit={data.limit}
          total={data.total}
          branches={data.branches}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
