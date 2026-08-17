import { defer, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getCurrentUser, getSessionCookie } from '~/lib/api.server';
import { TeamAttendancePage, type TeamAttendanceRow } from '~/features/hr/TeamAttendancePage';

export const meta: MetaFunction = () => [{ title: 'Team Attendance: Yannis EOSE' }];

// HR/admin roles that can always view; other users need the team-supervisor flag.
const HR_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HR_MANAGER', 'BRANCH_ADMIN']);

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  // Gate: HR/admin, or a team supervisor (e.g. a CS manager). Non-supervisors get 403.
  const allowed = HR_ROLES.has(user.role) || user.isTeamSupervisor === true;
  if (!allowed) throw new Response('Forbidden', { status: 403 });

  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const month = url.searchParams.get('month') ?? currentMonth();

  const pageData = (async () => {
    const inputEnc = encodeURIComponent(JSON.stringify({ month }));
    const res = await apiRequest<unknown>(`/trpc/attendance.teamSummary?input=${inputEnc}`, {
      method: 'GET',
      cookie,
    });
    const rows = res.ok
      ? ((res.data as { result?: { data?: TeamAttendanceRow[] } })?.result?.data ?? [])
      : [];
    return { rows, month };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function TeamAttendanceRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<div className="p-6 text-sm text-app-fg-muted">Loading…</div>}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => <TeamAttendancePage rows={data.rows} month={data.month} />}
    </CachedAwait>
  );
}
