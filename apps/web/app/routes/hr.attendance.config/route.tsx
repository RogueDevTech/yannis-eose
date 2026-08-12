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
import { AttendanceConfigPage } from '~/features/hr/AttendanceConfigPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayRoleConfigRow } from '~/features/hr/attendance-types';

export const meta: MetaFunction = () => [{ title: 'Attendance config — Yannis EOSE' }];

const MANAGE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HR_MANAGER'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: MANAGE_ROLES, permission: 'attendance.manage' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const res = await apiRequest<unknown>('/trpc/hr.listPayRoles', { method: 'GET', cookie });
    const payRoles = res.ok
      ? ((res.data as { result?: { data?: PayRoleConfigRow[] } })?.result?.data ?? [])
      : [];
    return { payRoles };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

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

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AttendanceConfigRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <AttendanceConfigPage payRoles={data.payRoles} />}
    </CachedAwait>
  );
}
