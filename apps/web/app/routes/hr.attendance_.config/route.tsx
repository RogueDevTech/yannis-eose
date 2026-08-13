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
import { AttendanceConfigPage, type ExcludableStaff } from '~/features/hr/AttendanceConfigPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import { DEFAULT_ATTENDANCE_POLICY, type AttendancePolicyInput } from '@yannis/shared';

export const meta: MetaFunction = () => [{ title: 'Attendance config: Yannis EOSE' }];

const MANAGE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'HR_MANAGER'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: MANAGE_ROLES, permission: 'attendance.manage' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const [staffRes, policyRes] = await Promise.all([
      apiRequest<unknown>('/trpc/attendance.listExcludableStaff', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/attendance.getPolicy', { method: 'GET', cookie }),
    ]);
    const staff = staffRes.ok
      ? ((staffRes.data as { result?: { data?: ExcludableStaff[] } })?.result?.data ?? [])
      : [];
    const policy = policyRes.ok
      ? ((policyRes.data as { result?: { data?: AttendancePolicyInput } })?.result?.data ?? DEFAULT_ATTENDANCE_POLICY)
      : DEFAULT_ATTENDANCE_POLICY;
    return { staff, policy };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'setUsersExcludedBulk') {
    const scopeIds = (formData.get('scopeIds')?.toString() ?? '').split(',').filter(Boolean);
    const excludedIds = (formData.get('excludedIds')?.toString() ?? '').split(',').filter(Boolean);
    const res = await apiRequest<unknown>('/trpc/attendance.setUsersExcludedBulk', {
      method: 'POST',
      cookie,
      body: { scopeIds, excludedIds },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save exclusions') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, intent });
  }

  if (intent === 'saveAttendancePolicy') {
    const policyJson = formData.get('policyJson')?.toString()?.trim();
    let policy: unknown = null;
    try {
      if (policyJson) policy = JSON.parse(policyJson);
    } catch {
      return json({ error: 'Invalid policy payload' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/attendance.savePolicy', {
      method: 'POST',
      cookie,
      body: policy as Record<string, unknown>,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to save attendance policy') },
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
      {(data) => <AttendanceConfigPage staff={data.staff} policy={data.policy} />}
    </CachedAwait>
  );
}
