import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, parsePerPage, requirePermission, requireStaffAccountsAccess } from '~/lib/api.server';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { UsersListPage } from '~/features/users/UsersListPage';
import type { User } from '~/features/users/types';
import { BRANCH_ELIGIBLE_IMPORT_ROLES } from '~/features/users/users-import-shared';

export const meta: MetaFunction = () => [
  { title: 'Users — Yannis EOSE' },
];

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'users.create');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'resendInvite') {
    const userId = formData.get('userId') as string;
    if (!userId) return json({ error: 'Missing userId' }, { status: 400 });

    const res = await apiRequest('/trpc/users.resendInvite', {
      method: 'POST',
      cookie,
      // `apiRequest` calls `JSON.stringify(body)` internally — pass the object, not a string.
      body: { userId },
    });

    if (!res.ok) {
      const msg = (res.data as Record<string, unknown>)?.message ?? 'Failed to resend invite';
      return json({ error: msg, intent }, { status: 400 });
    }

    return json({ success: true, intent, message: 'Invite re-sent successfully' });
  }

  if (intent === 'importUser') {
    // Per-row submit from <UsersImportModal>. The modal posts each row sequentially so the
    // client can render a real progress bar; the action calls the existing `users.create`
    // tRPC procedure verbatim, including its built-in approval flow for sensitive roles.
    // Failure surfaces with `{ error, rowIndex }` so the modal can mark the row as failed
    // and continue with the rest of the batch.
    const rowIndexRaw = formData.get('rowIndex')?.toString() ?? '';
    const rowIndex = Number.parseInt(rowIndexRaw, 10);

    const name = formData.get('name')?.toString().trim() ?? '';
    const email = formData.get('email')?.toString().trim() ?? '';
    const role = formData.get('role')?.toString().trim() ?? '';
    const phone = formData.get('phone')?.toString().trim() ?? '';
    const primaryBranchId = formData.get('primaryBranchId')?.toString().trim() ?? '';
    const branchIdsRaw = formData.get('branchIds')?.toString().trim() ?? '';
    const isProbation = formData.get('isProbation')?.toString() === 'true';
    const probationUntil = formData.get('probationUntil')?.toString().trim() || undefined;
    const roleNeedsBranch = BRANCH_ELIGIBLE_IMPORT_ROLES.has(role);

    if (!name || !email || !role || !phone) {
      return json(
        { error: 'name, email, role, and phone are required.', rowIndex },
        { status: 400 },
      );
    }
    if (roleNeedsBranch && !primaryBranchId) {
      return json(
        { error: 'primary branch is required for Marketing, Customer Support, and Branch Admin roles.', rowIndex },
        { status: 400 },
      );
    }

    let branchIds: string[] = [];
    try {
      branchIds = branchIdsRaw ? (JSON.parse(branchIdsRaw) as string[]) : primaryBranchId ? [primaryBranchId] : [];
    } catch {
      branchIds = primaryBranchId ? [primaryBranchId] : [];
    }
    if (primaryBranchId && !branchIds.includes(primaryBranchId)) branchIds.push(primaryBranchId);

    const body: Record<string, unknown> = {
      name,
      email,
      role,
      status: 'PENDING',
      phone,
      restrictProductAccess: false,
    };
    if (roleNeedsBranch) {
      body.primaryBranchId = primaryBranchId;
      body.branchIds = branchIds;
    }
    if (isProbation) {
      body.isProbation = true;
      if (probationUntil) body.probationUntil = probationUntil;
    }

    const res = await apiRequest<unknown>('/trpc/users.create', {
      method: 'POST',
      cookie,
      body,
    });

    if (!res.ok) {
      const data = res.data as { message?: string; error?: { message?: string } };
      const msg =
        data?.message ?? data?.error?.message ?? 'Failed to import user';
      return json({ error: msg, rowIndex }, { status: 400 });
    }

    const result = (res.data as { result?: { data?: { requiresApproval?: boolean } } })?.result?.data;
    return json({
      success: true,
      rowIndex,
      requiresApproval: result?.requiresApproval === true,
    });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireStaffAccountsAccess(request);
  const cookie = getSessionCookie(request);

  // Staff-accounts export carries sensitive payout/bank fields — gated on `hr.export`.
  const actorPerms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  const canExport = isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('hr.export'));

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status') || undefined;
  const roleParam = url.searchParams.get('role') || undefined;
  const searchRaw = url.searchParams.get('search')?.trim() ?? '';
  const searchParam = searchRaw.length > 120 ? searchRaw.slice(0, 120) : searchRaw;
  const probationOnlyParam = url.searchParams.get('probationOnly') === '1';
  const supervisorOnlyParam = url.searchParams.get('supervisorOnly') === '1';
  /**
   * Branch picker (admin-class only). `branchId` is a UUID; the sentinel
   * `__ORG_WIDE__` flips on `orgWideOnly`, which returns staff with no
   * branch memberships (Heads / HR / Finance / Admin). Service silently
   * ignores either flag for branch-scoped actors so a hand-crafted URL
   * can't widen their view.
   */
  const branchIdRaw = url.searchParams.get('branchId')?.trim() ?? '';
  const branchParam = branchIdRaw === '__ORG_WIDE__' || branchIdRaw === '' ? undefined : branchIdRaw;
  const orgWideOnlyParam = branchIdRaw === '__ORG_WIDE__';
  const pageParam = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const { perPage, pageSizeOptions } = parsePerPage(url.searchParams);
  const input: Record<string, unknown> = {
    page,
    limit: perPage,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    companyWideUserList: true,
  };
  if (statusParam && statusParam !== 'ALL') input.status = statusParam;
  if (roleParam && roleParam !== 'ALL') input.role = roleParam;
  if (searchParam.length > 0) input.search = searchParam;
  if (probationOnlyParam) input.probationOnly = true;
  if (supervisorOnlyParam) input.supervisorOnly = true;
  if (orgWideOnlyParam) input.orgWideOnly = true;
  else if (branchParam) input.branchId = branchParam;

  const inputEnc = encodeURIComponent(JSON.stringify(input));

  const summaryPayload: Record<string, unknown> = { companyWideUserList: true };
  if (statusParam && statusParam !== 'ALL') summaryPayload.status = statusParam;
  if (roleParam && roleParam !== 'ALL') summaryPayload.role = roleParam;
  if (searchParam.length > 0) summaryPayload.search = searchParam;
  if (probationOnlyParam) summaryPayload.probationOnly = true;
  if (supervisorOnlyParam) summaryPayload.supervisorOnly = true;
  if (orgWideOnlyParam) summaryPayload.orgWideOnly = true;
  else if (branchParam) summaryPayload.branchId = branchParam;
  const summaryEnc = encodeURIComponent(JSON.stringify(summaryPayload));

  type RosterSummary = {
    active: number;
    pending: number;
    inactiveArchived: number;
    distinctRoles: number;
  };
  const emptySummary: RosterSummary = {
    active: 0,
    pending: 0,
    inactiveArchived: 0,
    distinctRoles: 0,
  };

  // App Shell pattern — URL-derived filters/search/page render INSTANTLY
  // (sync below). Only the user roster fetch is deferred so the table body
  // shows skeleton rows while the rest of the page is fully interactive.
  const usersPromise: Promise<{
    users: User[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summary: RosterSummary;
  }> = (async () => {
    try {
      const [listRes, summaryRes] = await Promise.all([
        apiRequest<{ users: User[]; pagination: { total: number; page: number; limit: number; totalPages: number } }>(
          `/trpc/users.list?input=${inputEnc}`,
          { method: 'GET', cookie },
        ),
        apiRequest<unknown>(`/trpc/users.rosterSummary?input=${summaryEnc}`, { method: 'GET', cookie }),
      ]);

      let summary: RosterSummary = emptySummary;
      if (summaryRes.ok) {
        const raw = (summaryRes.data as { result?: { data?: Partial<RosterSummary> } })?.result?.data;
        if (raw) {
          summary = {
            active: Number(raw.active ?? 0),
            pending: Number(raw.pending ?? 0),
            inactiveArchived: Number(raw.inactiveArchived ?? 0),
            distinctRoles: Number(raw.distinctRoles ?? 0),
          };
        }
      }

      if (!listRes.ok) {
        return { users: [] as User[], total: 0, page, limit: 20, totalPages: 0, summary };
      }
      const trpcData = listRes.data as unknown as {
        result?: { data?: { users: User[]; pagination: { total: number; page: number; limit: number; totalPages: number } } };
      };
      const data = trpcData?.result?.data;
      const pagination = data?.pagination;
      return {
        users: data?.users ?? [],
        total: pagination?.total ?? 0,
        page: pagination?.page ?? page,
        limit: pagination?.limit ?? 20,
        totalPages: pagination?.totalPages ?? 0,
        summary,
      };
    } catch {
      return { users: [] as User[], total: 0, page, limit: 20, totalPages: 0, summary: emptySummary };
    }
  })();

  return defer({
    usersShell: {
      statusParam: statusParam ?? 'ALL',
      roleParam: roleParam ?? 'ALL',
      searchParam,
      branchParam: orgWideOnlyParam ? '__ORG_WIDE__' : (branchParam ?? 'ALL'),
      perPage,
      pageSizeOptions,
      canExport,
      /** Branch picker only renders for admin-class actors who legitimately see every branch. */
      canPickBranch: isAdminLevel(user),
    },
    usersPromise,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function UsersRoute() {
  const { usersShell, usersPromise } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={usersPromise}
      fallback={
        <UsersListPage
          usersPromise={usersPromise}
          statusParam={usersShell.statusParam}
          roleParam={usersShell.roleParam}
          searchParam={usersShell.searchParam}
          branchParam={usersShell.branchParam}
          canPickBranch={usersShell.canPickBranch}
          pageSize={usersShell.perPage}
          pageSizeOptions={usersShell.pageSizeOptions}
          canExport={usersShell.canExport}
        />
      }
      loaderShell={{ usersShell }}
      deferredKey="usersPromise"
    >
      {(roster) => (
        <UsersListPage
          statusParam={usersShell.statusParam}
          roleParam={usersShell.roleParam}
          searchParam={usersShell.searchParam}
          branchParam={usersShell.branchParam}
          canPickBranch={usersShell.canPickBranch}
          usersPromise={roster}
          pageSize={usersShell.perPage}
          pageSizeOptions={usersShell.pageSizeOptions}
          canExport={usersShell.canExport}
        />
      )}
    </CachedAwait>
  );
}
