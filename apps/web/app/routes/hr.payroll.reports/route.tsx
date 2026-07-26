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
import { PayrollReportsPage } from '~/features/hr/PayrollReportsPage';
import { PayrollReportsLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayrollRegisterRow } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Payroll register — Yannis EOSE' }];

const VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'FINANCE_OFFICER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

/** Map a calendar day to payroll period month (`YYYY-MM-01`). */
function periodMonthFromYmd(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return `${ymd.slice(0, 7)}-01`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const startDate = url.searchParams.get('startDate') ?? '';
  const endDate = url.searchParams.get('endDate') ?? '';
  // Legacy month params still accepted for old bookmarks.
  const legacyFrom = url.searchParams.get('fromMonth') ?? '';
  const legacyTo = url.searchParams.get('toMonth') ?? '';
  const statusParam = url.searchParams.get('status') ?? 'ALL';
  const departmentParam = url.searchParams.get('department') ?? '';
  const branchIdParam = url.searchParams.get('branchId') ?? '';

  const fromMonth = periodAllTime
    ? ''
    : periodMonthFromYmd(startDate) ?? (/^\d{4}-\d{2}-01$/.test(legacyFrom) ? legacyFrom : '');
  const toMonth = periodAllTime
    ? ''
    : periodMonthFromYmd(endDate) ?? (/^\d{4}-\d{2}-01$/.test(legacyTo) ? legacyTo : '');

  const pageData = (async () => {
    const input: Record<string, string> = {};
    if (fromMonth) input.fromMonth = fromMonth;
    if (toMonth) input.toMonth = toMonth;
    if (statusParam && statusParam !== 'ALL') input.status = statusParam;
    if (departmentParam) input.department = departmentParam;
    if (branchIdParam && /^[0-9a-f-]{36}$/i.test(branchIdParam)) input.branchId = branchIdParam;

    const rangeInput: Record<string, string> = {};
    if (input.fromMonth) rangeInput.fromMonth = input.fromMonth;
    if (input.toMonth) rangeInput.toMonth = input.toMonth;
    if (input.branchId) rangeInput.branchId = input.branchId;

    const inputEnc = encodeURIComponent(JSON.stringify(input));
    const rangeEnc = encodeURIComponent(JSON.stringify(rangeInput));

    const [registerRes, costBranchRes, costRoleRes, trendRes, branchesRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/hr.payrollRegister?input=${inputEnc}`, { method: 'GET', cookie }),
      apiRequest<unknown>(`/trpc/hr.payrollCostByBranch?input=${rangeEnc}`, { method: 'GET', cookie }),
      apiRequest<unknown>(`/trpc/hr.payrollCostByRoleCategory?input=${rangeEnc}`, { method: 'GET', cookie }),
      apiRequest<unknown>(`/trpc/hr.payrollTrend?input=${rangeEnc}`, { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    ]);

    const rows = registerRes.ok
      ? (((registerRes.data as { result?: { data?: PayrollRegisterRow[] } })?.result?.data) ?? [])
      : [];

    return {
      rows,
      costByBranch:
        (costBranchRes.ok
          ? (costBranchRes.data as { result?: { data?: unknown[] } })?.result?.data
          : []) ?? [],
      costByRole:
        (costRoleRes.ok
          ? (costRoleRes.data as { result?: { data?: unknown[] } })?.result?.data
          : []) ?? [],
      trend:
        (trendRes.ok ? (trendRes.data as { result?: { data?: unknown[] } })?.result?.data : []) ?? [],
      branches: (branchesRes.ok
        ? ((branchesRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data ?? [])
        : []),
      filters: {
        startDate,
        endDate,
        periodAllTime,
        status: statusParam,
        department: departmentParam,
        branchId: branchIdParam,
      },
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function PayrollReportsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollReportsLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <PayrollReportsPage {...data} />}
    </CachedAwait>
  );
}
