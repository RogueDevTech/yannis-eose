import { Suspense } from 'react';
import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Await, useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { ShipmentDetailPage } from '~/features/inventory/ShipmentDetailPage';
import type { ShipmentDetail } from '~/features/inventory/types';
import { ShipmentDetailLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Shipment — Yannis EOSE' }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'inventory.read');
  const shipmentId = params['id'];
  if (!shipmentId) throw new Response('Missing shipment id', { status: 400 });
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const res = await apiRequest<unknown>(
      `/trpc/inventory.shipments.get?input=${encodeURIComponent(JSON.stringify({ shipmentId }))}`,
      { method: 'GET', cookie },
    );
    if (!res.ok) {
      throw new Response('Failed to load shipment', { status: safeStatus(res.status) });
    }
    const detail =
      (res.data as { result?: { data?: ShipmentDetail } })?.result?.data ?? null;
    if (!detail) {
      throw new Response('Shipment not found', { status: 404 });
    }
    return { detail, shipmentId };
  })();

  return defer({ pageData });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  const shipmentId = params['id'];
  if (!shipmentId) return json({ error: 'Missing shipment id' }, { status: 400 });

  const fd = await request.formData();
  const intent = fd.get('intent')?.toString();

  if (intent === 'shipmentMarkInTransit' || intent === 'shipmentMarkArrived') {
    await requirePermission(request, 'inventory.intake');
    const procedure =
      intent === 'shipmentMarkInTransit'
        ? 'inventory.shipments.markInTransit'
        : 'inventory.shipments.markArrived';
    const res = await apiRequest<unknown>(`/trpc/${procedure}`, {
      method: 'POST',
      cookie,
      body: { shipmentId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update shipment') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'verifyShipment') {
    await requirePermission(request, 'inventory.verifyTransfer');
    const linesRaw = fd.get('lines')?.toString() ?? '[]';
    let lines: Array<{ lineId: string; receivedQuantity: number; varianceReason?: string }>;
    try {
      const parsed = JSON.parse(linesRaw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return json({ error: 'No lines submitted for verification.' }, { status: 400 });
      }
      lines = parsed;
    } catch {
      return json({ error: 'Invalid line payload.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/inventory.shipments.verify', {
      method: 'POST',
      cookie,
      body: { shipmentId, lines },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to verify shipment') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'closeShipment') {
    await requirePermission(request, 'inventory.verifyTransfer');
    const res = await apiRequest<unknown>('/trpc/inventory.shipments.close', {
      method: 'POST',
      cookie,
      body: { shipmentId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to close shipment') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'shipmentCancel') {
    await requirePermission(request, 'inventory.intake');
    const reason = (fd.get('reason') ?? '').toString().trim();
    if (reason.length < 10) {
      return json({ error: 'Reason must be at least 10 characters.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/inventory.shipments.cancel', {
      method: 'POST',
      cookie,
      body: { shipmentId, reason },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to cancel shipment') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function ShipmentDetailRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  usePageRefreshOnEvent(['shipment:updated', 'stock:updated']);
  return (
    <Suspense fallback={<ShipmentDetailLoadingShell />}>
      <Await resolve={pageData}>
        {({ detail, shipmentId }) => (
          <ShipmentDetailPage
            data={detail as ShipmentDetail}
            actionUrl={`/admin/inventory/shipments/${shipmentId}`}
          />
        )}
      </Await>
    </Suspense>
  );
}
