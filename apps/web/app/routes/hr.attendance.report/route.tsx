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

export const meta: MetaFunction = () => [{ title: 'Attendance report — Yannis EOSE' }];

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
  const dateParam = url.searchParams.get('date') ?? '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today();
  const month = date.slice(0, 7); // grid is fetched a whole month at a time

  const pageData = (async () => {
    const input = { month };
    const inputEnc = encodeURIComponent(JSON.stringify(input));
    const gridRes = await apiRequest<unknown>(`/trpc/attendance.grid?input=${inputEnc}`, {
      method: 'GET',
      cookie,
    });
    const grid = gridRes.ok
      ? ((gridRes.data as { result?: { data?: AttendanceGridData } })?.result?.data ?? null)
      : null;
    return { grid, date };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function AttendanceReportRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <AttendanceReportPage grid={data.grid} date={data.date} />}
    </CachedAwait>
  );
}
