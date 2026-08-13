import { defer, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getCurrentUser, getSessionCookie } from '~/lib/api.server';
import { MyAttendancePage } from '~/features/hr/MyAttendancePage';
import type { AttendanceSummaryData } from '~/features/hr/attendance-types';

export const meta: MetaFunction = () => [{ title: 'My Attendance — Yannis EOSE' }];

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const month = url.searchParams.get('month') ?? currentMonth();

  const pageData = (async () => {
    const inputEnc = encodeURIComponent(JSON.stringify({ month }));
    const res = await apiRequest<unknown>(`/trpc/attendance.summary?input=${inputEnc}`, {
      method: 'GET',
      cookie,
    });
    const summary = res.ok
      ? ((res.data as { result?: { data?: AttendanceSummaryData } })?.result?.data ?? null)
      : null;
    return { summary, month };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function MyAttendanceRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<div className="p-6 text-sm text-app-fg-muted">Loading…</div>} loaderShell={{}} deferredKey="pageData">
      {(data) => <MyAttendancePage summary={data.summary} month={data.month} />}
    </CachedAwait>
  );
}
