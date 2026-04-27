import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { redirect } from '@remix-run/node';
import { isSuperAdminOnly } from '~/lib/rbac';
import { PermissionRequestsPage } from '~/features/permission-requests/PermissionRequestsPage';
import type { PermissionRequest } from '~/features/permission-requests/types';

export const meta: MetaFunction = () => [
  { title: 'Permission Requests — Yannis EOSE' },
];

const ALLOWED_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const;
type StatusFilter = (typeof ALLOWED_STATUSES)[number];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status')?.toUpperCase();
  const status: StatusFilter = ALLOWED_STATUSES.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : 'PENDING';

  const res = await apiRequest<unknown>(
    `/trpc/permissionRequests.list?input=${encodeURIComponent(JSON.stringify({ status }))}`,
    { method: 'GET', cookie },
  );

  const requests: PermissionRequest[] = res.ok
    ? ((res.data as { result?: { data?: PermissionRequest[] } })?.result?.data ?? [])
    : [];

  // UI affordance: admins, audit.read, and branch heads may open approve/reject (server enforces per request type).
  const canApprove =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    (user.permissions ?? []).includes('audit.read') ||
    user.role === 'HEAD_OF_CS' ||
    user.role === 'HEAD_OF_LOGISTICS' ||
    user.role === 'BRANCH_ADMIN';
  const canApproveProductArchive = isSuperAdminOnly(user);
  const canApproveOrderLinePriceChange =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    user.role === 'HEAD_OF_CS' ||
    user.role === 'HEAD_OF_LOGISTICS' ||
    user.role === 'BRANCH_ADMIN';

  return {
    requests,
    canApprove,
    canApproveProductArchive,
    canApproveOrderLinePriceChange,
    viewerId: user.id,
    status,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
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
      return json({ error: extractApiErrorMessage(res.data, 'Failed to approve') }, { status: safeStatus(res.status) });
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
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reject') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function PermissionRequestsRoute() {
  const {
    requests,
    canApprove,
    canApproveProductArchive,
    canApproveOrderLinePriceChange,
    viewerId,
    status,
  } = useLoaderData<typeof loader>();
  return (
    <PermissionRequestsPage
      requests={requests}
      canApprove={canApprove}
      canApproveProductArchive={canApproveProductArchive}
      canApproveOrderLinePriceChange={canApproveOrderLinePriceChange}
      viewerId={viewerId}
      activeStatus={status}
    />
  );
}
