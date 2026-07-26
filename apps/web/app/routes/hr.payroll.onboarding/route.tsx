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
import { PayrollOnboardingPage } from '~/features/hr/PayrollOnboardingPage';
import { HRUsersListLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayrollOnboardingQueueItem } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Payroll onboarding — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER', 'HEAD_OF_CS'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'hr.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const res = await apiRequest<unknown>('/trpc/hr.listPayrollOnboardingQueue', { method: 'GET', cookie });
    const queue = res.ok
      ? (((res.data as { result?: { data?: PayrollOnboardingQueueItem[] } })?.result?.data) ?? [])
      : [];
    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('hr.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';
    return { queue, canWrite };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const userId = formData.get('userId')?.toString() ?? '';
  const comment = formData.get('comment')?.toString() || undefined;

  if (intent === 'approvePayrollOnboarding') {
    const res = await apiRequest<unknown>('/trpc/hr.approvePayrollOnboarding', {
      method: 'POST',
      cookie,
      body: { userId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to approve onboarding') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'rejectPayrollOnboarding') {
    const res = await apiRequest<unknown>('/trpc/hr.rejectPayrollOnboarding', {
      method: 'POST',
      cookie,
      body: { userId, comment },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reject onboarding') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollOnboardingRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<HRUsersListLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <PayrollOnboardingPage queue={data.queue} canWrite={data.canWrite} />}
    </CachedAwait>
  );
}
