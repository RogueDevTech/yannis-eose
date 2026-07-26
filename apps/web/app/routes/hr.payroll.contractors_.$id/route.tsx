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
import type {
  BranchOption,
  ContractorPayoutRow,
  PayrollContractor,
} from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Contractor — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER'];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);
  const contractorId = params['id'];
  if (!contractorId) throw new Response('Contractor ID required', { status: 400 });

  const pageData = (async () => {
    const contractorInput = encodeURIComponent(JSON.stringify({ id: contractorId }));
    const payoutsInput = encodeURIComponent(
      JSON.stringify({ contractorId, page: 1, limit: 50 }),
    );
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

    const history = historyRes.ok
      ? (((historyRes.data as { result?: { data?: { rows: HistoryEntry[] } } })?.result?.data?.rows) ??
        [])
      : [];

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
      branches,
      canWrite,
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
    return json({ success: true });
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
          branches={data.branches}
          canWrite={data.canWrite}
        />
      )}
    </CachedAwait>
  );
}
