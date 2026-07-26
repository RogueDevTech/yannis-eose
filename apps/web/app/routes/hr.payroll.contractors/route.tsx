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
import type { BranchOption, PayrollContractor } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Payroll contractors — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const [contractorsRes, branchesRes] = await Promise.all([
      apiRequest<unknown>('/trpc/hr.listContractors', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    ]);

    const contractors = contractorsRes.ok
      ? (((contractorsRes.data as { result?: { data?: PayrollContractor[] } })?.result?.data) ?? [])
      : [];
    const branches = branchesRes.ok
      ? (((branchesRes.data as { result?: { data?: BranchOption[] } })?.result?.data) ?? [])
      : [];

    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('payroll.config.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';

    return { contractors, branches, canWrite };
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
    const branchId = pickOptional('branchId');
    if (branchId) body.branchId = branchId;
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

export default function PayrollContractorsRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollContractorsPage
          contractors={data.contractors}
          branches={data.branches}
          canWrite={data.canWrite}
        />
      )}
    </CachedAwait>
  );
}
