import { useEffect, useMemo } from 'react';
import { useLoaderData, useLocation, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { json } from '@remix-run/node';
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
import { canonicalPermissionCode } from '~/lib/permission-codes';
import type {
  CallLogEntry,
  OrderDetail,
  OrderDetailLoaderResult,
  OrderDetailStreamData,
  OrderInvoice,
  OrderItemOffers,
  TimelineEvent,
} from '~/features/orders/types';
import { trpcOrderGetByIdIsNotFound } from '~/lib/trpc-http-response';
import { cachedClientLoader, setFullLoaderEntry } from '~/lib/loader-cache';

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

const ORDER_DETAIL_ACTION_PERMISSION = canonicalPermissionCode('orders.detail.manage');

function canManageOrderDetail(user: { role: string; permissions?: string[] } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  return perms.has(ORDER_DETAIL_ACTION_PERMISSION);
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  let user;
  try {
    user = await requirePermission(request, ['orders.read', 'marketing.orders']);
  } catch (err) {
    console.error('[OrderDetail loader] requirePermission threw:', err instanceof Response ? `Response ${err.status}` : err);
    throw err;
  }
  const cookie = getSessionCookie(request);
  const orderId = params['id'];

  if (!orderId) {
    throw new Response('Order ID required', { status: 400 });
  }
  const deferredOpt = { method: 'GET' as const, cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS };
  const url = new URL(request.url);
  const fromCartOrders = url.searchParams.get('from') === 'cart-orders';

  /** Synthesize call log entries from timeline events for follow-up/cart orders. */
  const synthesizeCallLogs = (timeline: Array<Record<string, unknown>>): Array<{ id: string; callStatus: string; durationSeconds: number; startedAt: string }> =>
    timeline
      .filter((t) => {
        const et = (t.eventType as string) ?? '';
        const desc = ((t.description as string) ?? '').toLowerCase();
        return et === 'MANUAL_CALL_LOGGED' || et === 'CALL_COMPLETED' || desc.includes('call recorded') || desc.includes('manual call');
      })
      .map((t, i) => ({
        id: `synth-call-${i}`,
        callStatus: 'COMPLETED',
        durationSeconds: 60,
        startedAt: (t.createdAt as string) ?? new Date().toISOString(),
      }));

  // Shared helper: fetch products for the Adjust order items modal (product swap).
  // Used by follow-up and cart order paths which don't go through the main orders loader.
  const fetchProductsForAdjust = () =>
    apiRequest<unknown>(
      `/trpc/orders.listProductsForAdjust?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
      deferredOpt,
    )
      .then((res) => {
        if (!res.ok) return [] as Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
        const d = res.data as { result?: { data?: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }> } };
        return d?.result?.data ?? [];
      })
      .catch(() => [] as Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>);

  const orderDetailPromise = (async (): Promise<OrderDetailLoaderResult> => {
    // When navigating from Cart Orders page, try cart_orders table first
    // to avoid hitting the stale graduated copy in the orders table.
    if (fromCartOrders) {
      const coRes = await apiRequest<unknown>(
        `/trpc/cartOrders.getById?input=${encodeURIComponent(JSON.stringify({ id: orderId }))}`,
        deferredOpt,
      ).catch(() => ({ ok: false as const, status: 500, data: null }));
      if (coRes.ok) {
        const coData = (coRes.data as { result?: { data?: Record<string, unknown> } })?.result?.data;
        if (coData) {
          const coItems = (coData.orderItems as Array<Record<string, unknown>> | undefined) ?? [];
          const coTimeline = (coData.timeline as Array<Record<string, unknown>> | undefined) ?? [];
          const order: OrderDetail = {
            id: coData.id as string,
            orderNumber: coData.orderNumber != null ? Number(coData.orderNumber) : null,
            customerName: coData.customerName as string,
            customerPhoneDisplay: (coData.customerPhone as string) ? `••••${(coData.customerPhone as string).slice(-4)}` : '••••••••',
            customerAddress: (coData.customerAddress as string) ?? null,
            deliveryAddress: (coData.deliveryAddress as string) ?? null,
            deliveryNotes: (coData.deliveryNotes as string) ?? null,
            status: coData.status as string,
            totalAmount: (coData.totalAmount as string) ?? null,
            landedCost: (coData.landedCost as string) ?? null,
            deliveryFee: (coData.deliveryFee as string) ?? null,
            createdAt: coData.createdAt as string,
            confirmedAt: (coData.confirmedAt as string) ?? null,
            allocatedAt: (coData.allocatedAt as string) ?? null,
            dispatchedAt: (coData.dispatchedAt as string) ?? null,
            deliveredAt: (coData.deliveredAt as string) ?? null,
            assignedCsId: (coData.assignedCsId as string) ?? null,
            assignedCsName: (coData.assignedCsName as string) ?? null,
            mediaBuyerId: (coData.mediaBuyerId as string) ?? null,
            mediaBuyerName: (coData.mediaBuyerName as string) ?? null,
            campaignId: (coData.campaignId as string) ?? null,
            campaignName: (coData.campaignName as string) ?? null,
            branchId: (coData.servicingBranchId as string) ?? (coData.branchId as string) ?? null,
            paymentMethod: (coData.paymentMethod as string) ?? null,
            paymentStatus: (coData.paymentStatus as string) ?? null,
            customerEmail: (coData.customerEmail as string) ?? null,
            customerGender: (coData.customerGender as string) ?? null,
            deliveryState: (coData.deliveryState as string) ?? null,
            preferredDeliveryDate: (coData.preferredDeliveryDate as string) ?? null,
            frozenForFollowUp: false,
            pendingOrderLinePriceRequestId: (coData.pendingOrderLinePriceRequestId as string) ?? null,
            pendingLinePriceChangeProposal: (coData.pendingLinePriceChangeProposal as OrderDetail['pendingLinePriceChangeProposal']) ?? null,
            viewerCanEditOrderLinePrices: (coData.viewerCanEditOrderLinePrices as boolean) ?? false,
            logisticsLocationId: (coData.logisticsLocationId as string) ?? null,
            logisticsProviderId: (coData.logisticsProviderId as string) ?? null,
            riderId: (coData.riderId as string) ?? null,
            orderItems: coItems.map((it) => ({
              id: it.id as string,
              productId: it.productId as string,
              productName: (it.productName as string) ?? null,
              quantity: it.quantity as number,
              unitPrice: it.unitPrice as string,
              offerLabel: (it.offerLabel as string) ?? null,
            })),
            callLogs: synthesizeCallLogs(coTimeline),
            allowedTransitions: (() => {
              const s = coData.status as string;
              const elevated = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'SUPPORT' || user?.role === 'HEAD_OF_CS';
              if (s === 'UNPROCESSED') return elevated ? ['CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'DELETED'] : ['CS_ASSIGNED', 'CS_ENGAGED', 'DELETED'];
              if (s === 'CS_ASSIGNED') return elevated ? ['CS_ENGAGED', 'CONFIRMED', 'DELETED'] : ['CS_ENGAGED', 'DELETED'];
              if (s === 'CS_ENGAGED') return ['CONFIRMED', 'DELETED'];
              if (s === 'CONFIRMED') return ['AGENT_ASSIGNED', 'DISPATCHED', 'DELIVERED', 'DELETED'];
              if (s === 'AGENT_ASSIGNED') return ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'DELETED'];
              if (s === 'DISPATCHED') return ['IN_TRANSIT', 'DELIVERED', 'DELETED'];
              if (s === 'IN_TRANSIT') return ['DELIVERED', 'DELETED'];
              if (s === 'DELIVERED') return ['REMITTED'];
              if (s === 'DELETED') return ['UNPROCESSED'];
              return ['DELETED'];
            })(),
          };
          const coPhone = (coData.customerPhone as string) ?? null;
          const timelineData = coTimeline.map((t) => ({
            id: t.id as string,
            orderId: coData.id as string,
            eventType: t.eventType as string,
            actorId: (t.actorId as string) ?? null,
            actorName: (t.actorName as string) ?? null,
            description: t.description as string,
            metadata: (t.metadata as Record<string, unknown>) ?? null,
            createdAt: t.createdAt as string,
          }));
          const cartProductsForAdjust = await fetchProductsForAdjust();
          return {
            order,
            voipEnabled: false,
            voipProviderDisplayName: '',
            latestCall: null as unknown as Promise<null>,
            timeline: timelineData as unknown as Promise<typeof timelineData>,
            itemOffers: [],
            productsForAdjust: cartProductsForAdjust,
            callablePhone: coPhone ? { phone: coPhone, isDialable: true } : null,
            isFollowUpOrder: false,
            isCartOrder: true,
          };
        }
      }
    }

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
        // Fallback: check follow_up_orders table — the ID may be a follow-up order
        const fuRes = await apiRequest<unknown>(
          `/trpc/orders.followUpOrdersDetail?input=${encodeURIComponent(JSON.stringify({ id: orderId }))}`,
          deferredOpt,
        ).catch(() => ({ ok: false as const, status: 500, data: null }));
        if (fuRes.ok) {
          const fuData = (fuRes.data as { result?: { data?: Record<string, unknown> } })?.result?.data;
          if (fuData) {
            // Map follow-up order to OrderDetail shape for the detail page
            const fuItems = (fuData.items as Array<Record<string, unknown>> | undefined) ?? [];
            const fuTimeline = (fuData.timeline as Array<Record<string, unknown>> | undefined) ?? [];
            const order: OrderDetail = {
              id: fuData.id as string,
              orderNumber: fuData.orderNumber != null ? Number(fuData.orderNumber) : null,
              customerName: fuData.customerName as string,
              customerPhoneDisplay: (fuData.customerPhone as string) ? `••••${(fuData.customerPhone as string).slice(-4)}` : '••••••••',
              customerAddress: (fuData.customerAddress as string) ?? null,
              deliveryAddress: (fuData.deliveryAddress as string) ?? null,
              deliveryNotes: (fuData.deliveryNotes as string) ?? null,
              status: fuData.status as string,
              totalAmount: (fuData.totalAmount as string) ?? null,
              landedCost: (fuData.landedCost as string) ?? null,
              deliveryFee: (fuData.deliveryFee as string) ?? null,
              createdAt: fuData.createdAt as string,
              confirmedAt: (fuData.confirmedAt as string) ?? null,
              allocatedAt: (fuData.allocatedAt as string) ?? null,
              dispatchedAt: (fuData.dispatchedAt as string) ?? null,
              deliveredAt: (fuData.deliveredAt as string) ?? null,
              assignedCsId: (fuData.assignedCsId as string) ?? null,
              assignedCsName: (fuData.assignedCsName as string) ?? null,
              mediaBuyerId: (fuData.mediaBuyerId as string) ?? null,
              mediaBuyerName: (fuData.mediaBuyerName as string) ?? null,
              campaignId: (fuData.campaignId as string) ?? null,
              campaignName: null,
              branchId: (fuData.servicingBranchId as string) ?? (fuData.branchId as string) ?? null,
              paymentMethod: (fuData.paymentMethod as string) ?? null,
              paymentStatus: (fuData.paymentStatus as string) ?? null,
              customerEmail: (fuData.customerEmail as string) ?? null,
              customerGender: (fuData.customerGender as string) ?? null,
              deliveryState: (fuData.deliveryState as string) ?? null,
              preferredDeliveryDate: (fuData.preferredDeliveryDate as string) ?? null,
              // orderSource not in OrderDetail type
              frozenForFollowUp: false,
              pendingOrderLinePriceRequestId: (fuData.pendingOrderLinePriceRequestId as string) ?? null,
              pendingLinePriceChangeProposal: (fuData.pendingLinePriceChangeProposal as OrderDetail['pendingLinePriceChangeProposal']) ?? null,
              viewerCanEditOrderLinePrices: (fuData.viewerCanEditOrderLinePrices as boolean) ?? false,
              logisticsLocationId: (fuData.logisticsLocationId as string) ?? null,
              logisticsProviderId: (fuData.logisticsProviderId as string) ?? null,
              riderId: (fuData.riderId as string) ?? null,
              orderItems: fuItems.map((it) => ({
                id: it.id as string,
                productId: it.productId as string,
                productName: (it.productName as string) ?? null,
                quantity: it.quantity as number,
                unitPrice: it.unitPrice as string,
                offerLabel: (it.offerLabel as string) ?? null,
              })),
              callLogs: synthesizeCallLogs(fuTimeline),
              // Follow-up lifecycle: UNPROCESSED → CS_ASSIGNED → CS_ENGAGED → CONFIRMED → AGENT_ASSIGNED → DELIVERED
              // No skipping — must go through engagement before confirming.
              // Post-CONFIRMED transitions (assign agent, dispatch, deliver) are open to all CS.
              allowedTransitions: (() => {
                const s = fuData.status as string;
                const elevated = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'SUPPORT' || user?.role === 'HEAD_OF_CS';
                if (s === 'UNPROCESSED') return elevated ? ['CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'DELETED'] : ['CS_ASSIGNED', 'CS_ENGAGED', 'DELETED'];
                if (s === 'CS_ASSIGNED') return elevated ? ['CS_ENGAGED', 'CONFIRMED', 'DELETED'] : ['CS_ENGAGED', 'DELETED'];
                if (s === 'CS_ENGAGED') return ['CONFIRMED', 'DELETED'];
                if (s === 'CONFIRMED') return ['AGENT_ASSIGNED', 'DISPATCHED', 'DELIVERED', 'DELETED'];
                if (s === 'AGENT_ASSIGNED') return ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'DELETED'];
                if (s === 'DISPATCHED') return ['IN_TRANSIT', 'DELIVERED', 'DELETED'];
                if (s === 'IN_TRANSIT') return ['DELIVERED', 'DELETED'];
                if (s === 'DELIVERED') return ['REMITTED'];
                return ['DELETED'];
              })(),
            };
            const fuPhone = (fuData.customerPhone as string) ?? null;
            return {
              order,
              voipEnabled: false,
              voipProviderDisplayName: '',
              latestCall: null as unknown as Promise<null>,
              timeline: fuTimeline.map((t) => ({
                id: t.id as string,
                orderId: fuData.id as string,
                eventType: t.eventType as string,
                actorId: (t.actorId as string) ?? null,
                actorName: (t.actorName as string) ?? null,
                description: t.description as string,
                metadata: (t.metadata as Record<string, unknown>) ?? null,
                createdAt: t.createdAt as string,
              })) as unknown as Promise<typeof fuTimeline>,
              itemOffers: [],
              productsForAdjust: await fetchProductsForAdjust(),
              callablePhone: fuPhone ? { phone: fuPhone, isDialable: true } : null,
              isFollowUpOrder: true,
            };
          }
        }
        // Fallback 2: check cart_orders table — the ID may be a cart order
        const coRes = await apiRequest<unknown>(
          `/trpc/cartOrders.getById?input=${encodeURIComponent(JSON.stringify({ id: orderId }))}`,
          deferredOpt,
        ).catch(() => ({ ok: false as const, status: 500, data: null }));
        if (coRes.ok) {
          const coData = (coRes.data as { result?: { data?: Record<string, unknown> } })?.result?.data;
          if (coData) {
            const coItems = (coData.orderItems as Array<Record<string, unknown>> | undefined) ?? [];
            const coTimeline = (coData.timeline as Array<Record<string, unknown>> | undefined) ?? [];
            const order: OrderDetail = {
              id: coData.id as string,
              orderNumber: coData.orderNumber != null ? Number(coData.orderNumber) : null,
              customerName: coData.customerName as string,
              customerPhoneDisplay: (coData.customerPhone as string) ? `••••${(coData.customerPhone as string).slice(-4)}` : '••••••••',
              customerAddress: (coData.customerAddress as string) ?? null,
              deliveryAddress: (coData.deliveryAddress as string) ?? null,
              deliveryNotes: (coData.deliveryNotes as string) ?? null,
              status: coData.status as string,
              totalAmount: (coData.totalAmount as string) ?? null,
              landedCost: (coData.landedCost as string) ?? null,
              deliveryFee: (coData.deliveryFee as string) ?? null,
              createdAt: coData.createdAt as string,
              confirmedAt: (coData.confirmedAt as string) ?? null,
              allocatedAt: (coData.allocatedAt as string) ?? null,
              dispatchedAt: (coData.dispatchedAt as string) ?? null,
              deliveredAt: (coData.deliveredAt as string) ?? null,
              assignedCsId: (coData.assignedCsId as string) ?? null,
              assignedCsName: (coData.assignedCsName as string) ?? null,
              mediaBuyerId: (coData.mediaBuyerId as string) ?? null,
              mediaBuyerName: (coData.mediaBuyerName as string) ?? null,
              campaignId: (coData.campaignId as string) ?? null,
              campaignName: (coData.campaignName as string) ?? null,
              branchId: (coData.servicingBranchId as string) ?? (coData.branchId as string) ?? null,
              paymentMethod: (coData.paymentMethod as string) ?? null,
              paymentStatus: (coData.paymentStatus as string) ?? null,
              customerEmail: (coData.customerEmail as string) ?? null,
              customerGender: (coData.customerGender as string) ?? null,
              deliveryState: (coData.deliveryState as string) ?? null,
              preferredDeliveryDate: (coData.preferredDeliveryDate as string) ?? null,
              frozenForFollowUp: false,
              pendingOrderLinePriceRequestId: (coData.pendingOrderLinePriceRequestId as string) ?? null,
              viewerCanEditOrderLinePrices: (coData.viewerCanEditOrderLinePrices as boolean) ?? false,
              logisticsLocationId: (coData.logisticsLocationId as string) ?? null,
              logisticsProviderId: (coData.logisticsProviderId as string) ?? null,
              riderId: (coData.riderId as string) ?? null,
              orderItems: coItems.map((it) => ({
                id: it.id as string,
                productId: it.productId as string,
                productName: (it.productName as string) ?? null,
                quantity: it.quantity as number,
                unitPrice: it.unitPrice as string,
                offerLabel: (it.offerLabel as string) ?? null,
              })),
              callLogs: synthesizeCallLogs(coTimeline),
              // Cart order lifecycle mirrors follow-up: post-CONFIRMED transitions open to all CS.
              allowedTransitions: (() => {
                const s = coData.status as string;
                const elevated = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'SUPPORT' || user?.role === 'HEAD_OF_CS';
                if (s === 'UNPROCESSED') return elevated ? ['CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'DELETED'] : ['CS_ASSIGNED', 'CS_ENGAGED', 'DELETED'];
                if (s === 'CS_ASSIGNED') return elevated ? ['CS_ENGAGED', 'CONFIRMED', 'DELETED'] : ['CS_ENGAGED', 'DELETED'];
                if (s === 'CS_ENGAGED') return ['CONFIRMED', 'DELETED'];
                if (s === 'CONFIRMED') return ['AGENT_ASSIGNED', 'DISPATCHED', 'DELIVERED', 'DELETED'];
                if (s === 'AGENT_ASSIGNED') return ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'DELETED'];
                if (s === 'DISPATCHED') return ['IN_TRANSIT', 'DELIVERED', 'DELETED'];
                if (s === 'IN_TRANSIT') return ['DELIVERED', 'DELETED'];
                if (s === 'DELIVERED') return ['REMITTED'];
                return ['DELETED'];
              })(),
            };
            const coPhone = (coData.customerPhone as string) ?? null;
            return {
              order,
              voipEnabled: false,
              voipProviderDisplayName: '',
              latestCall: null as unknown as Promise<null>,
              timeline: coTimeline.map((t) => ({
                id: t.id as string,
                orderId: coData.id as string,
                eventType: t.eventType as string,
                actorId: (t.actorId as string) ?? null,
                actorName: (t.actorName as string) ?? null,
                description: t.description as string,
                metadata: (t.metadata as Record<string, unknown>) ?? null,
                createdAt: t.createdAt as string,
              })) as unknown as Promise<typeof coTimeline>,
              itemOffers: [],
              productsForAdjust: await fetchProductsForAdjust(),
              callablePhone: coPhone ? { phone: coPhone, isDialable: true } : null,
              isFollowUpOrder: false,
              isCartOrder: true,
            };
          }
        }
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

    // latestCall is still loaded here (small + used for confirm gate UX). itemOffers powers the
    // Adjust order items offer picker — small + needed when the modal opens, fetched in parallel.
    // Timeline is loaded client-side after mount (resource route) to keep the main page fast.
    const [latestCallValue, itemOffersValue, callablePhoneValue, productsForAdjustValue] = await Promise.all([
      apiRequest<unknown>(
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
        }),
      apiRequest<unknown>(
        `/trpc/orders.listItemOffers?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
        deferredOpt,
      )
        .then((offersRes) => {
          if (!offersRes.ok) {
            logOrderDetailLoaderWarning(orderId, 'orders.listItemOffers', `status ${offersRes.status}`);
            return [] as OrderItemOffers[];
          }
          const offersData = offersRes.data as { result?: { data?: OrderItemOffers[] } };
          return offersData?.result?.data ?? [];
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : 'unknown';
          logOrderDetailLoaderWarning(orderId, 'orders.listItemOffers', msg);
          return [] as OrderItemOffers[];
        }),
      // Callable phone is loaded with the page so the Call Customer modal has the
      // number in memory on first render — no separate reveal fetch on modal open.
      !voipEnabled
        ? apiRequest<unknown>(
            `/trpc/orders.getCallablePhone?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
            deferredOpt,
          )
            .then((phoneRes) => {
              if (!phoneRes.ok) return null;
              const phoneData = phoneRes.data as {
                result?: { data?: { phone: string; isDialable: boolean } | null };
              };
              return phoneData?.result?.data ?? null;
            })
            .catch(() => null)
        : Promise.resolve(null),
      // Products for product-swap in Adjust order items modal
      apiRequest<unknown>(
        `/trpc/orders.listProductsForAdjust?input=${encodeURIComponent(JSON.stringify({ orderId }))}`,
        deferredOpt,
      )
        .then((res) => {
          if (!res.ok) {
            logOrderDetailLoaderWarning(orderId, 'orders.listProductsForAdjust', `status ${res.status}`);
            return [] as Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
          }
          const d = res.data as { result?: { data?: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }> } };
          return d?.result?.data ?? [];
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : 'unknown';
          logOrderDetailLoaderWarning(orderId, 'orders.listProductsForAdjust', msg);
          return [] as Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
        }),
    ]);

    return {
      order,
      // Keep the prop shape stable (OrderDetailPage expects promises), but they're already resolved.
      latestCall: Promise.resolve(latestCallValue),
      timeline: undefined,
      voipEnabled,
      voipProviderDisplayName,
      itemOffers: itemOffersValue,
      callablePhone: callablePhoneValue,
      productsForAdjust: productsForAdjustValue,
      isFollowUpOrder: false,
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
      providerKind?: string | null;
      eligible: boolean;
      reason: string | null;
      availabilityByProduct: Array<{
        productId: string;
        productName: string;
        needed: number;
        available: number;
      }> | null;
      stockBandByProduct: Array<{
        productId: string;
        productName: string;
        band: 'ABOVE_THRESHOLD' | 'BELOW_THRESHOLD';
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
            providerKind?: string | null;
            eligible: boolean;
            reason: string | null;
            availabilityByProduct: Array<{
              productId: string;
              productName: string;
              needed: number;
              available: number;
            }> | null;
            stockBandByProduct?: Array<{
              productId: string;
              productName: string;
              band: 'ABOVE_THRESHOLD' | 'BELOW_THRESHOLD';
            }> | null;
          }>;
        };
      };
      return (data?.result?.data ?? []).map((loc) => ({
        ...loc,
        providerName: loc.providerName ?? null,
        providerKind: loc.providerKind ?? null,
        stockBandByProduct: loc.stockBandByProduct ?? null,
      }));
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : 'unknown';
      logOrderDetailLoaderWarning(orderId, 'orders.listAllocatableLocations', msg);
      return [];
    });

  // Await order detail early so the page renders with data on navigation completion.
  const orderDetailResolved = await orderDetailPromise;

  // Follow-up orders get the same supporting data as normal orders — closers, locations, templates.
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
  // Sales closers only for branch Sales team supervisors; others get an empty list.
  // For follow-up orders: also fetch branch memberships so we can filter to the order's branch.
  const isFollowUpResult = 'order' in orderDetailResolved && (orderDetailResolved as { isFollowUpOrder?: boolean }).isFollowUpOrder;
  const fuOrderBranchId = isFollowUpResult && 'order' in orderDetailResolved
    ? (orderDetailResolved as { order: { branchId?: string | null } }).order.branchId
    : null;
  if (agentsRes.ok) {
    const agentsData = agentsRes.data as { result?: { data?: Array<{ agentId: string; agentName: string; branches?: Array<{ branchId: string }> }> } };
    let list = agentsData?.result?.data ?? [];
    // For follow-up orders scoped to a branch, filter closers to that branch
    if (isFollowUpResult && fuOrderBranchId) {
      // listCSClosers doesn't include branches — fetch with branches for filtering
      try {
        const withBranchesRes = await apiRequest<unknown>('/trpc/orders.listCSClosersWithBranches?input=%7B%7D', deferredOpt);
        if (withBranchesRes.ok) {
          const branchData = (withBranchesRes.data as { result?: { data?: Array<{ agentId: string; agentName: string; branches: Array<{ branchId: string }> }> } })?.result?.data ?? [];
          const branchClosers = branchData.filter((c) => c.branches.some((b) => b.branchId === fuOrderBranchId));
          csClosersForAssign = branchClosers.map((a) => ({ id: a.agentId, name: a.agentName }));
        } else {
          csClosersForAssign = list.map((a) => ({ id: a.agentId, name: a.agentName }));
        }
      } catch {
        csClosersForAssign = list.map((a) => ({ id: a.agentId, name: a.agentName }));
      }
    } else {
      csClosersForAssign = list.map((a) => ({ id: a.agentId, name: a.agentName }));
    }
  } else {
    logOrderDetailLoaderWarning(orderId, 'orders.listCSClosers', `status ${agentsRes.status}`);
  }

  // Logistics locations — used by the "Allocate to logistics company" action available to the assigned
  // Sales closer, Logistics, and admins when the order is CONFIRMED.
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
    providerKind: string | null;
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

  // Await all remaining promises so the page renders with data on navigation
  // completion — no skeleton flash after the progress bar finishes.
  // `allocatableLocationsDeferred` runs in parallel with `orderDetailPromise` +
  // the agents/locations/templates batch (already awaited above).
  const orderDetail = orderDetailResolved;
  const resolvedAllocatable = await allocatableLocationsDeferred;

  return {
    pageData: {
      orderDetail,
      canEditOrder: canManageOrderDetail(user),
      userRole: user.role,
      userId: user.id,
      currentBranchId: user.currentBranchId ?? null,
      permissions: user.permissions ?? [],
      isMirroring: !!user.mirroredBy,
      csClosersForAssign: csClosersForAssign,
      logisticsLocations,
      allocatableLocations: resolvedAllocatable,
      logisticsDispatchTemplates,
      invoice: undefined,
    },
  };
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

  if (intent && !canManageOrderDetail(user)) {
    return json(
      { error: 'This order is view-only for your permissions' },
      { status: 403 },
    );
  }

  if (intent === 'assignToCS') {
    const toCsAgentId = formData.get('toCsAgentId')?.toString();
    if (!toCsAgentId) {
      return json({ error: 'Agent required' }, { status: 400 });
    }
    const reason = formData.get('reason')?.toString().trim();
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    const isCartOrder = formData.get('isCartOrder') === 'true';

    if (isFollowUp) {
      // Follow-up orders live in a separate table — use the dedicated assignment endpoint.
      const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersAssign', {
        method: 'POST',
        cookie,
        body: { orderId, closerId: toCsAgentId },
      });
      if (!res.ok) {
        const err = extractApiErrorMessage(res.data, 'Assign failed');
        return json({ error: err }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
    }

    if (isCartOrder) {
      const res = await apiRequest<unknown>('/trpc/cartOrders.assignToCS', {
        method: 'POST',
        cookie,
        body: { orderId, closerId: toCsAgentId },
      });
      if (!res.ok) {
        const err = extractApiErrorMessage(res.data, 'Assign failed');
        return json({ error: err }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
    }

    const res = await apiRequest<unknown>('/trpc/orders.assignToCS', {
      method: 'POST',
      cookie,
      body: {
        orderId,
        csCloserId: toCsAgentId,
        ...(reason ? { reason } : {}),
        ...branchIdFromForm(formData),
      },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Assign failed');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'ensureInvoice') {
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    const isCartOrder = formData.get('isCartOrder') === 'true';
    if (isFollowUp) {
      // Follow-up orders: use the same approach as the auto-generate on CONFIRMED
      const res = await apiRequest<unknown>('/trpc/orders.followUpEnsureInvoice', {
        method: 'POST',
        cookie,
        body: { orderId },
        timeoutMs: 20_000,
      });
      if (!res.ok) {
        // Fallback to normal endpoint (might work after graduation)
        const fallbackRes = await apiRequest<unknown>('/trpc/finance.ensureInvoiceByOrder', {
          method: 'POST',
          cookie,
          body: { orderId },
          timeoutMs: 20_000,
        });
        if (!fallbackRes.ok) {
          return json({ error: extractApiErrorMessage(fallbackRes.data, 'Could not generate invoice') }, { status: safeStatus(fallbackRes.status) });
        }
      }
      return json({ success: true });
    }
    if (isCartOrder) {
      // Cart orders: use the dedicated cart-order invoice endpoint
      const res = await apiRequest<unknown>('/trpc/cartOrders.ensureInvoice', {
        method: 'POST',
        cookie,
        body: { orderId },
        timeoutMs: 20_000,
      });
      if (!res.ok) {
        // Fallback to generic endpoint
        const fallbackRes = await apiRequest<unknown>('/trpc/finance.ensureInvoiceByOrder', {
          method: 'POST',
          cookie,
          body: { orderId },
          timeoutMs: 20_000,
        });
        if (!fallbackRes.ok) {
          return json({ error: extractApiErrorMessage(fallbackRes.data, 'Could not generate invoice') }, { status: safeStatus(fallbackRes.status) });
        }
      }
      return json({ success: true });
    }
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
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    const isCartOrder = formData.get('isCartOrder') === 'true';

    if (isFollowUp) {
      // Follow-up orders: record the call. If still pre-engaged, also transition to CS_ENGAGED.
      const res = await apiRequest<unknown>('/trpc/orders.followUpRecordCall', {
        method: 'POST',
        cookie,
        body: { orderId },
        timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
      });
      if (!res.ok) {
        // Fallback: try the old transition approach (for backward compat)
        const fallback = await apiRequest<unknown>('/trpc/orders.followUpOrdersTransition', {
          method: 'POST',
          cookie,
          body: { orderId, newStatus: 'CS_ENGAGED', note: 'Manual call recorded.' },
          timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
        });
        if (!fallback.ok) {
          return json({ error: extractApiErrorMessage(fallback.data, 'Failed to record call') }, { status: safeStatus(fallback.status) });
        }
      }
      return json({ success: true, callInitiated: true, callLog: null });
    }

    if (isCartOrder) {
      const res = await apiRequest<unknown>('/trpc/cartOrders.initiateCall', {
        method: 'POST',
        cookie,
        body: { orderId },
        timeoutMs: ORDER_VOIP_ACTION_TIMEOUT_MS,
      });
      if (!res.ok) {
        return json({ error: extractApiErrorMessage(res.data, 'Failed to record call') }, { status: safeStatus(res.status) });
      }
      return json({ success: true, callInitiated: true, callLog: null });
    }

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

  if (intent === 'editOrderDetails') {
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    const customerName = formData.get('customerName')?.toString()?.trim();
    const deliveryAddress = formData.get('deliveryAddress')?.toString()?.trim();
    const deliveryState = formData.get('deliveryState')?.toString()?.trim();
    const deliveryNotes = formData.get('deliveryNotes')?.toString()?.trim();
    const customerEmail = formData.get('customerEmail')?.toString()?.trim();
    const preferredDeliveryDate = formData.get('preferredDeliveryDate')?.toString()?.trim();

    if (isFollowUp) {
      const body: Record<string, unknown> = { orderId };
      if (customerName !== undefined && customerName !== '') body.customerName = customerName;
      if (deliveryAddress !== undefined) body.deliveryAddress = deliveryAddress || null;
      if (deliveryState !== undefined) body.deliveryState = deliveryState || null;
      if (deliveryNotes !== undefined) body.deliveryNotes = deliveryNotes || null;
      if (customerEmail !== undefined && customerEmail !== '') body.customerEmail = customerEmail || null;
      if (preferredDeliveryDate !== undefined) body.preferredDeliveryDate = preferredDeliveryDate || null;
      const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersUpdate', {
        method: 'POST',
        cookie,
        body,
      });
      if (!res.ok) {
        const err = extractApiErrorMessage(res.data, 'Failed to update order details');
        return json({ error: err }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
    }

    const isCartOrder = formData.get('isCartOrder') === 'true';
    if (isCartOrder) {
      const body: Record<string, unknown> = { orderId };
      if (customerName !== undefined && customerName !== '') body.customerName = customerName;
      if (deliveryAddress !== undefined) body.deliveryAddress = deliveryAddress || null;
      if (deliveryState !== undefined) body.deliveryState = deliveryState || null;
      if (deliveryNotes !== undefined) body.deliveryNotes = deliveryNotes || null;
      if (customerEmail !== undefined && customerEmail !== '') body.customerEmail = customerEmail || null;
      if (preferredDeliveryDate !== undefined) body.preferredDeliveryDate = preferredDeliveryDate || null;
      const res = await apiRequest<unknown>('/trpc/cartOrders.update', {
        method: 'POST',
        cookie,
        body,
      });
      if (!res.ok) {
        const err = extractApiErrorMessage(res.data, 'Failed to update order details');
        return json({ error: err }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
    }

    const body: Record<string, unknown> = { orderId, ...branchIdFromForm(formData) };
    if (customerName !== undefined && customerName !== '') body.customerName = customerName;
    if (deliveryAddress !== undefined) body.deliveryAddress = deliveryAddress;
    if (deliveryState !== undefined) body.deliveryState = deliveryState;
    if (deliveryNotes !== undefined) body.deliveryNotes = deliveryNotes;
    if (customerEmail !== undefined && customerEmail !== '') body.customerEmail = customerEmail;
    if (preferredDeliveryDate !== undefined) body.preferredDeliveryDate = preferredDeliveryDate || null;
    const res = await apiRequest<unknown>('/trpc/orders.update', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to update order details');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
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
    let parsedItems: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
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
        const offerLabel =
          typeof o.offerLabel === 'string' && o.offerLabel.trim() !== ''
            ? o.offerLabel.trim()
            : undefined;
        return { productId, quantity, unitPrice, ...(offerLabel ? { offerLabel } : {}) };
      });
    } catch {
      return json({ error: 'Invalid items format' }, { status: 400 });
    }
    const totalAmount = totalAmountStr != null && totalAmountStr !== ''
      ? parseFloat(totalAmountStr)
      : parsedItems.reduce((sum, i) => sum + i.unitPrice, 0);
    if (Number.isNaN(totalAmount) || totalAmount < 0) {
      return json({ error: 'Invalid total amount' }, { status: 400 });
    }
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    const isCartOrder = formData.get('isCartOrder') === 'true';

    let endpoint = '/trpc/orders.update';
    let body: Record<string, unknown> = { orderId, items: parsedItems, totalAmount, ...branchIdFromForm(formData) };
    if (isFollowUp) {
      endpoint = '/trpc/orders.followUpOrdersAdjustItems';
      body = { orderId, items: parsedItems, totalAmount };
    } else if (isCartOrder) {
      endpoint = '/trpc/cartOrders.adjustItems';
      body = { orderId, items: parsedItems, totalAmount };
    }

    const res = await apiRequest<unknown>(endpoint, {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to update order items');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    // Regenerate invoice after item changes — fire-and-forget
    const invoiceEndpoint = isFollowUp
      ? '/trpc/finance.ensureInvoiceByOrder'
      : isCartOrder
        ? '/trpc/cartOrders.ensureInvoice'
        : '/trpc/finance.ensureInvoiceByOrder';
    void apiRequest<unknown>(invoiceEndpoint, {
      method: 'POST',
      cookie,
      body: { orderId },
    }).catch(() => { /* invoice regeneration is best-effort */ });
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
    let parsedItems: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
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
        const offerLabel =
          typeof o.offerLabel === 'string' && o.offerLabel.trim() !== ''
            ? o.offerLabel.trim()
            : undefined;
        return {
          productId,
          quantity,
          unitPrice: Math.round(unitPrice * 100) / 100,
          ...(offerLabel ? { offerLabel } : {}),
        };
      });
    } catch {
      return json({ error: 'Invalid items format' }, { status: 400 });
    }
    const totalAmount = totalAmountStr != null && totalAmountStr !== ''
      ? Math.round(parseFloat(totalAmountStr) * 100) / 100
      : Math.round(parsedItems.reduce((sum, i) => sum + i.unitPrice, 0) * 100) / 100;
    if (Number.isNaN(totalAmount) || totalAmount < 0) {
      return json({ error: 'Invalid total amount' }, { status: 400 });
    }
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    const isCartOrder = formData.get('isCartOrder') === 'true';

    const body: {
      orderId: string;
      items: typeof parsedItems;
      totalAmount: number;
      reason: string;
      branchId?: string;
      orderType?: 'followUp' | 'cart';
    } = { orderId, items: parsedItems, totalAmount, reason };
    if (branchIdField) {
      body.branchId = branchIdField;
    }
    if (isFollowUp) body.orderType = 'followUp';
    if (isCartOrder) body.orderType = 'cart';
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

  if (intent === 'withdrawLinePriceRequest') {
    const requestId = formData.get('requestId')?.toString()?.trim();
    if (!requestId) {
      return json({ error: 'Request ID is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/permissionRequests.reject', {
      method: 'POST',
      cookie,
      body: {
        requestId,
        reason: 'Withdrawn by requester',
      },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to withdraw request');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true, intent: 'withdrawLinePriceRequest' });
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

  if (intent === 'requestDeliveredOrderDeletion') {
    const allowedRoles = [
      'FINANCE_OFFICER',
      'SUPER_ADMIN',
      'ADMIN',
    ];
    if (!allowedRoles.includes(user.role)) {
      return json({ error: 'Only Finance or Admin can request delivered order deletion' }, { status: 403 });
    }
    const reason = formData.get('reason')?.toString()?.trim() ?? '';
    if (reason.length < 10) {
      return json({ error: 'Reason must be at least 10 characters' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/orders.requestDeliveredOrderDeletion', {
      method: 'POST',
      cookie,
      body: { orderId, reason },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to submit deletion request');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true, intent: 'requestDeliveredOrderDeletion' });
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

  if (intent === 'addCsOrderComment') {
    const comment = formData.get('comment')?.toString() ?? '';
    const trimmed = comment.trim();
    if (!trimmed) {
      return json({ error: 'Comment is required' }, { status: 400 });
    }
    if (trimmed.length > 2000) {
      return json({ error: 'Comment must be at most 2000 characters' }, { status: 400 });
    }
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    if (isFollowUp) {
      const res = await apiRequest<unknown>('/trpc/orders.addFollowUpOrderComment', {
        method: 'POST',
        cookie,
        body: { orderId, comment: trimmed },
      });
      if (!res.ok) {
        return json({ error: extractApiErrorMessage(res.data, 'Could not save comment') }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
    }
    const res = await apiRequest<unknown>('/trpc/orders.addCsOrderComment', {
      method: 'POST',
      cookie,
      body: { orderId, comment: trimmed, ...branchIdFromForm(formData) },
    });
    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Could not save comment');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'transition') {
    const newStatus = (formData.get('newStatus')?.toString() ?? '').trim();
    if (!newStatus) {
      return json({ error: 'Status is required' }, { status: 400 });
    }
    const csOnlyStatuses = ['CS_ENGAGED', 'CONFIRMED'];
    if (csOnlyStatuses.includes(newStatus)) {
      const allowedRoles = ['CS_CLOSER', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'];
      if (!allowedRoles.includes(user.role)) {
        return json({ error: 'You are not allowed to perform this action' }, { status: 403 });
      }
    }
    // DELETED: permission-gated via orders.delete (backend enforces; this is a coarse UI guard).
    // CEO directive 2026-05-23: replaces the old CANCELLED flow. Admin always can;
    // others need the orders.delete permission explicitly granted by Admin.
    if (newStatus === 'DELETED') {
      if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN' && !(user.permissions ?? []).includes('orders.delete')) {
        return json({ error: 'You do not have permission to delete orders' }, { status: 403 });
      }
    }
    // Restore a deleted/cancelled order back to the queue — Admin / Super Admin / HoCS / HoLogistics.
    if (newStatus === 'UNPROCESSED' && !['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'HEAD_OF_LOGISTICS'].includes(user.role)) {
      return json(
        { error: 'Only an Admin, Head of CS, or Head of Logistics can restore this order' },
        { status: 403 },
      );
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
    const isFollowUp = formData.get('isFollowUpOrder') === 'true';
    const isCartOrder = formData.get('isCartOrder') === 'true';

    if (isFollowUp) {
      const res = await apiRequest<unknown>('/trpc/orders.followUpOrdersTransition', {
        method: 'POST',
        cookie,
        body: {
          orderId,
          newStatus,
          note: reason,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        },
        timeoutMs: 20_000,
      });
      if (!res.ok) {
        const message = extractApiErrorMessage(res.data, 'Transition failed');
        return json({ error: message }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
    }

    if (isCartOrder) {
      const res = await apiRequest<unknown>('/trpc/cartOrders.transition', {
        method: 'POST',
        cookie,
        body: {
          orderId,
          newStatus,
          note: reason,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        },
        timeoutMs: 20_000,
      });
      if (!res.ok) {
        const message = extractApiErrorMessage(res.data, 'Transition failed');
        return json({ error: message }, { status: safeStatus(res.status) });
      }
      return json({ success: true });
    }

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

  if (intent === 'unfreezeOrder') {
    const reason = formData.get('reason')?.toString()?.trim() || undefined;
    const res = await apiRequest<unknown>('/trpc/orders.unfreezeOrder', {
      method: 'POST',
      cookie,
      body: { orderId, ...(reason ? { reason } : {}) },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to unfreeze order') }, { status: safeStatus(res.status) });
    }
    return json({ success: true, message: 'Order unfrozen — CS can resume.' });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

const ORDER_DETAIL_EVENTS = ['order:status_changed', 'order:assigned', 'order:transfer_accepted', 'order:transfer_rejected'] as const;

export default function OrderDetailRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const { pageData } = loaderData;
  const orderEvents = useMemo(() => [...ORDER_DETAIL_EVENTS], []);
  usePageRefreshOnEvent(orderEvents);

  // Populate the full-loader cache so `cachedClientLoader` serves instant
  // revisit data without a server roundtrip.
  const location = useLocation();
  const cacheKey = location.pathname + location.search;
  useEffect(() => {
    setFullLoaderEntry(cacheKey, loaderData);
  }, [cacheKey, loaderData]);

  const {
    orderDetail,
    canEditOrder,
    userRole,
    userId,
    currentBranchId,
    permissions,
    isMirroring,
    csClosersForAssign,
    logisticsLocations,
    allocatableLocations,
    logisticsDispatchTemplates,
    invoice,
  } = pageData;

  if ('loadError' in orderDetail && typeof orderDetail.loadError === 'string') {
    return (
      <div className="card text-center py-12">
        <p className="text-6xl font-bold text-warning-500/80 mb-4">!</p>
        <h2 className="text-xl font-bold text-app-fg">Could not load this order</h2>
        <p className="mt-2 text-sm text-app-fg-muted max-w-lg mx-auto">{orderDetail.loadError}</p>
        <p className="mt-3 text-xs text-app-fg-muted max-w-md mx-auto">
          A server or database error can look like a missing order. If you just deployed, run pending
          migrations on the API database, then redeploy the API.
        </p>
        <a href="/admin/sales/orders" className="btn-primary mt-6 inline-block">
          Back to Orders
        </a>
      </div>
    );
  }

  if ('notFound' in orderDetail && orderDetail.notFound) {
    return (
      <div className="card text-center py-12">
        <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
        <h2 className="text-xl font-bold text-app-fg">Order not found</h2>
        <p className="mt-2 text-sm text-app-fg-muted">
          The order you're looking for doesn't exist or has been removed.
        </p>
        <a href="/admin/sales/orders" className="btn-primary mt-4 inline-block">
          Back to Orders
        </a>
      </div>
    );
  }

  return (
    <OrderDetailPage
      order={(orderDetail as OrderDetailStreamData).order}
      latestCall={(orderDetail as OrderDetailStreamData).latestCall}
      timeline={(orderDetail as OrderDetailStreamData).timeline}
      voipEnabled={(orderDetail as OrderDetailStreamData).voipEnabled}
      voipProviderDisplayName={(orderDetail as OrderDetailStreamData).voipProviderDisplayName}
      itemOffers={(orderDetail as OrderDetailStreamData).itemOffers}
      productsForAdjust={(orderDetail as OrderDetailStreamData).productsForAdjust}
      callablePhone={(orderDetail as OrderDetailStreamData).callablePhone}
      isFollowUpOrder={(orderDetail as OrderDetailStreamData).isFollowUpOrder}
      isCartOrder={(orderDetail as { isCartOrder?: boolean }).isCartOrder}
      canEditOrder={canEditOrder}
      userRole={userRole}
      userId={userId}
      currentBranchId={currentBranchId}
      permissions={permissions}
      isMirroring={isMirroring}
      csClosersForAssign={csClosersForAssign}
      logisticsLocations={logisticsLocations}
      allocatableLocations={allocatableLocations}
      logisticsDispatchTemplates={logisticsDispatchTemplates}
      invoice={invoice}
    />
  );
}

/**
 * ErrorBoundary — catches turbo-stream deserialization errors that occur when
 * multiple concurrent revalidations race on cart/follow-up order detail pages.
 * Instead of showing a dead-end "Page Not Found", auto-reload the page so the
 * user lands on a fresh SSR render that always works.
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);

  useEffect(() => {
    // Auto-reload after a short delay — the full SSR page load always works.
    const timer = setTimeout(() => {
      window.location.reload();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center space-y-3">
        <svg className="w-8 h-8 mx-auto animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-app-fg-muted">Refreshing order...</p>
      </div>
    </div>
  );
}
