import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser, requirePermission, safeStatus } from '~/lib/api.server';
import { redirect } from '@remix-run/node';
import { PermissionRequestsPage } from '~/features/permission-requests/PermissionRequestsPage';
import type { PermissionRequest } from '~/features/permission-requests/types';

export const meta: MetaFunction = () => [
  { title: 'Permission Requests — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>(
    '/trpc/permissionRequests.listPending?input=%7B%7D',
    { method: 'GET', cookie },
  );

  const requests: PermissionRequest[] = res.ok
    ? ((res.data as { result?: { data?: PermissionRequest[] } })?.result?.data ?? [])
    : [];

  // SUPER_ADMIN + ADMIN and users with audit.read can approve/reject.
  // NOTE: true approval of Admin-level roles is still enforced server-side to SuperAdmin only.
  const canApprove = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || (user.permissions ?? []).includes('audit.read');

  return { requests, canApprove };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'audit.read');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const requestId = formData.get('requestId')?.toString() ?? '';
  const reason = formData.get('reason')?.toString() ?? '';

  if (!requestId || !reason || reason.length < 10) {
    return json({ error: 'A reason of at least 10 characters is required' }, { status: 400 });
  }

  if (intent === 'approve') {
    const res = await apiRequest<unknown>('/trpc/permissionRequests.approve', {
      method: 'POST',
      cookie,
      body: { requestId, reason },
    });
    if (!res.ok) {
      const err = res.data as { error?: { message?: string } };
      return json({ error: err?.error?.message ?? 'Failed to approve' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'reject') {
    const res = await apiRequest<unknown>('/trpc/permissionRequests.reject', {
      method: 'POST',
      cookie,
      body: { requestId, reason },
    });
    if (!res.ok) {
      const err = res.data as { error?: { message?: string } };
      return json({ error: err?.error?.message ?? 'Failed to reject' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PermissionRequestsRoute() {
  const { requests, canApprove } = useLoaderData<typeof loader>();
  return <PermissionRequestsPage requests={requests} canApprove={canApprove} />;
}
