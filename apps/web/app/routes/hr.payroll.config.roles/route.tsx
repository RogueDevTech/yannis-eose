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
import { PayrollConfigRolesPage } from '~/features/hr/PayrollConfigRolesPage';
import { PayrollConfigLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type { PayRole } from '~/features/hr/payroll-prd-types';

export const meta: MetaFunction = () => [{ title: 'Pay roles — Yannis EOSE' }];

const VIEWER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER', 'HEAD_OF_CS'];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: VIEWER_ROLES, permission: 'payroll.config.read' });
  const user = await getCurrentUser(request);
  if (!user) throw redirect('/auth');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const rolesRes = await apiRequest<unknown>('/trpc/hr.listPayRoles', { method: 'GET', cookie });

    const roles = rolesRes.ok
      ? (((rolesRes.data as { result?: { data?: PayRole[] } })?.result?.data) ?? [])
      : [];

    const perms = user.permissions ?? [];
    const canWrite =
      perms.includes('payroll.config.write') ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HR_MANAGER';

    return { roles, canWrite };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'archivePayRole') {
    const body = { id: formData.get('payRoleId')?.toString() ?? '' };
    const res = await apiRequest<unknown>('/trpc/hr.archivePayRole', { method: 'POST', cookie, body });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to archive pay role') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PayrollConfigRolesRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PayrollConfigLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <PayrollConfigRolesPage
          roles={data.roles}
          canWrite={data.canWrite}
        />
      )}
    </CachedAwait>
  );
}
