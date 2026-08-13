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
import { AttendanceReportPage } from '~/features/hr/AttendanceReportPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { AttendanceGridData } from '~/features/hr/attendance-types';

export const meta: MetaFunction = () => [{ title: 'Attendance report: Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HR_MANAGER'];

/** Today as YYYY-MM-DD (server clock). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'attendance.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  // Driven by the global DateFilterBar. A RANGE (start ≠ end) → monthly/period
  // report (the priority view); a single pinned day (start === end, or legacy
  // ?date=) → the daily report.
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const startParam = url.searchParams.get('startDate') ?? '';
  const endParam = url.searchParams.get('endDate') ?? '';
  const dateParam = url.searchParams.get('date') ?? '';

  const startDate = dateRe.test(startParam)
    ? startParam
    : dateRe.test(dateParam)
      ? dateParam
      : today();
  const endDate = dateRe.test(endParam) ? endParam : startDate;
  // Report period is the RANGE unless it collapses to one day.
  const mode: 'range' | 'day' = startDate === endDate ? 'day' : 'range';
  const month = startDate.slice(0, 7); // grid is fetched a whole month at a time

  const pageData = (async () => {
    const input = { month };
    const inputEnc = encodeURIComponent(JSON.stringify(input));
    const [gridRes, policyRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/attendance.grid?input=${inputEnc}`, { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/attendance.getPolicy', { method: 'GET', cookie }),
    ]);
    const grid = gridRes.ok
      ? ((gridRes.data as { result?: { data?: AttendanceGridData } })?.result?.data ?? null)
      : null;
    // Non-work days are hidden/excluded from the report. Default Mon–Fri.
    const policyData = policyRes.ok
      ? ((policyRes.data as { result?: { data?: { workDays?: number[] } } })?.result?.data ?? null)
      : null;
    const workDays = policyData?.workDays ?? [1, 2, 3, 4, 5];
    return { grid, mode, date: startDate, startDate, endDate, month, workDays };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function AttendanceReportRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <AttendanceReportPage
          grid={data.grid}
          mode={data.mode}
          date={data.date}
          startDate={data.startDate}
          endDate={data.endDate}
          month={data.month}
          workDays={data.workDays}
        />
      )}
    </CachedAwait>
  );
}
