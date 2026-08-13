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
import { StaffAttendanceDetailPage } from '~/features/hr/StaffAttendanceDetailPage';
import { StaffAttendanceDetailLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { AttendanceSummaryData } from '~/features/hr/attendance-types';

export const meta: MetaFunction = () => [{ title: 'Staff attendance: Yannis EOSE' }];

const MANAGE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HR_MANAGER'];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function daysInMonth(month: string): number {
  const parts = month.split('-');
  return new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 0)).getUTCDate();
}

/** Month (YYYY-MM) the page shows, derived from the global DateFilterBar's startDate. */
function monthFromDateFilter(url: URL): string {
  const startDate = url.searchParams.get('startDate') ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return startDate.slice(0, 7);
  const legacy = url.searchParams.get('month') ?? '';
  if (/^\d{4}-\d{2}$/.test(legacy)) return legacy;
  return currentMonth();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: MANAGE_ROLES, permission: 'attendance.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);
  const staffId = params.staffId!;

  const url = new URL(request.url);
  const month = monthFromDateFilter(url);

  const pageData = (async () => {
    const inputEnc = encodeURIComponent(JSON.stringify({ month, staffId }));
    const res = await apiRequest<unknown>(`/trpc/attendance.summary?input=${inputEnc}`, {
      method: 'GET',
      cookie,
    });
    const summary = res.ok
      ? ((res.data as { result?: { data?: AttendanceSummaryData } })?.result?.data ?? null)
      : null;
    const perms = user.permissions ?? [];
    const canManage =
      perms.includes('attendance.manage') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';
    return {
      summary,
      canManage,
      month,
      startDate: url.searchParams.get('startDate') ?? `${month}-01`,
      endDate: url.searchParams.get('endDate') ?? `${month}-${String(daysInMonth(month)).padStart(2, '0')}`,
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const staffId = params.staffId!;

  if (intent === 'markAttendance') {
    const body: Record<string, unknown> = {
      staffId,
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

  // Fill a date range with a status in ONE call (markRange handles clamping to
  // employment window + today, and onlyBlank skipping).
  if (intent === 'markMonth') {
    const body: Record<string, unknown> = {
      staffId,
      startDate: formData.get('startDate')?.toString(),
      endDate: formData.get('endDate')?.toString(),
      status: formData.get('status')?.toString(),
      onlyBlank: formData.get('onlyBlank')?.toString() === 'true',
    };
    const res = await apiRequest<unknown>('/trpc/attendance.markRange', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to mark month') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, intent });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function StaffAttendanceDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<StaffAttendanceDetailLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <StaffAttendanceDetailPage summary={data.summary} canManage={data.canManage} month={data.month} startDate={data.startDate} endDate={data.endDate} />
      )}
    </CachedAwait>
  );
}
