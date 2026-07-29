import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getCurrentUser,
  getSessionCookie,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { PayrollContractorDetailPage } from '~/features/hr/PayrollContractorDetailPage';
import { PayrollContractorDetailLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { HistoryEntry } from '~/features/orders/types';
import type { ActorMap } from '~/features/audit/types';
import type {
  BranchOption,
  ContractorPayoutRow,
  PayrollContractor,
} from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Contractor — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER'];

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

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);
  const contractorId = params['id'];
  if (!contractorId) throw new Response('Contractor ID required', { status: 400 });

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const defaults = currentMonthRange();
  const startDate = url.searchParams.get('startDate') || defaults.startDate;
  const endDate = url.searchParams.get('endDate') || defaults.endDate;
  const fromMonth = periodAllTime ? undefined : (periodMonthFromYmd(startDate) ?? undefined);
  const toMonth = periodAllTime ? undefined : (periodMonthFromYmd(endDate) ?? undefined);

  const pageData = (async () => {
    const contractorInput = encodeURIComponent(JSON.stringify({ id: contractorId }));
    const payoutsBody: Record<string, unknown> = { contractorId, page: 1, limit: 100 };
    if (fromMonth) payoutsBody.fromMonth = fromMonth;
    if (toMonth) payoutsBody.toMonth = toMonth;
    const payoutsInput = encodeURIComponent(JSON.stringify(payoutsBody));
    const historyInput = encodeURIComponent(
      JSON.stringify({ tableName: 'payroll_contractors', recordId: contractorId, page: 1, limit: 40 }),
    );

    const [contractorRes, payoutsRes, branchesRes, historyRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/hr.getContractor?input=${contractorInput}`, { method: 'GET', cookie }),
      apiRequest<unknown>(`/trpc/hr.listContractorPayouts?input=${payoutsInput}`, {
        method: 'GET',
        cookie,
      }),
      apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
      apiRequest<unknown>(`/trpc/audit.recordHistory?input=${historyInput}`, { method: 'GET', cookie }),
    ]);

    if (!contractorRes.ok) throw new Response('Contractor not found', { status: 404 });
    const contractor =
      (contractorRes.data as { result?: { data?: PayrollContractor } })?.result?.data ?? null;
    if (!contractor) throw new Response('Contractor not found', { status: 404 });

    const payoutPayload = payoutsRes.ok
      ? ((payoutsRes.data as {
          result?: { data?: { items: ContractorPayoutRow[]; total: number } };
        })?.result?.data ?? null)
      : null;

    const branches = branchesRes.ok
      ? (((branchesRes.data as { result?: { data?: BranchOption[] } })?.result?.data) ?? [])
      : [];

    let history = historyRes.ok
      ? (((historyRes.data as { result?: { data?: { rows: HistoryEntry[] } } })?.result?.data?.rows) ??
        [])
      : [];

    if (!periodAllTime && history.length > 0) {
      const start = new Date(startDate).getTime();
      const end = new Date(`${endDate}T23:59:59`).getTime();
      if (Number.isFinite(start) && Number.isFinite(end)) {
        history = history.filter((h) => {
          const t = new Date(h.validFrom).getTime();
          return Number.isFinite(t) && t >= start && t <= end;
        });
      }
    }

    const actorIds = [...new Set(history.map((h) => h.changedBy).filter((id): id is string => !!id))];
    let actorNames: ActorMap = {};
    if (actorIds.length > 0) {
      const namesRes = await apiRequest<unknown>(
        `/trpc/audit.actorNames?input=${encodeURIComponent(JSON.stringify({ userIds: actorIds }))}`,
        { method: 'GET', cookie },
      );
      if (namesRes.ok) {
        actorNames =
          (namesRes.data as { result?: { data?: ActorMap } })?.result?.data ?? {};
      }
    }

    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('payroll.config.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';

    return {
      contractor,
      payouts: payoutPayload?.items ?? [],
      payoutTotal: payoutPayload?.total ?? 0,
      history,
      actorNames,
      branches,
      canWrite,
      filters: {
        startDate: periodAllTime ? '' : startDate,
        endDate: periodAllTime ? '' : endDate,
        periodAllTime,
      },
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  const pickOptional = (key: string) => {
    const v = formData.get(key)?.toString()?.trim();
    return v || undefined;
  };

  if (intent === 'updateContractor') {
    const body: Record<string, unknown> = {
      id: formData.get('contractorId')?.toString() ?? '',
    };
    const name = pickOptional('name');
    if (name) body.name = name;
    const jobTitle = pickOptional('jobTitle');
    if (jobTitle !== undefined) body.jobTitle = jobTitle;
    const monthlyFee = formData.get('monthlyFee')?.toString();
    if (monthlyFee) body.monthlyFee = Number(monthlyFee);
    const branchId = formData.get('branchId')?.toString();
    if (branchId !== undefined) body.branchId = branchId || null;
    const bankName = pickOptional('bankName');
    if (bankName !== undefined) body.bankName = bankName;
    const bankCode = pickOptional('bankCode');
    if (bankCode !== undefined) body.bankCode = bankCode;
    const accountNumber = pickOptional('accountNumber');
    if (accountNumber !== undefined) body.accountNumber = accountNumber;
    const accountName = pickOptional('accountName');
    if (accountName !== undefined) body.accountName = accountName;
    const notes = pickOptional('notes');
    if (notes !== undefined) body.notes = notes;

    const res = await apiRequest<unknown>('/trpc/hr.updateContractor', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update contractor') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Contractor saved' });
  }

  if (intent === 'setContractorActive') {
    const activeRaw = formData.get('active')?.toString();
    const active = activeRaw === 'true';
    const body = {
      id: formData.get('contractorId')?.toString() ?? '',
      active,
    };
    const res = await apiRequest<unknown>('/trpc/hr.updateContractor', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        {
          error: extractApiErrorMessage(
            res.data,
            active ? 'Failed to reactivate contractor' : 'Failed to deactivate contractor',
          ),
        },
        { status: safeStatus(res.status) },
      );
    }
    return json({
      success: true,
      message: active ? 'Contractor reactivated' : 'Contractor deactivated',
    });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollContractorDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<PayrollContractorDetailLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
        <PayrollContractorDetailPage
          contractor={data.contractor}
          payouts={data.payouts}
          payoutTotal={data.payoutTotal}
          history={data.history}
          actorNames={data.actorNames ?? {}}
          branches={data.branches}
          canWrite={data.canWrite}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
