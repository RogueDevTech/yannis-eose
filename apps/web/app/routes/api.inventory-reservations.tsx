import type { ActionFunctionArgs, LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  requirePermissionForAction,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

/** One order holding reserved stock of a product at a logistics location. */
export type ReservationHolder = {
  orderId: string;
  orderNumber: string;
  status: string;
  allocatedAt: string | null;
  daysWaiting: number | null;
  overdue: boolean;
  quantity: number;
  closerName: string | null;
};

export type ReservationHoldersData = {
  reserved: number;
  heldByOrders: number;
  unlinkedReserved: number;
  /** Company rule: reservations release automatically after this many days (0 = never). */
  releaseAfterDays: number;
  orders: ReservationHolder[];
};

/** GET ?productId&locationId: the orders holding that product's reserved stock there. */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'inventory.read');
  const url = new URL(request.url);
  const productId = url.searchParams.get('productId') ?? '';
  const locationId = url.searchParams.get('locationId') ?? '';
  if (!productId || !locationId) {
    return json({ ok: false as const, error: 'Product and location are required' });
  }
  const res = await apiRequest<unknown>(
    `/trpc/inventory.reservationHolders?input=${encodeURIComponent(JSON.stringify({ productId, locationId }))}`,
    { method: 'GET', cookie: getSessionCookie(request), timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );
  if (!res.ok) {
    return json({ ok: false as const, error: extractApiErrorMessage(res.data, 'Could not load the orders holding this stock') });
  }
  const data = (res.data as { result?: { data?: ReservationHoldersData } })?.result?.data;
  return json({ ok: true as const, data: data ?? { reserved: 0, heldByOrders: 0, unlinkedReserved: 0, releaseAfterDays: 30, orders: [] } });
}

/** POST: release the reserved stock of the selected orders (they stay with logistics). */
export async function action({ request }: ActionFunctionArgs) {
  const gate = await requirePermissionForAction(request, 'inventory.reservations.release');
  if (!gate.ok) return json({ success: false, error: gate.error }, { status: gate.status });

  const form = await request.formData();
  const orderIds = form.getAll('orderIds').map(String).filter(Boolean);
  const reason = String(form.get('reason') ?? '').trim();
  if (orderIds.length === 0) return json({ success: false, error: 'Select at least one order' }, { status: 400 });
  if (reason.length < 10) {
    return json({ success: false, error: 'Add a reason of at least 10 characters' }, { status: 400 });
  }

  const res = await apiRequest<unknown>('/trpc/inventory.releaseReservations', {
    method: 'POST',
    cookie: getSessionCookie(request),
    body: { orderIds, reason },
  });
  if (!res.ok) {
    return json({ success: false, error: extractApiErrorMessage(res.data, 'Could not release the stock') }, { status: 400 });
  }
  const result = (res.data as { result?: { data?: { released: number; skipped: number } } })?.result?.data;
  const released = result?.released ?? 0;
  const skipped = result?.skipped ?? 0;
  if (released === 0) {
    return json({ success: false, error: 'Nothing released. The orders are no longer holding stock.' }, { status: 400 });
  }
  return json({
    success: true,
    message: `Stock released for ${released} ${released === 1 ? 'order' : 'orders'}.`,
    warning: skipped > 0 ? `${skipped} skipped: no longer holding stock.` : null,
  });
}
