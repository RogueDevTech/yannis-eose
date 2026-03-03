import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { PermissionRequestsPage } from '~/features/permission-requests/PermissionRequestsPage';
import type { PermissionRequest } from '~/features/permission-requests/types';

export const meta: MetaFunction = () => [
  { title: 'Permission Requests — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'audit.read');
  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>(
    '/trpc/permissionRequests.listPending?input=%7B%7D',
    { method: 'GET', cookie },
  );

  const requests: PermissionRequest[] = res.ok
    ? ((res.data as { result?: { data?: PermissionRequest[] } })?.result?.data ?? [])
    : [];

  return json({ requests });
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
      return json({ error: err?.error?.message ?? 'Failed to approve' }, { status: res.status });
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
      return json({ error: err?.error?.message ?? 'Failed to reject' }, { status: res.status });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PermissionRequestsRoute() {
  const { requests } = useLoaderData<typeof loader>();
  return <PermissionRequestsPage requests={requests} />;
}
