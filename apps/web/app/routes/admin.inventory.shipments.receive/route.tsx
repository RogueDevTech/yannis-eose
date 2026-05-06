import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useActionData, useLoaderData } from '@remix-run/react';
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
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageNotification } from '~/components/ui/page-notification';
import type { LocationOption, ProductOption } from '~/features/inventory/types';
import { ReceiveShipmentForm } from '~/features/inventory/ReceiveShipmentForm';

export const meta: MetaFunction = () => [{ title: 'Receive shipment — Inventory — Yannis EOSE' }];

const readOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });
  const cookie = getSessionCookie(request);

  const productsPromise = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ limit: 100, status: 'ACTIVE' }))}`,
    { method: 'GET', cookie, ...readOpts },
  );

  // Stock intake / inbound shipment targets: company-owned warehouses only.
  const locationsPromise = apiRequest<unknown>(
    `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', providerKind: 'WAREHOUSE', limit: 100 }))}`,
    { method: 'GET', cookie, ...readOpts },
  );

  const [productsRes, locationsRes] = await Promise.all([productsPromise, locationsPromise]);

  const productsData = productsRes.ok
    ? ((productsRes.data as { result?: { data?: { products: { id: string; name: string }[] } } })?.result?.data ??
        null)
    : null;

  const locationsData = locationsRes.ok
    ? ((locationsRes.data as {
        result?: { data?: { locations: { id: string; name: string; providerName?: string | null }[] } };
      })?.result?.data ?? null)
    : null;

  const products: ProductOption[] = (productsData?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  const locations: LocationOption[] = (locationsData?.locations ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    providerName: l.providerName ?? null,
  }));

  const canIntake = isAdminLevel(user) || (user.permissions?.includes('inventory.intake') ?? false);

  return {
    products,
    locations,
    canIntake,
    loadError: productsRes.ok && locationsRes.ok
      ? null
      : [
          !productsRes.ok ? extractApiErrorMessage(productsRes.data, 'Failed to load products') : null,
          !locationsRes.ok ? extractApiErrorMessage(locationsRes.data, 'Failed to load locations') : null,
        ].filter(Boolean).join(' · ') || 'Failed to load receive-shipment data',
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent !== 'createShipment') {
    return json({ error: 'Unknown intent' }, { status: 400 });
  }

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

  const createdId =
    (res.data as { result?: { data?: { id?: string } } })?.result?.data?.id ??
    (res.data as { result?: { data?: { shipment?: { id?: string } } } })?.result?.data?.shipment?.id ??
    null;

  if (typeof createdId === 'string' && createdId.length > 0) {
    return redirect(`/admin/inventory/shipments/${createdId}`);
  }

  // Fallback if the API shape changes unexpectedly: go back to list.
  return redirect('/admin/inventory/shipments');
}

export default function ReceiveShipmentRoute() {
  const data = useLoaderData<typeof loader>() as unknown as {
    products: ProductOption[];
    locations: LocationOption[];
    canIntake: boolean;
    loadError: string | null;
  };
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Receive shipment"
        description="Record an incoming supplier shipment. Use this page for large multi-SKU receipts."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <Link to="/admin/inventory/shipments" prefetch="intent" className="btn-secondary btn-sm">
              Back to shipments
            </Link>
          </div>
        }
      />

      {!data.canIntake ? (
        <div className="card p-4">
          <PageNotification
            variant="error"
            message="You don’t have permission to receive shipments. Ask an Admin or Stock Manager."
            onDismiss={() => {}}
          />
        </div>
      ) : null}

      {data.loadError ? (
        <div className="card p-4">
          <PageNotification variant="error" message={data.loadError} onDismiss={() => {}} />
        </div>
      ) : null}

      {actionData?.error ? (
        <div className="card p-4">
          <PageNotification variant="error" message={actionData.error} onDismiss={() => {}} />
        </div>
      ) : null}

      <ReceiveShipmentForm
        disabled={!data.canIntake}
        products={data.products}
        locations={data.locations}
        actionUrl="/admin/inventory/shipments/receive"
      />
    </div>
  );
}

