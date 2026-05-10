import { useMemo } from 'react';
import { Await, useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { defer, json } from '@remix-run/node';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  getCurrentUser,
  ORDER_VOIP_ACTION_TIMEOUT_MS,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { OrderDetailPage } from '~/features/orders/OrderDetailPage';
import { OrderDetailSkeleton } from '~/features/orders/OrderDetailSkeleton';
import type {
  CallLogEntry,
  OrderDetail,
  OrderDetailLoaderResult,
  OrderDetailStreamData,
  OrderInvoice,
  TimelineEvent,
} from '~/features/orders/types';
import { trpcOrderGetByIdIsNotFound } from '~/lib/trpc-http-response';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';

export const meta: MetaFunction = () => [
  { title: 'Order Detail — Yannis EOSE' },
];

function logOrderDetailLoaderWarning(orderId: string, callName: string, detail?: string): void {
  const suffix = detail ? ` (${detail})` : '';
  console.warn(`[OrderDetailLoader] ${callName} failed for order ${orderId}${suffix}`);
}

function branchIdFromForm(formData: FormData): { branchId: string } | Record<string, never> {
  const b = formData.get('branchId')?.toString()?.trim();
  return b ? { branchId: b } : {};
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, ['orders.read', 'marketing.orders']);
  const cookie = getSessionCookie(request);
  const orderId = params['id'];

  if (!orderId) {
    throw new Response('Order ID required', { status: 400 });
  }
  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };

  const orderDetailPromise = (async (): Promise<OrderDetailLoaderResult> => {
    const [orderRes, voipRes] = await Promise.all([
      apiRequest<unknown>(
        `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
        deferredOpt,
      ),
      apiRequest<unknown>('/trpc/voip.isEnabled', deferredOpt).catch((err) => {
        const msg = err instanceof Error ? err.message : 'unknown';
        logOrderDetailLoaderWarning(orderId, 'voip.isEnabled', msg);
        return { ok: false, status: 503, data: {} };
      }),
    ]);

    if (!orderRes.ok) {
      if (trpcOrderGetByIdIsNotFound(orderRes.status, orderRes.data)) {
        return { notFound: true };
      }
      return {
        loadError: extractApiErrorMessage(
          orderRes.data,
          'This order could not be loaded. Try again in a moment. If it keeps failing, the API database may need pending migrations applied.',
        ),
      };
    }

    const trpcData = orderRes.data as { result?: { data?: OrderDetail } };
    const order = trpcData?.result?.data;

    if (!order) return { notFound: true };

    // `voip.isEnabled` returns the on/off flag plus the active provider's display name. We
    // pass the display name through to the OrderDetailPage so the call panel can read
    // "Africa's Talking will ring your phone" instead of hardcoding the brand name.
    const voipData = voipRes.data as {
      result?: { data?: { enabled: boolean; providerDisplayName?: string } };
    };
    const voipPayload = voipData?.result?.data;
    const voipEnabled = voipPayload?.enabled ?? false;
    const voipProviderDisplayName = voipPayload?.providerDisplayName ?? "Africa's Talking";

    // latestCall is still loaded here (small + used for confirm gate UX). Timeline is loaded
    // client-side after mount (resource route) to keep the main page fast.
    const latestCallValue = await apiRequest<unknown>(
      `/trpc/orders.latestCall?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      deferredOpt,
    )
      .then((callRes) => {
        if (!callRes.ok) {
          logOrderDetailLoaderWarning(orderId, 'orders.latestCall', `status ${callRes.status}`);
          return null;
        }
        const callData = callRes.data as { result?: { data?: CallLogEntry | null } };
        return callData?.result?.data ?? null;
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'unknown';
        logOrderDetailLoaderWarning(orderId, 'orders.latestCall', msg);
        return null;
      });

    return {
      order,
      // Keep the prop shape stable (OrderDetailPage expects promises), but they're already resolved.
      latestCall: Promise.resolve(latestCallValue),
      timeline: undefined,
      voipEnabled,
      voipProviderDisplayName,
    };
  })();

  // Fan out the four supporting fetches in parallel — none of them depend on each
  // other, so collapsing the previous serial chain saves ~3 round-trips of latency
  // per order detail navigation. Each call still has its own .catch so a single
  // upstream blip doesn't fail the whole loader.
  type ApiResult = { ok: boolean; status: number; data: unknown };
  const onError = (label: string) => (err: unknown): ApiResult => {
    const msg = err instanceof Error ? err.message : 'unknown';
    logOrderDetailLoaderWarning(orderId, label, msg);
    return { ok: false, status: 503, data: {} };
  };
  const allocatableLocationsDeferred: Promise<
    Array<{
      id: string;
      name: string;
      address: string | null;
      whatsappGroupLink?: string | null;
      providerName: string | null;
      eligible: boolean;
      reason: string | null;
      availabilityByProduct: Array<{
        productId: string;
        productName: string;
        needed: number;
        available: number;
      }> | null;
    }>
  > = apiRequest<unknown>(
    `/trpc/orders.listAllocatableLocations?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
    deferredOpt,
  )
    .then((allocatableRes) => {
      if (!allocatableRes.ok) {
        logOrderDetailLoaderWarning(orderId, 'orders.listAllocatableLocations', `status ${allocatableRes.status}`);
        return [];
      }
      const data = allocatableRes.data as {
        result?: {
          data?: Array<{
            id: string;
            name: string;
            address: string | null;
            whatsappGroupLink?: string | null;
            providerName?: string | null;
            eligible: boolean;
            reason: string | null;
            availabilityByProduct: Array<{
              productId: string;
              productName: string;
              needed: number;
              available: number;
            }> | null;
          }>;
        };
      };
      return (data?.result?.data ?? []).map((loc) => ({
        ...loc,
        providerName: loc.providerName ?? null,
      }));
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : 'unknown';
      logOrderDetailLoaderWarning(orderId, 'orders.listAllocatableLocations', msg);
      return [];
    });

  const [agentsRes, locationsRes, templatesRes] = await Promise.all([
    apiRequest<unknown>('/trpc/orders.listCSClosers', deferredOpt).catch(
      onError('orders.listCSClosers'),
    ),
    apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100 }))}`,
      deferredOpt,
    ).catch(onError('logistics.listLocations')),
    apiRequest<unknown>(
      `/trpc/messaging.templates.list?input=${encodeURIComponent(JSON.stringify({ channel: 'WHATSAPP_GROUP' }))}`,
      deferredOpt,
    ).catch(onError('messaging.templates.list')),
  ]);

  let csClosersForAssign: Array<{ id: string; name: string }> | undefined;
  // `orders.listCSClosers` returns the full roster for HoCS/Admin (`orders.reassign`) and supervised
  // CS closers only for branch CS team supervisors; others get an empty list.
  if (agentsRes.ok) {
    const agentsData = agentsRes.data as { result?: { data?: Array<{ agentId: string; agentName: string }> } };
    const list = agentsData?.result?.data ?? [];
    csClosersForAssign = list.map((a) => ({ id: a.agentId, name: a.agentName }));
  } else {
    logOrderDetailLoaderWarning(orderId, 'orders.listCSClosers', `status ${agentsRes.status}`);
  }

  // Logistics locations — used by the "Allocate to logistics company" action available to the assigned
  // CS closer, Logistics, and admins when the order is CONFIRMED.
  let logisticsLocations: Array<{ id: string; name: string; address: string | null; whatsappGroupLink?: string | null; providerName?: string | null }> = [];
  if (locationsRes.ok) {
    const locationsData = locationsRes.data as {
      result?: { data?: { locations?: Array<{ id: string; name: string; address: string | null; whatsappGroupLink?: string | null; providerName?: string | null }> } };
    };
    logisticsLocations = (locationsData?.result?.data?.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      whatsappGroupLink: l.whatsappGroupLink ?? null,
      providerName: l.providerName ?? null,
    }));
  } else {
    logOrderDetailLoaderWarning(orderId, 'logistics.listLocations', `status ${locationsRes.status}`);
  }

  // allocatableLocations is heavy (per-location eligibility). Stream it so the page loads fast.
  const allocatableLocations: Array<{
    id: string;
    name: string;
    address: string | null;
    whatsappGroupLink?: string | null;
    providerName: string | null;
    eligible: boolean;
    reason: string | null;
    availabilityByProduct: Array<{
      productId: string;
      productName: string;
      needed: number;
      available: number;
    }> | null;
  }> = [];

  // Dispatch templates for the "Share to logistics company" WhatsApp flow.
  let logisticsDispatchTemplates: Array<{ id: string; name: string; body: string }> = [];
  if (templatesRes.ok) {
    const templatesData = templatesRes.data as { result?: { data?: Array<{ id: string; name: string; body: string }> } };
    logisticsDispatchTemplates = templatesData?.result?.data ?? [];
  } else {
    logOrderDetailLoaderWarning(orderId, 'messaging.templates.list', `status ${templatesRes.status}`);
  }

  // Invoice is loaded client-side after mount (resource route) to keep the main page fast.

  return defer({
    pageData: orderDetailPromise.then((orderDetail) => ({
      orderDetail,
      canEditOrder: user.role !== 'MEDIA_BUYER',
      userRole: user.role,
      userId: user.id,
      currentBranchId: user.currentBranchId ?? null,
      permissions: user.permissions ?? [],
      csClosersForAssign: csClosersForAssign,
      logisticsLocations,
      allocatableLocations,
      allocatableLocationsDeferred,
      logisticsDispatchTemplates,
      invoice: undefined,
    })),
  });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const orderId = params['id'];

  if (!orderId) {
    return json({ error: 'Order ID required' }, { status: 400 });
  }

  const user = await getCurrentUser(request);
  if (!user) {
    return json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (intent === 'assignToCS') {
    const toCsAgentId = formData.get('toCsAgentId')?.toString();
    if (!toCsAgentId) {
      return json({ error: 'Agent required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.assignToCS', {
      method: 'POST',
      cookie,
      body: { orderId, csCloserId: toCsAgentId, ...branchIdFromForm(formData) },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Assign failed');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'ensureInvoice') {
    const res = await apiRequest<unknown>('/trpc/finance.ensureInvoiceByOrder', {
      method: 'POST',
      cookie,
      body: { orderId },
      timeoutMs: 20_000,
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Could not generate invoice');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'initiateCall') {
    const res = await apiRequest<unknown>('/trpc/orders.initiateCall', {
      method: 'POST',
      cookie,
      body: { orderId },
      timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to initiate call') }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { callLog: unknown; providerError?: string } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      callInitiated: true,
      callLog: payload?.callLog ?? null,
      providerError: payload?.providerError,
    });
  }

  if (intent === 'revealPhone') {
    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId, ...branchIdFromForm(formData) },
      timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reveal phone') }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
      phoneRevealed: true,
    });
  }

  if (intent === 'revealPhoneForWhatsApp') {
    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId, ...branchIdFromForm(formData) },
      timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to prepare WhatsApp message') }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
      phoneRevealed: true,
    });
  }

  if (intent === 'revealPhoneForSms') {
    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId, ...branchIdFromForm(formData) },
      timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to prepare SMS recipient') }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      success: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
      phoneRevealed: true,
    });
  }

  if (intent === 'preparePhoneForWhatsApp') {
    const orderRes = await apiRequest<{ result?: { data?: { status?: string } } }>(
      `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      { method: 'GET', cookie },
    );
    const currentStatus = orderRes.data?.result?.data?.status;
    if (currentStatus !== 'CS_ENGAGED') {
      return json({ ready: false });
    }

    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId, ...branchIdFromForm(formData) },
      timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ ready: false, error: extractApiErrorMessage(res.data, 'Failed to prepare WhatsApp recipient') }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      ready: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
    });
  }

  if (intent === 'preparePhoneForSms') {
    const orderRes = await apiRequest<{ result?: { data?: { status?: string } } }>(
      `/trpc/orders.getById?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      { method: 'GET', cookie },
    );
    const currentStatus = orderRes.data?.result?.data?.status;
    if (currentStatus !== 'CS_ENGAGED') {
      return json({ ready: false });
    }

    const res = await apiRequest<unknown>('/trpc/orders.revealPhoneForManualCall', {
      method: 'POST',
      cookie,
      body: { orderId, ...branchIdFromForm(formData) },
      timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ ready: false, error: extractApiErrorMessage(res.data, 'Failed to prepare SMS recipient') }, { status: safeStatus(res.status) });
    }

    const data = res.data as { result?: { data?: { phone: string; isDialable: boolean } } };
    const payload = data?.result?.data;
    return json({
      ready: true,
      phone: payload?.phone ?? '',
      isDialable: payload?.isDialable ?? false,
    });
  }

  if (intent === 'adjustOrderItems') {
    const allowedRoles = [
      'CS_CLOSER',
      'HEAD_OF_CS',
      'HEAD_OF_LOGISTICS',
      'BRANCH_ADMIN',
      'SUPER_ADMIN',
      'ADMIN',
    ];
    if (!allowedRoles.includes(user.role)) {
      return json({ error: 'You are not allowed to adjust order items on this page' }, { status: 403 });
    }
    const itemsRaw = formData.get('items')?.toString();
    const totalAmountStr = formData.get('totalAmount')?.toString();
    if (!itemsRaw) {
      return json({ error: 'Items are required' }, { status: 400 });
    }
    let parsedItems: Array<{ productId: string; quantity: number; unitPrice: number }>;
    try {
      const arr = JSON.parse(itemsRaw) as unknown;
      if (!Array.isArray(arr) || arr.length === 0) {
        return json({ error: 'At least one item is required' }, { status: 400 });
      }
      parsedItems = arr.map((row: unknown) => {
        if (row == null || typeof row !== 'object') throw new Error('Invalid item');
        const o = row as Record<string, unknown>;
        const productId = typeof o.productId === 'string' ? o.productId : '';
        const quantity = typeof o.quantity === 'number' ? o.quantity : Number(o.quantity);
        const unitPrice = typeof o.unitPrice === 'number' ? o.unitPrice : Number(o.unitPrice);
        if (!productId || Number.isNaN(quantity) || quantity < 1 || Number.isNaN(unitPrice) || unitPrice < 0) {
          throw new Error('Invalid item fields');
        }
        return { productId, quantity, unitPrice };
      });
    } catch {
      return json({ error: 'Invalid items format' }, { status: 400 });
    }
    const totalAmount = totalAmountStr != null && totalAmountStr !== ''
      ? parseFloat(totalAmountStr)
      : parsedItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    if (Number.isNaN(totalAmount) || totalAmount < 0) {
      return json({ error: 'Invalid total amount' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.update', {
      method: 'POST',
      cookie,
      body: { orderId, items: parsedItems, totalAmount, ...branchIdFromForm(formData) },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to update order items');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'requestOrderLinePriceChange') {
    const allowedRoles = [
      'CS_CLOSER',
      'HEAD_OF_CS',
      'HEAD_OF_LOGISTICS',
      'BRANCH_ADMIN',
      'SUPER_ADMIN',
      'ADMIN',
    ];
    if (!allowedRoles.includes(user.role)) {
      return json({ error: 'You are not allowed to request line price changes on this page' }, { status: 403 });
    }
    const itemsRaw = formData.get('items')?.toString();
    const totalAmountStr = formData.get('totalAmount')?.toString();
    const reason = formData.get('reason')?.toString()?.trim() ?? '';
    const branchIdField = formData.get('branchId')?.toString()?.trim();
    if (!itemsRaw) {
      return json({ error: 'Items are required' }, { status: 400 });
    }
    if (reason.length < 10) {
      return json({ error: 'Reason must be at least 10 characters' }, { status: 400 });
    }
    let parsedItems: Array<{ productId: string; quantity: number; unitPrice: number }>;
    try {
      const arr = JSON.parse(itemsRaw) as unknown;
      if (!Array.isArray(arr) || arr.length === 0) {
        return json({ error: 'At least one item is required' }, { status: 400 });
      }
      parsedItems = arr.map((row: unknown) => {
        if (row == null || typeof row !== 'object') throw new Error('Invalid item');
        const o = row as Record<string, unknown>;
        const productId = typeof o.productId === 'string' ? o.productId : '';
        const quantity = typeof o.quantity === 'number' ? o.quantity : Number(o.quantity);
        const unitPrice = typeof o.unitPrice === 'number' ? o.unitPrice : Number(o.unitPrice);
        if (!productId || Number.isNaN(quantity) || quantity < 1 || Number.isNaN(unitPrice) || unitPrice < 0) {
          throw new Error('Invalid item fields');
        }
        return { productId, quantity, unitPrice: Math.round(unitPrice * 100) / 100 };
      });
    } catch {
      return json({ error: 'Invalid items format' }, { status: 400 });
    }
    const totalAmount = totalAmountStr != null && totalAmountStr !== ''
      ? Math.round(parseFloat(totalAmountStr) * 100) / 100
      : Math.round(parsedItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100;
    if (Number.isNaN(totalAmount) || totalAmount < 0) {
      return json({ error: 'Invalid total amount' }, { status: 400 });
    }
    const body: {
      orderId: string;
      items: typeof parsedItems;
      totalAmount: number;
      reason: string;
      branchId?: string;
    } = { orderId, items: parsedItems, totalAmount, reason };
    if (branchIdField) {
      body.branchId = branchIdField;
    }
    const res = await apiRequest<unknown>('/trpc/orders.requestLinePriceChangeApproval', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to submit price change request');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'requestOrderDeletion') {
    const allowedRoles = [
      'CS_CLOSER',
      'HEAD_OF_CS',
      'HEAD_OF_LOGISTICS',
      'BRANCH_ADMIN',
      'SUPER_ADMIN',
      'ADMIN',
    ];
    if (!allowedRoles.includes(user.role)) {
      return json({ error: 'You are not allowed to request order archive on this page' }, { status: 403 });
    }
    const reason = formData.get('reason')?.toString()?.trim() ?? '';
    const branchIdField = formData.get('branchId')?.toString()?.trim();
    if (reason.length < 10) {
      return json({ error: 'Reason must be at least 10 characters' }, { status: 400 });
    }
    const body: { orderId: string; reason: string; branchId?: string } = { orderId, reason };
    if (branchIdField) {
      body.branchId = branchIdField;
    }
    const res = await apiRequest<unknown>('/trpc/orders.requestOrderDeletionApproval', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to submit archive request');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'softDeleteOrder') {
    const allowedRoles = [
      'CS_CLOSER',
      'HEAD_OF_CS',
      'HEAD_OF_LOGISTICS',
      'BRANCH_ADMIN',
      'SUPER_ADMIN',
      'ADMIN',
    ];
    if (!allowedRoles.includes(user.role)) {
      return json({ error: 'You are not allowed to archive orders on this page' }, { status: 403 });
    }
    const reason = formData.get('reason')?.toString()?.trim() ?? '';
    const branchIdField = formData.get('branchId')?.toString()?.trim();
    if (reason.length < 10) {
      return json({ error: 'Reason must be at least 10 characters' }, { status: 400 });
    }
    const body: { orderId: string; reason: string; branchId?: string } = { orderId, reason };
    if (branchIdField) {
      body.branchId = branchIdField;
    }
    const res = await apiRequest<unknown>('/trpc/orders.softDeleteOrder', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to archive order');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'scheduleCallback') {
    const delayMinutesStr = formData.get('delayMinutes')?.toString();
    const delayMinutes = delayMinutesStr ? parseInt(delayMinutesStr, 10) : 120;
    const notes = formData.get('notes')?.toString() || undefined;
    if (Number.isNaN(delayMinutes) || delayMinutes < 5 || delayMinutes > 10080) {
      return json({ error: 'Invalid delay (5 min to 7 days)' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.scheduleCallback', {
      method: 'POST',
      cookie,
      body: { orderId, delayMinutes, notes, ...branchIdFromForm(formData) },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Schedule failed');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true, scheduled: true });
  }

  if (intent === 'transition') {
    const newStatus = (formData.get('newStatus')?.toString() ?? '').trim();
    if (!newStatus) {
      return json({ error: 'Status is required' }, { status: 400 });
    }
    const csOnlyStatuses = ['CS_ENGAGED', 'CONFIRMED', 'CANCELLED'];
    if (csOnlyStatuses.includes(newStatus)) {
      const allowedRoles = ['CS_CLOSER', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'];
      if (!allowedRoles.includes(user.role)) {
        return json({ error: 'Only CS or Head of CS can perform this action' }, { status: 403 });
      }
    }
    const reason = formData.get('reason')?.toString() || undefined;
    const logisticsLocationId = formData.get('logisticsLocationId')?.toString() || undefined;
    const logisticsProviderId = formData.get('logisticsProviderId')?.toString() || undefined;
    const riderId = formData.get('riderId')?.toString() || undefined;
    const deliveredQtyStr = formData.get('deliveredQuantity')?.toString();
    const returnedQtyStr = formData.get('returnedQuantity')?.toString();
    const deliveryFeeAddOnStr = formData.get('deliveryFeeAddOn')?.toString();
    const deliveryDiscountAmountStr = formData.get('deliveryDiscountAmount')?.toString();

    const preferredDeliveryDate = formData.get('preferredDeliveryDate')?.toString().trim() || undefined;
    const deliveryNote = formData.get('deliveryNote')?.toString() || undefined;
    const deliveryProofUrl = formData.get('deliveryProofUrl')?.toString() || undefined;

    const metadata: Record<string, unknown> = {};
    if (reason) metadata['reason'] = reason;
    if (logisticsLocationId) metadata['logisticsLocationId'] = logisticsLocationId;
    if (logisticsProviderId) metadata['logisticsProviderId'] = logisticsProviderId;
    if (riderId) metadata['riderId'] = riderId;
    if (newStatus === 'CONFIRMED') {
      if (!preferredDeliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(preferredDeliveryDate)) {
        return json({ error: 'Scheduled delivery date is required.' }, { status: 400 });
      }
      metadata['preferredDeliveryDate'] = preferredDeliveryDate;
    } else if (preferredDeliveryDate) {
      metadata['preferredDeliveryDate'] = preferredDeliveryDate;
    }
    if (deliveryNote) metadata['deliveryNote'] = deliveryNote;
    if (deliveryProofUrl) metadata['deliveryProofUrl'] = deliveryProofUrl;
    const deliveredQty = deliveredQtyStr != null ? parseInt(deliveredQtyStr, 10) : NaN;
    if (!Number.isNaN(deliveredQty) && Number.isInteger(deliveredQty) && deliveredQty >= 0) {
      metadata['deliveredQuantity'] = deliveredQty;
    }
    const returnedQty = returnedQtyStr != null ? parseInt(returnedQtyStr, 10) : NaN;
    if (!Number.isNaN(returnedQty) && Number.isInteger(returnedQty) && returnedQty >= 0) {
      metadata['returnedQuantity'] = returnedQty;
    }
    if (deliveryFeeAddOnStr) {
      const addOn = parseFloat(deliveryFeeAddOnStr);
      if (!Number.isNaN(addOn) && addOn >= 0) metadata['deliveryFeeAddOn'] = addOn;
    }
    if (deliveryDiscountAmountStr !== undefined && deliveryDiscountAmountStr !== '') {
      const discount = parseFloat(deliveryDiscountAmountStr);
      if (!Number.isNaN(discount) && discount >= 0) metadata['deliveryDiscountAmount'] = discount;
    }

    // Status transitions do real work: validate gates, run the inventory
    // geofence + reservation, write the timeline event + status, generate
    // an invoice on first CONFIRM, fan out notifications, emit a socket
    // event. On a remote Aiven DB these add up well past the default 4.5s.
    // Bump the timeout — the user is actively waiting on this single click,
    // and timing out leaves the order in a half-confirmed state from the UI's
    // perspective even when the server transaction succeeds.
    const res = await apiRequest<unknown>('/trpc/orders.transition', {
      method: 'POST',
      cookie,
      body: {
        orderId,
        newStatus,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        ...branchIdFromForm(formData),
      },
      timeoutMs: 20_000,
    });

    if (!res.ok) {
      const message = extractApiErrorMessage(res.data, 'Transition failed');
      return json({ error: message }, { status: safeStatus(res.status) });
    }

    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

const ORDER_DETAIL_EVENTS = ['order:status_changed', 'order:assigned', 'order:transfer_accepted', 'order:transfer_rejected'] as const;

export default function OrderDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  const orderEvents = useMemo(() => [...ORDER_DETAIL_EVENTS], []);
  usePageRefreshOnEvent(orderEvents);
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<OrderDetailSkeleton />}
      loaderShell={{}}
      deferredKey="pageData"
    >
        {({
          orderDetail,
          canEditOrder,
          userRole,
          userId,
          currentBranchId,
          permissions,
          csClosersForAssign,
          logisticsLocations,
          allocatableLocations,
          allocatableLocationsDeferred,
          logisticsDispatchTemplates,
          invoice,
        }) =>
          'loadError' in orderDetail && typeof orderDetail.loadError === 'string' ? (
            <div className="card text-center py-12">
              <p className="text-6xl font-bold text-warning-500/80 mb-4">!</p>
              <h2 className="text-xl font-bold text-app-fg">Could not load this order</h2>
              <p className="mt-2 text-sm text-app-fg-muted max-w-lg mx-auto">{orderDetail.loadError}</p>
              <p className="mt-3 text-xs text-app-fg-muted max-w-md mx-auto">
                A server or database error can look like a missing order. If you just deployed, run pending
                migrations on the API database, then redeploy the API.
              </p>
              <a href="/admin/cs/orders" className="btn-primary mt-6 inline-block">
                Back to Orders
              </a>
            </div>
          ) : 'notFound' in orderDetail && orderDetail.notFound ? (
            <div className="card text-center py-12">
              <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
              <h2 className="text-xl font-bold text-app-fg">Order not found</h2>
              <p className="mt-2 text-sm text-app-fg-muted">
                The order you're looking for doesn't exist or has been removed.
              </p>
              <a href="/admin/cs/orders" className="btn-primary mt-4 inline-block">
                Back to Orders
              </a>
            </div>
          ) : (
            <OrderDetailPage
              order={(orderDetail as OrderDetailStreamData).order}
              latestCall={(orderDetail as OrderDetailStreamData).latestCall}
              timeline={(orderDetail as OrderDetailStreamData).timeline}
              voipEnabled={(orderDetail as OrderDetailStreamData).voipEnabled}
              voipProviderDisplayName={(orderDetail as OrderDetailStreamData).voipProviderDisplayName}
              canEditOrder={canEditOrder}
              userRole={userRole}
              userId={userId}
              currentBranchId={currentBranchId}
              permissions={permissions}
              csClosersForAssign={csClosersForAssign}
              logisticsLocations={logisticsLocations}
              allocatableLocations={allocatableLocations}
              allocatableLocationsDeferred={allocatableLocationsDeferred}
              logisticsDispatchTemplates={logisticsDispatchTemplates}
              invoice={invoice}
            />
          )
        }
      </CachedAwait>
  );
}
