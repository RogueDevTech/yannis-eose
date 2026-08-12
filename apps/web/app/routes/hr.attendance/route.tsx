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
import type { AttendanceGridData, PayRoleConfigRow } from '~/features/hr/attendance-types';

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

  const pageData = (async () => {
    const input: Record<string, unknown> = { month };
    if (search) input.search = search;
    const inputEnc = encodeURIComponent(JSON.stringify(input));
    const [gridRes, rolesRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/attendance.grid?input=${inputEnc}`, { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/hr.listPayRoles', { method: 'GET', cookie }),
    ]);
    const grid = gridRes.ok
      ? ((gridRes.data as { result?: { data?: AttendanceGridData } })?.result?.data ?? null)
      : null;
    const payRoles = rolesRes.ok
      ? ((rolesRes.data as { result?: { data?: PayRoleConfigRow[] } })?.result?.data ?? [])
      : [];
    const perms = user.permissions ?? [];
    const canManage =
      perms.includes('attendance.manage') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';
    return { grid, payRoles, canManage, month, search: search ?? '' };
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

  if (intent === 'savePayRoleAttendanceConfig') {
    const payRoleId = formData.get('payRoleId')?.toString();
    const enabled = formData.get('enabled')?.toString() === 'true';
    const bandsJson = formData.get('bandsJson')?.toString()?.trim();
    let bands: unknown[] = [];
    try {
      if (bandsJson) {
        const parsed: unknown = JSON.parse(bandsJson);
        if (Array.isArray(parsed)) bands = parsed;
      }
    } catch {
      return json({ error: 'Invalid absence bands' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/attendance.savePayRoleConfig', {
      method: 'POST',
      cookie,
      body: { payRoleId, config: { enabled, bands } },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save attendance rules') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, intent });
  }

  if (intent === 'setUserAttendanceOverride') {
    const staffId = formData.get('staffId')?.toString();
    const raw = formData.get('attendanceAffectsPay')?.toString();
    const attendanceAffectsPay = raw === 'inherit' ? null : raw === 'true';
    const res = await apiRequest<unknown>('/trpc/attendance.setUserOverride', {
      method: 'POST',
      cookie,
      body: { staffId, attendanceAffectsPay },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to set override') },
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
          payRoles={data.payRoles}
          canManage={data.canManage}
          month={data.month}
          search={data.search}
        />
      )}
    </CachedAwait>
  );
}
