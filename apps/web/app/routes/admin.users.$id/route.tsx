import { useLoaderData } from '@remix-run/react';
import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermission, getCurrentUser } from '~/lib/api.server';
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
} from '~/features/users/types';

export const meta: MetaFunction = () => [
  { title: 'User Detail — Yannis EOSE' },
];

// ─── Loader ─────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, ['users.read', 'users.update']);
  const cookie = getSessionCookie(request);
  const userId = params['id'];

  if (!userId) {
    throw new Response('User ID required', { status: 400 });
  }

  // Critical: await user (404 check required)
  const userRes = await apiRequest<unknown>(
    `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie },
  );

  if (!userRes.ok) {
    throw new Response('User not found', { status: 404 });
  }

  const trpcData = userRes.data as { result?: { data?: UserDetail } };
  const user = trpcData?.result?.data;

  if (!user) {
    throw new Response('User not found', { status: 404 });
  }

  const currentUser = await getCurrentUser(request);
  const perms = currentUser?.permissions ?? [];
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';
  const canDisburseToThisUser =
    (user.role === 'HEAD_OF_MARKETING' && (isSuperAdmin || perms.includes('finance.disburse'))) ||
    (user.role === 'MEDIA_BUYER' && (isSuperAdmin || perms.includes('marketing.funding')));

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
  const productsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 100 }));
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

  // Audit trail (actions by this user)
  const auditLog: Promise<UserAuditEntry[]> = apiRequest<unknown>(
    `/trpc/audit.globalLog?input=${encodeURIComponent(JSON.stringify({ actorId: userId, page: 1, limit: 20 }))}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: { rows: UserAuditEntry[] } } };
      return d?.result?.data?.rows ?? [];
    })
    .catch(() => []);

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

  // Stock movements (for WAREHOUSE_MANAGER, TPL_MANAGER, HEAD_OF_LOGISTICS)
  const isStockRole = ['WAREHOUSE_MANAGER', 'TPL_MANAGER', 'HEAD_OF_LOGISTICS'].includes(user.role);
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

  return { user, products, locations, plans, recentOrders, payouts, adjustments, auditLog, marketingMetrics, pendingEmailChange, stockMovements, financeActivity, canDisburseToThisUser };
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
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN') {
      return json({ error: 'SuperAdmin accounts cannot be updated from this page. Use Settings to edit your own profile.' }, { status: 403 });
    }

    const body: Record<string, unknown> = { userId };

    const name = formData.get('name')?.toString();
    const email = formData.get('email')?.toString();
    const role = formData.get('role')?.toString();
    const status = formData.get('status')?.toString();
    const capacityStr = formData.get('capacity')?.toString();
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString();
    const phone = formData.get('phone')?.toString();
    const visibleOrderStatusesStr = formData.get('visibleOrderStatuses')?.toString();
    const productIdsStr = formData.get('productIds')?.toString();
    const restrictProductAccess = formData.get('restrictProductAccess');

    if (name) body.name = name;
    if (email) body.email = email;
    if (role) body.role = role;
    if (status) body.status = status;
    if (capacityStr) body.capacity = parseInt(capacityStr, 10);
    if (logisticsLocationId !== undefined) body.logisticsLocationId = logisticsLocationId || null;
    if (phone !== undefined) body.phone = phone || null;
    if (visibleOrderStatusesStr) {
      try { body.visibleOrderStatuses = JSON.parse(visibleOrderStatusesStr); } catch { /* skip */ }
    }
    if (productIdsStr) {
      try { body.productIds = JSON.parse(productIdsStr); } catch { /* skip */ }
    }
    if (restrictProductAccess !== null) body.restrictProductAccess = restrictProductAccess === 'true';

    const res = await apiRequest<unknown>('/trpc/users.update', {
      method: 'POST', cookie, body,
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update user' }, { status: res.status });
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
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN') {
      return json({ error: 'SuperAdmin accounts cannot be deactivated.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.deactivate', {
      method: 'POST', cookie, body: { userId },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to deactivate user' }, { status: res.status });
    }

    return redirect('/admin/users');
  }

  if (intent === 'reactivate') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN') {
      return json({ error: 'SuperAdmin accounts cannot be reactivated from this page.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.update', {
      method: 'POST', cookie, body: { userId, status: 'ACTIVE' },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to reactivate user' }, { status: res.status });
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
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to process email change' }, { status: res.status });
    }

    return json({ success: true, message: action === 'APPROVED' ? 'Email updated successfully' : 'Email change rejected' });
  }

  if (intent === 'resetPassword') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN') {
      return json({ error: 'SuperAdmin must reset password from Settings.' }, { status: 403 });
    }

    const newPassword = formData.get('newPassword')?.toString() ?? '';

    if (newPassword.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.resetPassword', {
      method: 'POST', cookie, body: { userId, newPassword },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to reset password' }, { status: res.status });
    }

    return json({ success: true, message: 'Password reset successfully' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

// ─── Component ──────────────────────────────────────────

export default function UserDetailRoute() {
  const data = useLoaderData<typeof loader>() as UserDetailLoaderData;
  return <UserDetailPage {...data} />;
}
