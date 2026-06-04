import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { defer, json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  getCurrentUser,
  requirePermissionOrRoles,
  safeStatus,
  DEFERRED_LOADER_TIMEOUT_MS,
  BULK_ORDER_MUTATION_TIMEOUT_MS,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { cachedClientLoader } from '~/lib/loader-cache';
import { CachedAwait } from '~/components/ui/cached-await';
import { FollowUpPage } from '~/features/cs/FollowUpPage';
import type { FollowUpPageData } from '~/features/cs/FollowUpPage';
import { FollowUpBatchesPage } from '~/features/cs/FollowUpBatchesPage';
import type { FollowUpBatchesPageData } from '~/features/cs/FollowUpBatchesPage';
import { FollowUpGroupsPage } from '~/features/cs/FollowUpGroupsPage';
import type { FollowUpGroupItem, CloserWithBranches } from '~/features/cs/FollowUpGroupsPage';
import type { PendingCart } from '~/features/cs/types';

export const meta: MetaFunction = () => [
  { title: 'Follow Up — Yannis EOSE' },
];

const ABANDONED_CART_STATUS = 'ABANDONED_CART';

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_CLOSER'],
  });
  const user = await getCurrentUser(request);
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const isCloser = user?.role === 'CS_CLOSER';
  // Closers only see batches view (no create/groups)
  const view = isCloser ? 'batches' : (url.searchParams.get('view') || 'batches');

  // ── Groups view ──────────────────────────────────────────────
  if (view === 'groups') {
    type GroupItem = { id: string; name: string; createdByName: string | null; memberCount: number; members: Array<{ userId: string; userName: string }>; createdAt: string };
    type CloserWithBranchesItem = { agentId: string; agentName: string; branches: Array<{ branchId: string; branchName: string }> };
    type GroupsBundle = { groups: GroupItem[]; closers: CloserWithBranchesItem[] };
    const pageData = (async (): Promise<GroupsBundle> => {
      try {
        const [groupsRes, closersRes] = await Promise.all([
          apiRequest<unknown>('/trpc/orders.listFollowUpGroups', { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS }),
          apiRequest<unknown>('/trpc/orders.listCSClosersWithBranches', { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS }),
        ]);
        const groups: GroupItem[] = groupsRes.ok
          ? ((groupsRes.data as { result?: { data?: GroupItem[] } })?.result?.data ?? [])
          : [];
        const closers: CloserWithBranchesItem[] = closersRes.ok
          ? ((closersRes.data as { result?: { data?: CloserWithBranchesItem[] } })?.result?.data ?? [])
          : [];
        return { groups, closers };
      } catch {
        return { groups: [], closers: [] };
      }
    })();

    return defer({
      shell: { view: 'groups' as const },
      pageData,
    });
  }

  // ── Batches view (default) ──────────────────────────────────
  if (view === 'batches' || view !== 'create') {
    const batchesPage = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const batchesPeriodAllTime = url.searchParams.get('period') === 'all_time';
    // Default to this month if no date params and not all-time
    const now = new Date();
    const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const defaultEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const startDate = batchesPeriodAllTime ? '' : (url.searchParams.get('startDate') || defaultStart);
    const endDate = batchesPeriodAllTime ? '' : (url.searchParams.get('endDate') || defaultEnd);

    const emptyBatches = { batches: [] as Array<{ id: string; name: string; source: string; branchName: string | null; createdByName: string | null; orderCount: number; confirmed: number; delivered: number; deliveredRevenue: string; confirmationRate: number; deliveryRate: number; createdAt: string }>, pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } };
    type GroupItem = { id: string; name: string; createdByName: string | null; memberCount: number; members: Array<{ userId: string; userName: string }>; createdAt: string };
    type CloserWithBranchesItem = { agentId: string; agentName: string; branches: Array<{ branchId: string; branchName: string }> };
    const batchesData = (async () => {
      try {
        const [batchesRes, groupsRes, closersRes] = await Promise.all([
          apiRequest<unknown>(
            `/trpc/orders.listFollowUpBatches?input=${encodeURIComponent(JSON.stringify({ page: batchesPage, limit: 20, ...(startDate && { startDate }), ...(endDate && { endDate }) }))}`,
            { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
          ),
          apiRequest<unknown>('/trpc/orders.listFollowUpGroups', { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS }),
          apiRequest<unknown>('/trpc/orders.listCSClosersWithBranches', { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS }),
        ]);
        const batches = batchesRes.ok
          ? ((batchesRes.data as { result?: { data?: typeof emptyBatches } })?.result?.data) ?? emptyBatches
          : emptyBatches;
        const groups: GroupItem[] = groupsRes.ok
          ? ((groupsRes.data as { result?: { data?: GroupItem[] } })?.result?.data ?? [])
          : [];
        const closers: CloserWithBranchesItem[] = closersRes.ok
          ? ((closersRes.data as { result?: { data?: CloserWithBranchesItem[] } })?.result?.data ?? [])
          : [];
        return { ...batches, groups, closers };
      } catch {
        return { ...emptyBatches, groups: [] as GroupItem[], closers: [] as CloserWithBranchesItem[] };
      }
    })();
    return defer({
      shell: { view: 'batches' as const, page: batchesPage, startDate, endDate, periodAllTime: batchesPeriodAllTime, isCloser, userId: user?.id },
      batchesData,
    });
  }

  // ── Create view — order/cart picker ─────────────────────────
  const ALL_FOLLOW_UP_STATUSES = [
    'DELETED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED',
    'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED',
  ];
  const statusParam = url.searchParams.get('statuses') || '';
  const statuses = statusParam.split(',').filter(Boolean);
  const isCartView = statuses.length === 1 && statuses[0] === ABANDONED_CART_STATUS;
  const search = url.searchParams.get('search') || undefined;
  const assignedCsId = url.searchParams.get('assignedCsId') || undefined;
  const olderThanDays = url.searchParams.get('olderThanDays') || undefined;
  const customStartDate = url.searchParams.get('startDate') || undefined;
  const customEndDate = url.searchParams.get('endDate') || undefined;
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = 50;

  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const countsInputStr = encodeURIComponent(JSON.stringify({ statuses: ALL_FOLLOW_UP_STATUSES }));

  // Build the order list input upfront so it can be serialized for deep-select.
  const listInput: Record<string, unknown> = { page, limit, sortBy: 'createdAt', sortOrder: 'desc', excludeFollowUp: false };
  if (!isCartView && statuses.length > 0) {
    const orderStatuses = statuses.filter((s) => s !== ABANDONED_CART_STATUS);
    if (orderStatuses.length === 1) listInput.status = orderStatuses[0];
    else if (orderStatuses.length > 1) listInput.statuses = orderStatuses;
    if (search) listInput.search = search;
    if (assignedCsId) listInput.assignedCsId = assignedCsId;
    if (customStartDate || customEndDate) {
      if (customStartDate) listInput.startDate = customStartDate;
      if (customEndDate) listInput.endDate = customEndDate;
    } else if (olderThanDays) {
      const days = parseInt(olderThanDays, 10);
      if (Number.isFinite(days) && days > 0) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        listInput.endDate = cutoff.toISOString().slice(0, 10);
      }
    }
  }

  const pageData = (async (): Promise<FollowUpPageData> => {
    const [closersRes, countsRes, productsRes, cartStatsRes, groupsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/orders.listCSClosers', deferredOpt),
      apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputStr}`, deferredOpt),
      apiRequest<unknown>(
        `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
        deferredOpt,
      ),
      apiRequest<unknown>('/trpc/cart.getStats?input=%7B%7D', deferredOpt),
      apiRequest<unknown>('/trpc/orders.listFollowUpGroups', deferredOpt),
    ]);

    const closers = closersRes.ok
      ? ((closersRes.data as { result?: { data?: Array<{ agentId: string; agentName: string }> } })?.result?.data ?? [])
      : [];
    const statusCounts = countsRes.ok
      ? ((countsRes.data as { result?: { data?: Record<string, number> } })?.result?.data ?? {})
      : {};
    const products = productsRes.ok
      ? ((productsRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data ?? [])
      : [];
    const cartStats = cartStatsRes.ok
      ? ((cartStatsRes.data as { result?: { data?: { abandonedOpen: number } } })?.result?.data ?? { abandonedOpen: 0 })
      : { abandonedOpen: 0 };

    type FollowUpGroupOption = { id: string; name: string; memberCount: number; members: Array<{ userId: string; userName: string }> };
    const groups: FollowUpGroupOption[] = groupsRes.ok
      ? ((groupsRes.data as { result?: { data?: FollowUpGroupOption[] } })?.result?.data ?? [])
      : [];

    statusCounts[ABANDONED_CART_STATUS] = cartStats.abandonedOpen;

    if (statuses.length === 0) {
      return { orders: [], total: 0, totalPages: 1, closers, statusCounts, products, abandonedCarts: [], abandonedCartsTotal: 0, abandonedCartsTotalPages: 1, groups };
    }

    if (isCartView) {
      const cartInput: Record<string, unknown> = { page, limit };
      if (search) cartInput.search = search;
      if (customStartDate || customEndDate) {
        if (customStartDate) cartInput.startDate = customStartDate;
        if (customEndDate) cartInput.endDate = customEndDate;
      } else if (olderThanDays) {
        const days = parseInt(olderThanDays, 10);
        if (Number.isFinite(days) && days > 0) {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - days);
          cartInput.endDate = cutoff.toISOString().slice(0, 10);
        }
      }
      const cartRes = await apiRequest<unknown>(
        `/trpc/cart.listAbandoned?input=${encodeURIComponent(JSON.stringify(cartInput))}`,
        deferredOpt,
      );
      const cartData = cartRes.ok
        ? (cartRes.data as { result?: { data?: { items: PendingCart[]; total: number; page: number; limit: number } } })?.result?.data
        : null;
      return { orders: [], total: 0, totalPages: 1, closers, statusCounts, products, abandonedCarts: cartData?.items ?? [], abandonedCartsTotal: cartData?.total ?? 0, abandonedCartsTotalPages: Math.max(1, Math.ceil((cartData?.total ?? 0) / limit)), groups };
    }

    const ordersRes = await apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(listInput))}`,
      deferredOpt,
    );
    const ordersData = ordersRes.ok
      ? (ordersRes.data as { result?: { data?: { orders: FollowUpPageData['orders']; pagination: { total: number; totalPages: number } } } })?.result?.data
      : null;
    return { orders: ordersData?.orders ?? [], total: ordersData?.pagination?.total ?? 0, totalPages: ordersData?.pagination?.totalPages ?? 1, closers, statusCounts, products, abandonedCarts: [], abandonedCartsTotal: 0, abandonedCartsTotalPages: 1, groups };
  })();

  // Serialize the listInput so the component can use it for deep-select
  // (cross-page "Select all matching" via fetchOrdersMatchingIds).
  const bulkSelectAllMatchingInput = !isCartView && statuses.length > 0
    ? JSON.stringify(listInput)
    : undefined;

  return defer({
    shell: {
      view: 'create' as const,
      statuses: statusParam,
      search: search ?? '',
      assignedCsId: assignedCsId ?? '',
      olderThanDays: olderThanDays ?? '',
      startDate: customStartDate ?? '',
      endDate: customEndDate ?? '',
      periodAllTime,
      page,
      bulkSelectAllMatchingInput,
    },
    pageData,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS'],
  });
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'reopenForFollowUp') {
    let orderIds: string[];
    try {
      orderIds = JSON.parse(formData.get('orderIds')?.toString() ?? '[]');
      if (!Array.isArray(orderIds)) throw new Error();
    } catch {
      return json({ error: 'Invalid order IDs' }, { status: 400 });
    }
    if (orderIds.length === 0) {
      return json({ error: 'Select at least one order' }, { status: 400 });
    }
    const targetBranchId = formData.get('targetBranchId')?.toString() || undefined;
    const batchName = formData.get('batchName')?.toString()?.trim() || '';
    const groupId = formData.get('groupId')?.toString() || undefined;
    const assignmentMode = (formData.get('assignmentMode')?.toString() as 'EQUAL' | 'MANUAL') || 'MANUAL';
    let originalStatuses: Record<string, string> = {};
    try { originalStatuses = JSON.parse(formData.get('originalStatuses')?.toString() ?? '{}'); } catch { /* ignore */ }

    const res = await apiRequest<unknown>('/trpc/orders.reopenForFollowUp', {
      method: 'POST',
      cookie,
      body: { orderIds, ...(targetBranchId ? { targetBranchId } : {}) },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reopen orders') },
        { status: safeStatus(res.status) },
      );
    }
    const data = (res.data as { result?: { data?: { succeeded: number; failed: number; results?: Array<{ orderId: string; success: boolean }> } } })?.result?.data;
    const succeededIds = (data?.results ?? []).filter((r) => r.success).map((r) => r.orderId);

    // Create batch record for tracking
    if (batchName && succeededIds.length > 0) {
      await apiRequest<unknown>('/trpc/orders.createFollowUpBatch', {
        method: 'POST',
        cookie,
        body: {
          name: batchName,
          source: 'orders',
          ...(targetBranchId ? { branchId: targetBranchId } : {}),
          ...(groupId ? { groupId } : {}),
          assignmentMode,
          items: succeededIds.map((id) => ({ orderId: id, originalStatus: originalStatuses[id] ?? 'UNKNOWN' })),
        },
      });
    }

    return json({ success: true, succeeded: data?.succeeded ?? 0, failed: data?.failed ?? 0 });
  }

  if (intent === 'createOfflineOrder') {
    const itemsRaw = formData.get('items')?.toString();
    let items: Array<{ productId: string; quantity: number; unitPrice: string; offerLabel?: string }>;
    try {
      items = JSON.parse(itemsRaw || '[]');
    } catch {
      return json({ error: 'Invalid items' }, { status: 400 });
    }
    const customerName = formData.get('customerName')?.toString()?.trim() ?? '';
    const customerPhone = formData.get('customerPhone')?.toString()?.trim() ?? '';
    if (customerName.length < 2) return json({ error: 'Customer name is required (min 2 characters)' }, { status: 400 });
    if (!customerPhone) return json({ error: 'Customer phone is required' }, { status: 400 });
    if (!items.length || items.some((i) => !i.productId || !i.quantity)) {
      return json({ error: 'At least one valid item is required' }, { status: 400 });
    }

    const body: Record<string, unknown> = {
      customerName,
      customerPhone,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice) || 0,
        ...(i.offerLabel ? { offerLabel: i.offerLabel } : {}),
      })),
    };
    const cartId = formData.get('cartId')?.toString()?.trim();
    if (cartId) body.cartId = cartId;
    const customerAddress = formData.get('customerAddress')?.toString()?.trim();
    if (customerAddress) body.customerAddress = customerAddress;
    const deliveryAddress = formData.get('deliveryAddress')?.toString()?.trim();
    if (deliveryAddress) body.deliveryAddress = deliveryAddress;
    const deliveryNotes = formData.get('deliveryNotes')?.toString()?.trim();
    if (deliveryNotes) body.deliveryNotes = deliveryNotes;
    const deliveryState = formData.get('deliveryState')?.toString()?.trim();
    if (deliveryState) body.deliveryState = deliveryState;
    const customerGender = formData.get('customerGender')?.toString()?.trim();
    if (customerGender) body.customerGender = customerGender;
    const preferredDeliveryDate = formData.get('preferredDeliveryDate')?.toString()?.trim();
    if (preferredDeliveryDate) body.preferredDeliveryDate = preferredDeliveryDate;
    const paymentMethod = formData.get('paymentMethod')?.toString()?.trim();
    if (paymentMethod) body.paymentMethod = paymentMethod;
    const customerEmail = formData.get('customerEmail')?.toString()?.trim();
    if (paymentMethod === 'PAY_ONLINE' && !customerEmail) {
      return json({ error: 'Email required for online payment' }, { status: 400 });
    }
    if (customerEmail) body.customerEmail = customerEmail;
    const totalAmount = formData.get('totalAmount')?.toString()?.trim();
    if (totalAmount) body.totalAmount = Number(totalAmount);

    const res = await apiRequest<unknown>('/trpc/orders.createOffline', {
      method: 'POST',
      cookie,
      body,
      timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create offline order') }, { status: safeStatus(res.status) });
    }
    const orderId = (res.data as { result?: { data?: { id: string } } })?.result?.data?.id;
    return json({ success: true, orderId });
  }

  if (intent === 'bulkRecoverCarts') {
    let cartIds: string[];
    try {
      cartIds = JSON.parse(formData.get('cartIds')?.toString() ?? '[]');
      if (!Array.isArray(cartIds)) throw new Error();
    } catch {
      return json({ error: 'Invalid cart IDs' }, { status: 400 });
    }
    if (cartIds.length === 0) {
      return json({ error: 'Select at least one cart' }, { status: 400 });
    }
    const targetBranchId = formData.get('targetBranchId')?.toString() || undefined;

    let succeeded = 0;
    let failed = 0;
    const createdOrderIds: string[] = [];
    for (const cartId of cartIds) {
      const res = await apiRequest<unknown>('/trpc/orders.recoverFromCart', {
        method: 'POST',
        cookie,
        body: { cartId },
        timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
      });
      if (res.ok) {
        succeeded++;
        const orderId = (res.data as { result?: { data?: { id: string } } })?.result?.data?.id;
        if (orderId) createdOrderIds.push(orderId);
      } else {
        failed++;
      }
    }

    // Move created orders to the target CS branch if specified
    if (targetBranchId && createdOrderIds.length > 0) {
      await apiRequest<unknown>('/trpc/orders.reopenForFollowUp', {
        method: 'POST',
        cookie,
        body: { orderIds: createdOrderIds, targetBranchId },
        timeoutMs: BULK_ORDER_MUTATION_TIMEOUT_MS,
      });
    }

    // Create batch record for tracking
    const batchName = formData.get('batchName')?.toString()?.trim() || '';
    const cartGroupId = formData.get('groupId')?.toString() || undefined;
    const cartAssignmentMode = (formData.get('assignmentMode')?.toString() as 'EQUAL' | 'MANUAL') || 'MANUAL';
    if (batchName && createdOrderIds.length > 0) {
      await apiRequest<unknown>('/trpc/orders.createFollowUpBatch', {
        method: 'POST',
        cookie,
        body: {
          name: batchName,
          source: 'carts',
          ...(targetBranchId ? { branchId: targetBranchId } : {}),
          ...(cartGroupId ? { groupId: cartGroupId } : {}),
          assignmentMode: cartAssignmentMode,
          items: createdOrderIds.map((id) => ({ orderId: id, originalStatus: 'ABANDONED_CART' })),
        },
      });
    }

    return json({ success: true, succeeded, failed });
  }

  // ── Group CRUD ──────────────────────────────────────────────
  if (intent === 'createFollowUpGroup') {
    const name = formData.get('groupName')?.toString()?.trim() ?? '';
    if (!name) return json({ error: 'Group name is required' }, { status: 400 });
    let memberIds: string[];
    try { memberIds = JSON.parse(formData.get('memberIds')?.toString() ?? '[]'); } catch { memberIds = []; }
    if (memberIds.length === 0) return json({ error: 'Select at least one member' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/orders.createFollowUpGroup', {
      method: 'POST', cookie, body: { name, memberIds },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to create group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'updateFollowUpGroup') {
    const groupId = formData.get('groupId')?.toString();
    if (!groupId) return json({ error: 'Group ID is required' }, { status: 400 });
    const name = formData.get('groupName')?.toString()?.trim() || undefined;
    let memberIds: string[] | undefined;
    const memberIdsRaw = formData.get('memberIds')?.toString();
    if (memberIdsRaw) { try { memberIds = JSON.parse(memberIdsRaw); } catch { memberIds = undefined; } }

    const res = await apiRequest<unknown>('/trpc/orders.updateFollowUpGroup', {
      method: 'POST', cookie, body: { groupId, name, memberIds },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'deleteFollowUpGroup') {
    const groupId = formData.get('groupId')?.toString();
    if (!groupId) return json({ error: 'Group ID is required' }, { status: 400 });

    const res = await apiRequest<unknown>('/trpc/orders.deleteFollowUpGroup', {
      method: 'POST', cookie, body: { groupId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to delete group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FollowUpRoute() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loaderData = useLoaderData<typeof loader>() as any;
  const shell = loaderData.shell;
  const view: string = shell?.view ?? 'batches';

  if (view === 'groups') {
    type GroupsBundle = { groups: FollowUpGroupItem[]; closers: CloserWithBranches[] };
    return (
      <CachedAwait<GroupsBundle>
        resolve={loaderData.pageData as Promise<GroupsBundle>}
        fallback={<FollowUpGroupsPage groups={[]} closers={[]} deferredLoading />}
        loaderShell={{ shell }}
        deferredKey="pageData"
      >
        {(data) => <FollowUpGroupsPage groups={data.groups} closers={data.closers} />}
      </CachedAwait>
    );
  }

  if (view === 'batches') {
    type BatchesBundle = FollowUpBatchesPageData & { groups: FollowUpGroupItem[]; closers: CloserWithBranches[] };
    const batchesPage: number = shell?.page ?? 1;
    return (
      <CachedAwait<BatchesBundle>
        resolve={loaderData.batchesData as Promise<BatchesBundle>}
        fallback={
          <FollowUpBatchesPage
            batches={[]}
            pagination={{ page: 1, limit: 20, total: 0, totalPages: 1 }}
            page={batchesPage}
            startDate={shell?.startDate ?? ''}
            endDate={shell?.endDate ?? ''}
            periodAllTime={shell?.periodAllTime ?? false}
            isCloser={shell?.isCloser ?? false}
            groups={[]}
            closers={[]}
            deferredLoading
          />
        }
        loaderShell={{ shell }}
        deferredKey="batchesData"
      >
        {(data) => (
          <FollowUpBatchesPage
            {...data}
            page={batchesPage}
            startDate={shell?.startDate ?? ''}
            endDate={shell?.endDate ?? ''}
            periodAllTime={shell?.periodAllTime ?? false}
            isCloser={shell?.isCloser ?? false}
          />
        )}
      </CachedAwait>
    );
  }

  const filters = {
    view: 'create',
    statuses: shell?.statuses ?? '',
    search: shell?.search ?? '',
    assignedCsId: shell?.assignedCsId ?? '',
    olderThanDays: shell?.olderThanDays ?? '',
    startDate: shell?.startDate ?? '',
    endDate: shell?.endDate ?? '',
    periodAllTime: shell?.periodAllTime ?? false,
    page: shell?.page ?? 1,
  };
  const bulkSelectAllMatchingInput: string | undefined = shell?.bulkSelectAllMatchingInput;
  return (
    <CachedAwait<FollowUpPageData>
      resolve={loaderData.pageData as Promise<FollowUpPageData>}
      fallback={
        <FollowUpPage
          orders={[]}
          total={0}
          totalPages={1}
          closers={[]}
          statusCounts={{}}
          products={[]}
          abandonedCarts={[]}
          abandonedCartsTotal={0}
          abandonedCartsTotalPages={1}
          filters={filters}
          deferredLoading
        />
      }
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <FollowUpPage
          {...data}
          filters={filters}
          bulkSelectAllMatchingInput={bulkSelectAllMatchingInput}
        />
      )}
    </CachedAwait>
  );
}
