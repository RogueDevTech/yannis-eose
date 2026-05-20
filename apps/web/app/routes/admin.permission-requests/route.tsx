import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { redirect } from '@remix-run/node';
import { isSuperAdminOnly } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import {
  PermissionRequestsPage,
  type PermissionRequestBranchPicklist,
} from '~/features/permission-requests/PermissionRequestsPage';
import { PermissionRequestsLoadingShell } from '~/features/permission-requests/PermissionRequestsLoadingShell';
import type { PermissionRequest } from '~/features/permission-requests/types';

export const meta: MetaFunction = () => [
  { title: 'Permission Requests — Yannis EOSE' },
];

const ALLOWED_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const;
type StatusFilter = (typeof ALLOWED_STATUSES)[number];

const PER_PAGE = 20;

/**
 * Permission codes that grant approve rights for at least one request type.
 * Anyone holding ANY of these can land on the page and see rows for those types
 * (server-side filter scopes the data). Admin-class users bypass.
 *
 * Other roles can still reach the page by URL — they'll see only their own
 * submissions thanks to the server-side scope.
 */
const APPROVER_CODES = [
  'permission_requests.user_creation.approve',
  'permission_requests.role_change.approve',
  'permission_requests.permission_grant.approve',
  'permission_requests.product_archive.approve',
  'permission_requests.order_line_price.approve',
  'permission_requests.order_deletion.approve',
] as const;

/** True when the viewer can either approve a type or might have submitted one. */
function viewerCanSeePermissionRequests(user: {
  role: string;
  permissions?: string[];
}): boolean {
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') return true;
  const perms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  if (APPROVER_CODES.some((code) => perms.includes(canonicalPermissionCode(code)))) {
    return true;
  }
  // Submitters (Sales Closer / Media Buyer / HoMarketing / etc.) need to track their own
  // requests; they pass the gate but only see their own rows.
  if (
    user.role === 'CS_CLOSER' ||
    user.role === 'HEAD_OF_MARKETING' ||
    user.role === 'MEDIA_BUYER' ||
    user.role === 'HEAD_OF_CS' ||
    user.role === 'HEAD_OF_LOGISTICS' ||
    user.role === 'BRANCH_ADMIN'
  ) {
    return true;
  }
  return false;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (!viewerCanSeePermissionRequests(user)) {
    throw redirect('/admin/unauthorized?missing=permission-requests.view');
  }
  const cookie = getSessionCookie(request);

  const url = new URL(request.url);
  const rawStatus = url.searchParams.get('status')?.toUpperCase();
  const status: StatusFilter = ALLOWED_STATUSES.includes(rawStatus as StatusFilter)
    ? (rawStatus as StatusFilter)
    : 'ALL';

  const pageRaw = parseInt(url.searchParams.get('page') || '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const permissionRequestsShell = { status };

  const pageData = (async () => {
  const listInput = encodeURIComponent(JSON.stringify({ status, page, limit: PER_PAGE }));
  const [listRes, countsRes, branchesRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/permissionRequests.list?input=${listInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/permissionRequests.statusCounts`, { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
  ]);

  type ListPayload = {
    items: PermissionRequest[];
    total: number;
    page: number;
    limit: number;
  };
  const listPayload = listRes.ok
    ? ((listRes.data as { result?: { data?: ListPayload } })?.result?.data ?? null)
    : null;
  const requests: PermissionRequest[] = listPayload?.items ?? [];
  const total = listPayload?.total ?? 0;
  const totalPages = total > 0 ? Math.ceil(total / PER_PAGE) : 1;

  type StatusCounts = { pending: number; approved: number; rejected: number; all: number };
  const statusCounts: StatusCounts = countsRes.ok
    ? ((countsRes.data as { result?: { data?: StatusCounts } })?.result?.data ?? {
        pending: 0,
        approved: 0,
        rejected: 0,
        all: 0,
      })
    : { pending: 0, approved: 0, rejected: 0, all: 0 };

  type BranchRow = { id: string; name: string };
  const branchesListRaw = branchesRes.ok
    ? ((branchesRes.data as { result?: { data?: BranchRow[] } })?.result?.data ?? [])
    : [];
  const branches: PermissionRequestBranchPicklist = branchesListRaw.map((b) => ({
    id: b.id,
    name: b.name,
  }));

  // UI affordance flags — drive button visibility on each row. The actual gate is
  // enforced server-side in `assertApproverMayProcessRequest`, so these checks just
  // hide buttons for codes the user doesn't hold (avoids dead clicks).
  const isAdminClass = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const hasCode = (code: string) =>
    isAdminClass || userPerms.includes(canonicalPermissionCode(code));
  const canApprove =
    hasCode('permission_requests.user_creation.approve') ||
    hasCode('permission_requests.role_change.approve') ||
    hasCode('permission_requests.permission_grant.approve') ||
    hasCode('permission_requests.product_archive.approve') ||
    hasCode('permission_requests.order_line_price.approve') ||
    hasCode('permission_requests.order_deletion.approve');
  // PRODUCT_ARCHIVE is locked to SuperAdmin only by default (no role template
  // grants the code). Keep that explicit in the loader so the UI matches.
  const canApproveProductArchive =
    isSuperAdminOnly(user) || hasCode('permission_requests.product_archive.approve');
  const canApproveOrderLinePriceChange =
    hasCode('permission_requests.order_line_price.approve') ||
    hasCode('permission_requests.order_deletion.approve');

  return {
    requests,
    total,
    page,
    totalPages,
    limit: PER_PAGE,
    statusCounts,
    branches,
    canApprove,
    canApproveProductArchive,
    canApproveOrderLinePriceChange,
    viewerId: user.id,
    status,
  };
  })();

  return defer({ permissionRequestsShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const requestId = formData.get('requestId')?.toString() ?? '';
  const reasonRaw = formData.get('reason')?.toString() ?? '';
  const reason = reasonRaw.trim();

  if (!requestId || reason.length < 5) {
    return json({ error: 'A reason of at least 5 characters is required' }, { status: 400 });
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
  const { permissionRequestsShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<PermissionRequestsLoadingShell activeStatus={permissionRequestsShell.status} />}
      loaderShell={{ permissionRequestsShell }}
      deferredKey="pageData"
    >
      {(data) => (
          <PermissionRequestsPage
            requests={data.requests}
            total={data.total}
            page={data.page}
            totalPages={data.totalPages}
            limit={data.limit}
            statusCounts={data.statusCounts}
            branches={data.branches}
            canApprove={data.canApprove}
            canApproveProductArchive={data.canApproveProductArchive}
            canApproveOrderLinePriceChange={data.canApproveOrderLinePriceChange}
            viewerId={data.viewerId}
            activeStatus={data.status}
          />
        )}
    </CachedAwait>
  );
}
