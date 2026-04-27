import { useLoaderData } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requireStaffAccountsAccess, getCurrentUser, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { canAccessGlobalAuditLog } from '~/lib/rbac';
import { DeferredSection } from '~/components/ui/deferred-section';
import { UserDetailPage } from '~/features/users/UserDetailPage';
import type {
  UserDetail,
  UserDetailLoaderData,
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserOrderSummary,
  UserPayoutRecord,
  UserAdjustment,
  UserAuditEntry,
  UserMarketingMetrics,
  PendingEmailChange,
  UserStockMovement,
  UserApprovalRecord,
  UserPushStatus,
  ActiveHeadUser,
  FinanceHatHolder,
} from '~/features/users/types';

export const meta: MetaFunction = () => [
  { title: 'User Detail — Yannis EOSE' },
];

// ─── Loader ─────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);

  const cookie = getSessionCookie(request);
  const userId = params['id'];

  if (!userId) {
    throw new Response('User ID required', { status: 400 });
  }

  // Fetch profile user first (getById is authed — any logged-in user can call)
  const userRes = await apiRequest<unknown>(
    `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie },
  );
  if (!userRes.ok) {
    return defer({ userDetail: Promise.resolve({ notFound: true as const }) });
  }
  const trpcData = userRes.data as { result?: { data?: UserDetail } };
  const profileUser = trpcData?.result?.data;
  if (!profileUser) {
    return defer({ userDetail: Promise.resolve({ notFound: true as const }) });
  }

  // Access model for /hr/users/:id:
  //  - Self-view: any authenticated user may open their own profile (drives /admin/profile).
  //  - Head of CS  may view their CS team (CS_AGENT, HEAD_OF_CS) — nothing else.
  //  - Head of Marketing may view their Marketing team (MEDIA_BUYER, HEAD_OF_MARKETING) — nothing else.
  //  - Everyone else must hold `hr.read` (HR_MANAGER) or be admin-level.
  // HoM/HoCS still carry `users.read` globally for other features (team leaderboards, push
  // target search, etc.), so we can't just require `users.read` — we'd leak unrelated profiles.
  const isSelfView = currentUser.id === profileUser.id;
  const headOfCSViewingTeam =
    currentUser.role === 'HEAD_OF_CS' && ['CS_AGENT', 'HEAD_OF_CS'].includes(profileUser.role);
  const headOfMarketingViewingTeam =
    currentUser.role === 'HEAD_OF_MARKETING' && ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(profileUser.role);
  const isHoMOrHoCS = currentUser.role === 'HEAD_OF_MARKETING' || currentUser.role === 'HEAD_OF_CS';

  if (!isSelfView && isHoMOrHoCS && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    throw new Response('This user is not on your team.', { status: 403 });
  }
  if (!isSelfView && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    await requireStaffAccountsAccess(request);
  }

  const user = profileUser;

  const userDetailPromise = (async (): Promise<UserDetailLoaderData | { notFound: true }> => {
    const perms = currentUser?.permissions ?? [];
    // Treat ADMIN the same as SUPER_ADMIN for admin-level capabilities on this page.
    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';
    const isViewerHeadOfMarketing = currentUser?.role === 'HEAD_OF_MARKETING';
    const isViewerHeadOfCS = currentUser?.role === 'HEAD_OF_CS';
    // Team-lead scoped edit: HoCS can edit CS_AGENTs on their branch; HoM can edit MEDIA_BUYERs
    // on their branch. Restricted to capacity / productIds / visibleOrderStatuses. Enforced
    // server-side by UsersService.update; this flag just tells the UI to show the limited form.
    const canEditLimited =
      !!currentUser?.currentBranchId &&
      profileUser.primaryBranchId === currentUser.currentBranchId &&
      (
        (isViewerHeadOfCS && profileUser.role === 'CS_AGENT') ||
        (isViewerHeadOfMarketing && profileUser.role === 'MEDIA_BUYER')
      );
    // Disbursements page is Finance → HoM only; HoM distributes to Media Buyers from Marketing → Funding.
    const canDisburseToThisUser =
      user.role === 'HEAD_OF_MARKETING' && (isSuperAdmin || perms.includes('finance.disburse'));

    // ── Build role-specific order filter ───────────────────
    const orderFilter: Record<string, unknown> = { limit: 10 };
  if (['CS_AGENT', 'HEAD_OF_CS'].includes(user.role)) {
    orderFilter.csAgentId = userId;
  } else if (['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(user.role)) {
    orderFilter.mediaBuyerId = userId;
  } else if (['TPL_RIDER'].includes(user.role)) {
    orderFilter.riderId = userId;
  }

  // ── Deferred: all secondary data in parallel ───────────
  const productsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20 }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));

  const products: Promise<UserCreateProduct[]> = apiRequest<unknown>(
    `/trpc/products.list?input=${productsInput}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: { products: UserCreateProduct[] } } };
      return d?.result?.data?.products ?? [];
    })
    .catch(() => []);

  const locations: Promise<UserCreateLocation[]> = apiRequest<unknown>(
    `/trpc/logistics.listLocations?input=${locationsInput}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: { locations: UserCreateLocation[] } } };
      return d?.result?.data?.locations ?? [];
    })
    .catch(() => []);

  const plans: Promise<UserCreateCommissionPlan[]> = apiRequest<unknown>(
    `/trpc/hr.listPlans?input=${plansInput}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: { plans: UserCreateCommissionPlan[] } } };
      return d?.result?.data?.plans ?? [];
    })
    .catch(() => []);

  // Recent orders (role-aware) — skip for roles without order attribution
  const needsOrders = ['CS_AGENT', 'HEAD_OF_CS', 'MEDIA_BUYER', 'HEAD_OF_MARKETING', 'TPL_RIDER', 'HEAD_OF_LOGISTICS', 'TPL_MANAGER'].includes(user.role);
  const recentOrders: Promise<{ orders: UserOrderSummary[]; total: number }> = needsOrders
    ? apiRequest<unknown>(
        `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(orderFilter))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
      if (!res.ok) return { orders: [], total: 0 };
      const d = res.data as { result?: { data?: { orders: UserOrderSummary[]; pagination: { total: number } } } };
      return {
        orders: d?.result?.data?.orders ?? [],
        total: d?.result?.data?.pagination?.total ?? 0,
      };
        })
        .catch(() => ({ orders: [], total: 0 }))
    : Promise.resolve({ orders: [], total: 0 });

  // Payout history — skip for roles without payroll
  const needsPayouts = ['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'HEAD_OF_CS', 'CS_AGENT', 'TPL_RIDER', 'HR_MANAGER'].includes(user.role);
  const payouts: Promise<UserPayoutRecord[]> = needsPayouts
    ? apiRequest<unknown>(
        `/trpc/hr.listPayouts?input=${encodeURIComponent(JSON.stringify({ staffId: userId, limit: 10 }))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return [];
          const d = res.data as { result?: { data?: { payouts: UserPayoutRecord[] } } };
          return d?.result?.data?.payouts ?? [];
        })
        .catch(() => [])
    : Promise.resolve([]);

  // Adjustments (bonuses/deductions)
  const adjustments: Promise<UserAdjustment[]> = apiRequest<unknown>(
    `/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({ staffId: userId }))}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: UserAdjustment[] } };
      return d?.result?.data ?? [];
    })
    .catch(() => []);

  // Audit trail (actions by this user) — same gate as global audit page.
  const auditLog: Promise<UserAuditEntry[]> = canAccessGlobalAuditLog(currentUser)
    ? apiRequest<unknown>(
        `/trpc/audit.globalLog?input=${encodeURIComponent(JSON.stringify({ actorId: userId, page: 1, limit: 20 }))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return [];
          const d = res.data as {
            result?: {
              data?: {
                rows: Array<{
                  id: string;
                  action: string;
                  tableName: string;
                  recordId: string;
                  data: Record<string, unknown>;
                  validFrom: string;
                }>;
              };
            };
          };
          const rows = d?.result?.data?.rows ?? [];
          return rows.map((r) => ({
            id: r.id,
            action: r.action,
            tableName: r.tableName,
            recordId: r.recordId,
            oldValues: null,
            newValues: r.data,
            createdAt: r.validFrom,
            data: r.data,
          })) as UserAuditEntry[];
        })
        .catch(() => [])
    : Promise.resolve([]);

  // Marketing metrics (only for MEDIA_BUYER / HEAD_OF_MARKETING)
  const isMarketingRole = ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(user.role);
  const marketingMetrics: Promise<UserMarketingMetrics | null> = isMarketingRole
    ? apiRequest<unknown>(
        `/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify({ mediaBuyerId: userId }))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return null;
          const d = res.data as { result?: { data?: UserMarketingMetrics } };
          return d?.result?.data ?? null;
        })
        .catch(() => null)
    : Promise.resolve(null);

  // Funding balance (only for HEAD_OF_MARKETING / MEDIA_BUYER — recipients of disbursements)
  const fundingBalance: Promise<{ totalReceived: string; totalSpend: string; balance: string } | null> = isMarketingRole
    ? apiRequest<unknown>(
        `/trpc/marketing.getFundingBalance?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return null;
          const d = res.data as { result?: { data?: { totalReceived: string; totalSpend: string; balance: string } } };
          return d?.result?.data ?? null;
        })
        .catch(() => null)
    : Promise.resolve(null);

  const pendingEmailChange: Promise<PendingEmailChange | null> = apiRequest<unknown>(
    `/trpc/users.getPendingEmailChange?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return null;
      const d = res.data as { result?: { data?: PendingEmailChange | null } };
      return d?.result?.data ?? null;
    })
    .catch(() => null);

  // Stock movements (for STOCK_MANAGER, TPL_MANAGER, HEAD_OF_LOGISTICS)
  const isStockRole = ['STOCK_MANAGER', 'TPL_MANAGER', 'HEAD_OF_LOGISTICS'].includes(user.role);
  const stockMovements: Promise<{ movements: UserStockMovement[]; total: number }> | null = isStockRole
    ? apiRequest<unknown>(
        `/trpc/inventory.movements?input=${encodeURIComponent(JSON.stringify({ actorId: userId, page: 1, limit: 20 }))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return { movements: [], total: 0 };
          const d = res.data as { result?: { data?: { movements: UserStockMovement[]; pagination: { total: number } } } };
          return {
            movements: d?.result?.data?.movements ?? [],
            total: d?.result?.data?.pagination?.total ?? 0,
          };
        })
        .catch(() => ({ movements: [], total: 0 }))
    : null;

  // Finance activity (approvals processed by this user — for FINANCE_OFFICER)
  const isFinanceRole = user.role === 'FINANCE_OFFICER';
  const financeActivity: Promise<{ approvals: UserApprovalRecord[]; total: number }> | null = isFinanceRole
    ? apiRequest<unknown>(
        `/trpc/finance.listApprovalRequests?input=${encodeURIComponent(JSON.stringify({ approverId: userId, page: 1, limit: 20 }))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return { approvals: [], total: 0 };
          const d = res.data as { result?: { data?: { requests: Array<{ id: string; type: string; amount: string; description: string; status: string; approvedAt: string | null; createdAt: string }>; pagination: { total: number } } } };
          const requests = d?.result?.data?.requests ?? [];
          return {
            approvals: requests.map((r) => ({
              id: r.id,
              type: r.type,
              amount: r.amount,
              description: r.description,
              status: r.status,
              approvedAt: r.approvedAt,
              createdAt: r.createdAt,
            })),
            total: d?.result?.data?.pagination?.total ?? 0,
          };
        })
        .catch(() => ({ approvals: [], total: 0 }))
    : null;

  // Active HEAD_OF_* users so the edit form can warn about duplicate heads in the same branch.
  const activeHeads: Promise<ActiveHeadUser[]> = apiRequest<unknown>(
    '/trpc/users.listActiveHeads',
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: ActiveHeadUser[] } };
      return d?.result?.data ?? [];
    })
    .catch(() => []);

  // Current Finance-hat holder (if any) — lets the edit form warn about reassignment.
  const currentFinanceOfficer: Promise<FinanceHatHolder | null> = apiRequest<unknown>(
    '/trpc/users.getCurrentFinanceOfficer',
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return null;
      const d = res.data as { result?: { data?: FinanceHatHolder | null } };
      return d?.result?.data ?? null;
    })
    .catch(() => null);

  // Active branches for the edit form's warning (to show branch name in the message).
  const branchesList: Promise<Array<{ id: string; name: string; code: string; status: string }>> =
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie })
      .then((res) => {
        if (!res.ok) return [];
        const d = res.data as { result?: { data?: Array<{ id: string; name: string; code: string; status: string }> } };
        return d?.result?.data ?? [];
      })
      .catch(() => []);

  // Push notification status (SuperAdmin only — requires users.read permission)
  const pushStatus: Promise<UserPushStatus | null> = isSuperAdmin
    ? apiRequest<unknown>(
        `/trpc/notifications.getPushStatusForUser?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return null;
          const d = res.data as { result?: { data?: UserPushStatus } };
          return d?.result?.data ?? null;
        })
        .catch(() => null)
    : Promise.resolve(null);

    const mirrorRes = await apiRequest<unknown>(
      `/trpc/branches.canMirrorToUser?input=${encodeURIComponent(JSON.stringify({ targetUserId: profileUser.id }))}`,
      { method: 'GET', cookie },
    );
    const mirrorPayload = mirrorRes.data as { result?: { data?: { allowed: boolean } } } | undefined;
    const viewerCanMirror =
      profileUser.status === 'ACTIVE' &&
      mirrorRes.ok &&
      mirrorPayload?.result?.data?.allowed === true;

    return { user, products, locations, plans, recentOrders, payouts, adjustments, auditLog, marketingMetrics, fundingBalance, pendingEmailChange, stockMovements, financeActivity, pushStatus, activeHeads, currentFinanceOfficer, branchesList, canDisburseToThisUser, isSuperAdmin, isViewerHeadOfMarketing, isViewerHeadOfCS, canEditLimited, viewerCanMirror, isSelfView };
  })();

  return defer({ userDetail: userDetailPromise });
}

// ─── Action ─────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const userId = params['id'];

  if (!userId) {
    return json({ error: 'User ID required' }, { status: 400 });
  }

  if (intent === 'update') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    );
    if (!targetRes.ok) {
      return json({ error: 'User not found' }, { status: 404 });
    }
    const targetPayload = targetRes.data as {
      result?: {
        data?: {
          role: string;
          name: string;
          email: string;
          status: string;
          capacity: number;
          logisticsLocationId: string | null;
          restrictProductAccess: boolean;
          assignedProductIds?: string[];
          isFinanceOfficer?: boolean;
        };
      };
    };
    const target = targetPayload?.result?.data;
    if (!target) {
      return json({ error: 'User not found' }, { status: 404 });
    }
    // Protect admin-level accounts from HR-side edits. Admins manage admins via their own flows.
    if (target.role === 'SUPER_ADMIN' || target.role === 'ADMIN') {
      return json({ error: 'SuperAdmin/Admin accounts cannot be updated from this page. Use Settings to edit your own profile.' }, { status: 403 });
    }

    const body: Record<string, unknown> = { userId };
    const prevAssignedKey = [...(target.assignedProductIds ?? [])].sort().join('\0');

    const name = formData.get('name')?.toString().trim() ?? '';
    if (name.length >= 2 && name !== target.name) {
      body.name = name;
    }

    const email = formData.get('email')?.toString().trim() ?? '';
    if (email.length > 0 && email.toLowerCase() !== target.email.toLowerCase()) {
      body.email = email;
    }

    const role = formData.get('role')?.toString();
    if (role && role !== target.role) {
      body.role = role;
    }

    const status = formData.get('status')?.toString();
    if (status && status !== target.status) {
      body.status = status;
    }

    const capacityStr = formData.get('capacity')?.toString();
    if (capacityStr !== undefined && capacityStr !== '') {
      const capacity = parseInt(capacityStr, 10);
      if (!Number.isNaN(capacity) && capacity !== target.capacity) {
        body.capacity = capacity;
      }
    }

    if (formData.has('logisticsLocationId')) {
      const raw = formData.get('logisticsLocationId')?.toString() ?? '';
      const next = raw || null;
      const prev = target.logisticsLocationId ?? null;
      if (next !== prev) {
        body.logisticsLocationId = next;
      }
    }

    const phone = formData.get('phone')?.toString().trim() ?? '';
    if (phone.length > 0) {
      body.phone = phone;
    }

    const productIdsStr = formData.get('productIds')?.toString();
    if (productIdsStr) {
      try {
        const ids = JSON.parse(productIdsStr) as unknown;
        if (Array.isArray(ids) && ids.every((id): id is string => typeof id === 'string')) {
          const nextAssignedKey = [...ids].sort().join('\0');
          if (nextAssignedKey !== prevAssignedKey) {
            body.productIds = ids;
          }
          const submittedRestrict =
            formData.get('restrictProductAccess') === 'true' ||
            formData.get('restrictProductAccess') === 'on';
          if (submittedRestrict !== target.restrictProductAccess) {
            body.restrictProductAccess = submittedRestrict;
          }
        }
      } catch {
        /* invalid productIds JSON */
      }
    }

    if (formData.has('isFinanceOfficer')) {
      const nextHat = formData.get('isFinanceOfficer')?.toString() === 'true';
      if (nextHat !== !!target.isFinanceOfficer) {
        body.isFinanceOfficer = nextHat;
      }
    }

    const changedKeys = Object.keys(body).filter((k) => k !== 'userId');
    if (changedKeys.length === 0) {
      return json({ success: true, message: 'No changes to save' });
    }

    const res = await apiRequest<unknown>('/trpc/users.update', {
      method: 'POST', cookie, body,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update user') }, { status: safeStatus(res.status) });
    }

    const result = res.data as { result?: { data?: { emailChangePending?: boolean; requiresApproval?: boolean; requestId?: string; message?: string } } };
    const data = result?.result?.data;
    if (data?.requiresApproval) {
      return json({
        success: true,
        requiresApproval: true,
        requestId: data.requestId,
        message: data.message ?? 'Role change request submitted. SuperAdmin will review.',
      });
    }

    const emailChangePending = data?.emailChangePending;
    return json({
      success: true,
      message: emailChangePending
        ? 'User updated. Email change is pending SuperAdmin approval.'
        : 'User updated successfully',
      emailChangePending,
    });
  }

  if (intent === 'deactivate') {
    const currentUser = await getCurrentUser(request);
    if (currentUser?.role !== 'SUPER_ADMIN' && currentUser?.role !== 'ADMIN') {
      return json({ error: 'Only Super Admins and Admins can deactivate users.' }, { status: 403 });
    }

    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN' || targetData?.result?.data?.role === 'ADMIN') {
      return json({ error: 'SuperAdmin accounts cannot be deactivated.' }, { status: 403 });
    }
    // Admins cannot deactivate another admin-level user. Only SuperAdmin can.
    if (targetData?.result?.data?.role === 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      return json({ error: 'Only the SuperAdmin can deactivate another Admin.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.deactivate', {
      method: 'POST', cookie, body: { userId },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to deactivate user') }, { status: safeStatus(res.status) });
    }

    return redirect('/hr/users');
  }

  if (intent === 'reactivate') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN' || targetData?.result?.data?.role === 'ADMIN') {
      return json({ error: 'SuperAdmin/Admin accounts cannot be reactivated from this page.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.update', {
      method: 'POST', cookie, body: { userId, status: 'ACTIVE' },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reactivate user') }, { status: safeStatus(res.status) });
    }

    return json({ success: true, message: 'User reactivated successfully' });
  }

  if (intent === 'processEmailChange') {
    const requestId = formData.get('requestId')?.toString();
    const action = formData.get('action')?.toString() as 'APPROVED' | 'REJECTED' | undefined;
    const reason = formData.get('reason')?.toString() ?? '';

    if (!requestId || !action || !reason || reason.length < 10) {
      return json({ error: 'Request ID, action (APPROVED/REJECTED), and reason (min 10 chars) are required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.processEmailChange', {
      method: 'POST', cookie, body: { requestId, action, reason },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to process email change') }, { status: safeStatus(res.status) });
    }

    return json({ success: true, message: action === 'APPROVED' ? 'Email updated successfully' : 'Email change rejected' });
  }

  if (intent === 'resetPassword') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN' || targetData?.result?.data?.role === 'ADMIN') {
      return json({ error: 'SuperAdmin/Admin must reset password from Settings.' }, { status: 403 });
    }

    const newPassword = formData.get('newPassword')?.toString() ?? '';

    if (newPassword.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.resetPassword', {
      method: 'POST', cookie, body: { userId, newPassword },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reset password') }, { status: safeStatus(res.status) });
    }

    return json({ success: true, message: 'Password reset successfully' });
  }

  // Mirror Mode — view the app as this user (read-only). Permission gate is enforced
  // server-side in AuthService.startMirror; this just forwards the cookie + target id and
  // bounces to /admin so the freshly-mirrored session takes effect immediately.
  if (intent === 'mirror') {
    const res = await apiRequest<unknown>('/auth/mirror/start', {
      method: 'POST', cookie, body: { targetUserId: userId },
    });
    if (!res.ok) {
      const errorData = res.data as { message?: string; error?: string };
      return json({ error: errorData?.message ?? errorData?.error ?? 'Failed to start mirror' }, { status: safeStatus(res.status) });
    }
    throw redirect('/admin');
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

// ─── Component ──────────────────────────────────────────

export default function UserDetailRoute() {
  const { userDetail } = useLoaderData<typeof loader>();
  return (
    <DeferredSection resolve={userDetail} skeleton="card">
      {(data) =>
        'notFound' in data && data.notFound ? (
          <div className="card text-center py-12">
            <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
            <h2 className="text-xl font-bold text-app-fg">User not found</h2>
            <p className="mt-2 text-sm text-app-fg-muted">
              The user you're looking for doesn't exist or has been removed.
            </p>
            <a href="/hr/users" className="btn-primary mt-4 inline-block">
              Back to Users
            </a>
          </div>
        ) : (
          <UserDetailPage {...(data as UserDetailLoaderData)} />
        )
      }
    </DeferredSection>
  );
}
