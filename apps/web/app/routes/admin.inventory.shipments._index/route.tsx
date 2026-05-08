import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { Await, Link, useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Pagination } from '~/components/ui/pagination';
import type { LocationOption, ProductOption, ShipmentRow } from '~/features/inventory/types';
import { ShipmentsTab } from '~/features/inventory/ShipmentsTab';
import { ShipmentsListLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Shipments — Inventory — Yannis EOSE' }];

const readOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });
  const cookie = getSessionCookie(request);
  const actorPerms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));

  const url = new URL(request.url);
  const rawPage = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const LIMIT = 20;

  const receive = url.searchParams.get('receive') === '1';
  if (receive) {
    return redirect('/admin/inventory/shipments/receive');
  }

  const pageData = (async () => {
    const shipmentsInput = { page, limit: LIMIT };
    const shipmentsPromise = apiRequest<unknown>(
      `/trpc/inventory.shipments.list?input=${encodeURIComponent(JSON.stringify(shipmentsInput))}`,
      { method: 'GET', cookie, ...readOpts },
    );

    const productsPromise = apiRequest<unknown>(
      `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
      { method: 'GET', cookie, ...readOpts },
    );

    const locationsPromise = apiRequest<unknown>(
      `/trpc/logistics.locationOptions?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', providerKind: 'WAREHOUSE' }))}`,
      { method: 'GET', cookie, ...readOpts },
    );

    const [shipmentsRes, productsRes, locationsRes] = await Promise.all([
      shipmentsPromise,
      productsPromise,
      locationsPromise,
    ]);

    const shipmentsData = shipmentsRes.ok
      ? ((shipmentsRes.data as { result?: { data?: { rows: ShipmentRow[]; pagination: { total: number; totalPages: number } } } })
          ?.result?.data ?? null)
      : null;

    const productsData = productsRes.ok
      ? ((productsRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data ?? null)
      : null;

    const locationsData = locationsRes.ok
      ? ((locationsRes.data as { result?: { data?: Array<{ id: string; name: string; providerName?: string | null }> } })
          ?.result?.data ?? null)
      : null;

    const products: ProductOption[] = (productsData ?? []).map((p) => ({ id: p.id, name: p.name }));
    const locations: LocationOption[] = (locationsData ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      providerName: l.providerName ?? null,
    }));

    return {
      shipments: shipmentsData?.rows ?? [],
      totalShipments: shipmentsData?.pagination?.total ?? 0,
      totalPages: shipmentsData?.pagination?.totalPages ?? 1,
      page,
      limit: LIMIT,
      products,
      locations,
      canIntake:
        isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.intake')),
      loadError: shipmentsRes.ok ? null : extractApiErrorMessage(shipmentsRes.data, 'Failed to load shipments'),
    };
  })();

  return defer({ pageData });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createShipment') {
    await requirePermission(request, 'inventory.intake');
    const destinationLocationId = formData.get('destinationLocationId')?.toString() ?? '';
    const label = formData.get('label')?.toString() ?? '';
    const supplierName = formData.get('supplierName')?.toString() ?? '';
    const supplierReference = formData.get('supplierReference')?.toString() ?? '';
    const expectedArrivalDate = formData.get('expectedArrivalDate')?.toString() ?? '';
    const totalLandingCost = formData.get('totalLandingCost')?.toString() ?? '0';
    const notes = formData.get('notes')?.toString() ?? '';
    const arrivedNow = formData.get('arrivedNow')?.toString() === 'true';
    const linesRaw = formData.get('lines')?.toString() ?? '[]';

    let lines: Array<{ productId: string; expectedQuantity: number; factoryCost: number }>;
    try {
      const parsed = JSON.parse(linesRaw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return json({ error: 'Add at least one line item to the shipment.' }, { status: 400 });
      }
      lines = parsed;
    } catch {
      return json({ error: 'Invalid shipment line payload.' }, { status: 400 });
    }
    if (!destinationLocationId) {
      return json({ error: 'Destination location is required.' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.shipments.create', {
      method: 'POST',
      cookie,
      body: {
        destinationLocationId,
        label,
        supplierName,
        supplierReference,
        expectedArrivalDate,
        totalLandingCost: Number(totalLandingCost) || 0,
        notes,
        arrivedNow,
        lines,
      },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create shipment') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'shipmentMarkInTransit' || intent === 'shipmentMarkArrived') {
    await requirePermission(request, 'inventory.intake');
    const shipmentId = formData.get('shipmentId')?.toString() ?? '';
    if (!shipmentId) return json({ error: 'Missing shipment id.' }, { status: 400 });
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

  if (intent === 'shipmentCancel') {
    await requirePermission(request, 'inventory.intake');
    const shipmentId = formData.get('shipmentId')?.toString() ?? '';
    const reason = formData.get('reason')?.toString().trim() ?? '';
    if (!shipmentId) return json({ error: 'Missing shipment id.' }, { status: 400 });
    if (reason.length < 10) return json({ error: 'Reason must be at least 10 characters.' }, { status: 400 });
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

  return json({ error: 'Unknown action' }, { status: 400 });
}

function InventoryShipmentsIndexContent(data: {
  shipments: ShipmentRow[];
  totalShipments: number;
  totalPages: number;
  page: number;
  limit: number;
  products: ProductOption[];
  locations: LocationOption[];
  canIntake: boolean;
  loadError: string | null;
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Inbound Shipments"
        description="Receive supplier deliveries into your warehouses. Verify to post into inventory and create FIFO batches."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <Link to="/admin/inventory" prefetch="intent" className="btn-secondary btn-sm">
              Back to inventory
            </Link>
          </div>
        }
      />

      {data.loadError && (
        <div className="card p-4 text-sm text-danger-700 dark:text-danger-300">
          {data.loadError}
        </div>
      )}

      <div className="card p-0">
        <ShipmentsTab
          shipments={data.shipments}
          totalShipments={data.totalShipments}
          canIntake={data.canIntake}
        />
      </div>

      {data.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            Showing {(data.page - 1) * data.limit + 1}–{Math.min(data.page * data.limit, data.totalShipments)} of{' '}
            {data.totalShipments} shipments
          </p>
          <Pagination page={data.page} totalPages={data.totalPages} pageParam="page" />
        </div>
      )}
    </div>
  );
}

export default function InventoryShipmentsIndexRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<ShipmentsListLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => <InventoryShipmentsIndexContent {...data} />}
      </Await>
    </Suspense>
  );
}

