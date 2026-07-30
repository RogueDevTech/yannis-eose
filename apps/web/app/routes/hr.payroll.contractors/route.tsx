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
import { PayrollContractorsPage } from '~/features/hr/PayrollContractorsPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayrollContractor } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Payroll contractors — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const statusFilter: 'active' | 'inactive' = statusParam === 'inactive' ? 'inactive' : 'active';

  const pageData = (async () => {
    const listInput = encodeURIComponent(
      JSON.stringify({ active: statusFilter === 'active' }),
    );
    const [contractorsRes, payRolesRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/hr.listContractors?input=${listInput}`, { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/hr.listPayRoles', { method: 'GET', cookie }),
    ]);

    const contractors = contractorsRes.ok
      ? (((contractorsRes.data as { result?: { data?: PayrollContractor[] } })?.result?.data) ?? [])
      : [];
    const payRolesRaw = payRolesRes.ok
      ? (((payRolesRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data) ?? [])
      : [];
    const payRoles = payRolesRaw.map((r) => ({ id: r.id, name: r.name }));

    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('payroll.config.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';

    return { contractors, statusFilter, canWrite, payRoles };
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

  if (intent === 'createContractor') {
    const body: Record<string, unknown> = {
      name: formData.get('name')?.toString() ?? '',
      monthlyFee: Number(formData.get('monthlyFee')?.toString() ?? '0'),
    };
    const jobTitle = pickOptional('jobTitle');
    if (jobTitle) body.jobTitle = jobTitle;
    const payRoleId = pickOptional('payRoleId');
    if (payRoleId) body.payRoleId = payRoleId;
    const bankName = pickOptional('bankName');
    if (bankName) body.bankName = bankName;
    const bankCode = pickOptional('bankCode');
    if (bankCode) body.bankCode = bankCode;
    const accountNumber = pickOptional('accountNumber');
    if (accountNumber) body.accountNumber = accountNumber;
    const accountName = pickOptional('accountName');
    if (accountName) body.accountName = accountName;
    const notes = pickOptional('notes');
    if (notes) body.notes = notes;

    const res = await apiRequest<unknown>('/trpc/hr.createContractor', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create contractor') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollContractorsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollContractorsPage
          contractors={data.contractors}
          statusFilter={data.statusFilter}
          canWrite={data.canWrite}
          payRoles={data.payRoles}
        />
      )}
    </CachedAwait>
  );
}
