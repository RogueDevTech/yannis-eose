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
import { PayrollAssignRolePage } from '~/features/hr/PayrollAssignRolePage';
import { PayrollAssignRoleLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayRole } from '~/features/hr/payroll-prd-types';
import type { BranchOption } from '~/features/hr/types';

export const meta: MetaFunction = () => [{ title: 'Assign pay role — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER', 'HEAD_OF_CS'];
const PAGE_SIZE = 50;

export interface StaffRow {
  id: string;
  name: string;
  role: string;
  payRoleId: string | null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'payroll.config.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const roleId = params.roleId;
  if (!roleId) throw redirect('/hr/payroll/config/roles');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const pageRaw = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const role = url.searchParams.get('role') || undefined;
  const branchId = url.searchParams.get('branchId') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const assignStatus = url.searchParams.get('assignStatus') || undefined;

  const pageData = (async () => {
    const usersInput: Record<string, unknown> = {
      page,
      limit: PAGE_SIZE,
      sortBy: 'name',
      sortOrder: 'asc',
      companyWideUserList: true,
    };
    if (role) usersInput.role = role;
    if (branchId) usersInput.branchId = branchId;
    if (search) usersInput.search = search;

    const [rolesRes, usersRes, branchesRes] = await Promise.all([
      apiRequest<unknown>('/trpc/hr.listPayRoles', { method: 'GET', cookie }),
      apiRequest<unknown>(
        `/trpc/users.list?input=${encodeURIComponent(JSON.stringify(usersInput))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    ]);

    const roles = rolesRes.ok
      ? (((rolesRes.data as { result?: { data?: PayRole[] } })?.result?.data) ?? [])
      : [];
    const payRole = roles.find((r) => r.id === roleId);
    if (!payRole) throw redirect('/hr/payroll/config/roles');

    const usersPayload = usersRes.ok
      ? (usersRes.data as { result?: { data?: { users?: Array<Record<string, unknown>>; total?: number } } })?.result?.data
      : null;
    let staff: StaffRow[] = (usersPayload?.users ?? []).map((u) => ({
      id: String(u.id ?? ''),
      name: String(u.name ?? ''),
      role: String(u.role ?? ''),
      payRoleId: u.payRoleId ? String(u.payRoleId) : null,
    }));

    // Client-side pay-role assignment status filter (server doesn't know about pay role assignment)
    if (assignStatus === 'unassigned') {
      staff = staff.filter((s) => !s.payRoleId);
    } else if (assignStatus === 'assigned_this') {
      staff = staff.filter((s) => s.payRoleId === roleId);
    } else if (assignStatus === 'assigned_other') {
      staff = staff.filter((s) => s.payRoleId && s.payRoleId !== roleId);
    }

    const total = usersPayload?.total ?? 0;

    const branches: BranchOption[] = branchesRes.ok
      ? ((branchesRes.data as { result?: { data?: BranchOption[] } })?.result?.data ?? [])
      : [];

    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('payroll.config.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';

    return { payRole, roles, staff, total, page, limit: PAGE_SIZE, branches, canWrite, filters: { role, branchId, search, assignStatus } };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'bulkAssignPayRole') {
    const userIdsRaw = formData.get('userIds')?.toString() ?? '[]';
    let userIds: string[] = [];
    try { userIds = JSON.parse(userIdsRaw) as string[]; } catch { /* ignore */ }
    if (!userIds.length) return json({ error: 'No users selected' }, { status: 400 });

    const body = {
      userIds,
      payRoleId: formData.get('payRoleId')?.toString() ?? '',
      employmentType: formData.get('employmentType')?.toString() ?? 'STAFF',
      salaryBasis: formData.get('salaryBasis')?.toString() ?? 'FORMULA_BASED',
      taxStatus: formData.get('taxStatus')?.toString() ?? 'STANDARD_PAYE',
      crmLinked: formData.get('crmLinked') !== 'false',
    };

    const res = await apiRequest<unknown>('/trpc/hr.bulkAssignPayRole', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to assign pay role') },
        { status: safeStatus(res.status) },
      );
    }
    const result = (res.data as { result?: { data?: { assignedCount: number } } })?.result?.data;
    return json({ success: true, assignedCount: result?.assignedCount ?? 0 });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollAssignRoleRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollAssignRoleLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollAssignRolePage
          payRole={data.payRole}
          allRoles={data.roles}
          staff={data.staff}
          total={data.total}
          page={data.page}
          limit={data.limit}
          branches={data.branches}
          canWrite={data.canWrite}
          filters={data.filters}
        />
      )}
    </CachedAwait>
  );
}
