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
import { AttendancePage } from '~/features/hr/AttendancePage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { AttendanceGridData } from '~/features/hr/attendance-types';

export const meta: MetaFunction = () => [{ title: 'Attendance — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HR_MANAGER'];

/** Current month as YYYY-MM (server clock; UI can navigate months). */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'attendance.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const month = url.searchParams.get('month') ?? currentMonth();
  const search = url.searchParams.get('search') ?? undefined;
  const branchId = url.searchParams.get('branchId') ?? undefined;
  const role = url.searchParams.get('role') ?? undefined;
  const statusesParam = url.searchParams.get('statuses') ?? '';
  const statuses = statusesParam ? statusesParam.split(',').filter(Boolean) : [];

  const pageData = (async () => {
    const input: Record<string, unknown> = { month };
    if (search) input.search = search;
    if (branchId && branchId !== 'ALL') input.branchId = branchId;
    if (role && role !== 'ALL') input.role = role;
    if (statuses.length) input.statuses = statuses;
    const inputEnc = encodeURIComponent(JSON.stringify(input));
    const gridRes = await apiRequest<unknown>(`/trpc/attendance.grid?input=${inputEnc}`, {
      method: 'GET',
      cookie,
    });
    const grid = gridRes.ok
      ? ((gridRes.data as { result?: { data?: AttendanceGridData } })?.result?.data ?? null)
      : null;
    const perms = user.permissions ?? [];
    const canManage =
      perms.includes('attendance.manage') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';
    return {
      grid,
      canManage,
      month,
      search: search ?? '',
      branchId: branchId ?? 'ALL',
      role: role ?? 'ALL',
      statuses,
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

  if (intent === 'markAttendance') {
    const body: Record<string, unknown> = {
      staffId: formData.get('staffId')?.toString(),
      attendanceDate: formData.get('attendanceDate')?.toString(),
      status: formData.get('status')?.toString(),
    };
    const remark = formData.get('remark')?.toString()?.trim();
    if (remark) body.remark = remark;

    const res = await apiRequest<unknown>('/trpc/attendance.mark', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to mark attendance') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, intent });
  }

  if (intent === 'markAttendanceBulk') {
    const staffIds = (formData.get('staffIds')?.toString() ?? '').split(',').filter(Boolean);
    const body: Record<string, unknown> = {
      staffIds,
      attendanceDate: formData.get('attendanceDate')?.toString(),
      status: formData.get('status')?.toString(),
    };
    const remark = formData.get('remark')?.toString()?.trim();
    if (remark) body.remark = remark;

    const res = await apiRequest<unknown>('/trpc/attendance.markBulk', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to bulk mark attendance') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, intent });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AttendanceRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <AttendancePage
          grid={data.grid}
          canManage={data.canManage}
          month={data.month}
          search={data.search}
          branchId={data.branchId}
          role={data.role}
          statuses={data.statuses}
        />
      )}
    </CachedAwait>
  );
}
