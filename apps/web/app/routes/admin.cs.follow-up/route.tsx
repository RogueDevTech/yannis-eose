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
import type { PendingCart } from '~/features/cs/types';

export const meta: MetaFunction = () => [
  { title: 'Follow Up — Yannis EOSE' },
];

const ABANDONED_CART_STATUS = 'ABANDONED_CART';

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN'],
  });
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);

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
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = 50;

  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  // Status counts for all follow-up-relevant statuses
  const countsInputStr = encodeURIComponent(JSON.stringify({ statuses: ALL_FOLLOW_UP_STATUSES }));

  const pageData = (async (): Promise<FollowUpPageData> => {
    // Always fetch counts, closers, products, and cart stats
    const [closersRes, countsRes, productsRes, cartStatsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/orders.listCSClosers', deferredOpt),
      apiRequest<unknown>(`/trpc/orders.statusCounts?input=${countsInputStr}`, deferredOpt),
      apiRequest<unknown>(
        `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
        deferredOpt,
      ),
      apiRequest<unknown>('/trpc/cart.getStats?input=%7B%7D', deferredOpt),
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

    // Add abandoned cart count to statusCounts
    statusCounts[ABANDONED_CART_STATUS] = cartStats.abandonedOpen;

    // No statuses selected — return only counts (no orders fetched)
    if (statuses.length === 0) {
      return {
        orders: [],
        total: 0,
        totalPages: 1,
        closers,
        statusCounts,
        products,
        abandonedCarts: [],
        abandonedCartsTotal: 0,
        abandonedCartsTotalPages: 1,
      };
    }

    if (isCartView) {
      // Fetch abandoned carts instead of orders
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

      return {
        orders: [],
        total: 0,
        totalPages: 1,
        closers,
        statusCounts,
        products,
        abandonedCarts: cartData?.items ?? [],
        abandonedCartsTotal: cartData?.total ?? 0,
        abandonedCartsTotalPages: Math.max(1, Math.ceil((cartData?.total ?? 0) / limit)),
      };
    }

    // Fetch orders
    const listInput: Record<string, unknown> = {
      page, limit, sortBy: 'createdAt', sortOrder: 'desc',
    };
    // Filter out the cart pseudo-status
    const orderStatuses = statuses.filter((s) => s !== ABANDONED_CART_STATUS);
    if (orderStatuses.length === 1) listInput.status = orderStatuses[0];
    else if (orderStatuses.length > 1) listInput.statuses = orderStatuses;

    if (search) listInput.search = search;
    if (assignedCsId) listInput.assignedCsId = assignedCsId;
    // Custom date range takes priority over olderThanDays preset
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

    const ordersRes = await apiRequest<unknown>(
      `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(listInput))}`,
      deferredOpt,
    );
    const ordersData = ordersRes.ok
      ? (ordersRes.data as { result?: { data?: { orders: FollowUpPageData['orders']; pagination: { total: number; totalPages: number } } } })?.result?.data
      : null;

    return {
      orders: ordersData?.orders ?? [],
      total: ordersData?.pagination?.total ?? 0,
      totalPages: ordersData?.pagination?.totalPages ?? 1,
      closers,
      statusCounts,
      products,
      abandonedCarts: [],
      abandonedCartsTotal: 0,
      abandonedCartsTotalPages: 1,
    };
  })();

  return defer({
    shell: {
      statuses: statusParam,
      search: search ?? '',
      assignedCsId: assignedCsId ?? '',
      olderThanDays: olderThanDays ?? '',
      startDate: customStartDate ?? '',
      endDate: customEndDate ?? '',
      page,
    },
    pageData,
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, {
    permission: 'orders.followUp',
    roles: ['SUPER_ADMIN', 'ADMIN'],
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

    return json({ success: true, succeeded, failed });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FollowUpRoute() {
  const { shell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait<FollowUpPageData>
      resolve={pageData as Promise<FollowUpPageData>}
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
          filters={shell}
          deferredLoading
        />
      }
      loaderShell={{ shell }}
      deferredKey="pageData"
    >
      {(data) => (
        <FollowUpPage
          {...data}
          filters={shell}
        />
      )}
    </CachedAwait>
  );
}
