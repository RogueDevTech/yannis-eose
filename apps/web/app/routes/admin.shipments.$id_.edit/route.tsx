import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useActionData, useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getSessionCookie,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageNotification } from '~/components/ui/page-notification';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import {
  ReceiveShipmentForm,
  type ReceiveShipmentInitial,
} from '~/features/inventory/ReceiveShipmentForm';
import type { LocationOption, ProductOption, ShipmentDetail } from '~/features/inventory/types';

export const meta: MetaFunction = () => [{ title: 'Edit shipment — Shipments — Yannis EOSE' }];

const readOpts = { timeoutMs: DEFERRED_LOADER_TIMEOUT_MS } as const;

/** Verified / closed / cancelled shipments are immutable — costing is frozen. */
const TERMINAL_STATUSES = new Set(['VERIFIED', 'CLOSED', 'CANCELLED']);

/** ISO timestamp → `YYYY-MM-DD` (local parts) for an `<input type="date">`. */
function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Money string → form value: positive amounts show, zero shows blank (optional). */
function moneyToFormValue(raw: string | null | undefined): string {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'inventory.shipments.read');
  const cookie = getSessionCookie(request);
  const shipmentId = params['id'];
  if (!shipmentId) throw new Response('Missing shipment id', { status: 400 });
  const actorPerms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));

  const [shipmentRes, productsRes, locationsRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/inventory.shipments.get?input=${encodeURIComponent(JSON.stringify({ shipmentId }))}`,
      { method: 'GET', cookie, ...readOpts },
    ),
    apiRequest<unknown>(
      `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
      { method: 'GET', cookie, ...readOpts },
    ),
    apiRequest<unknown>(
      `/trpc/logistics.locationOptions?input=${encodeURIComponent(
        JSON.stringify({ status: 'ACTIVE', providerKind: 'WAREHOUSE' }),
      )}`,
      { method: 'GET', cookie, ...readOpts },
    ),
  ]);

  if (!shipmentRes.ok) {
    throw new Response('Failed to load shipment', { status: safeStatus(shipmentRes.status) });
  }
  const detail =
    (shipmentRes.data as { result?: { data?: ShipmentDetail } })?.result?.data ?? null;
  if (!detail) throw new Response('Shipment not found', { status: 404 });

  // Locked shipments can't be edited — bounce back to the read-only detail page.
  if (TERMINAL_STATUSES.has(detail.shipment.status)) {
    throw redirect(`/admin/shipments/${shipmentId}`);
  }

  const productsData = productsRes.ok
    ? ((productsRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result
        ?.data ?? null)
    : null;
  const locationsData = locationsRes.ok
    ? ((locationsRes.data as {
        result?: {
          data?: Array<{
            id: string;
            name: string;
            providerName?: string | null;
            providerKind?: 'WAREHOUSE' | 'THIRD_PARTY' | null;
          }>;
        };
      })?.result?.data ?? null)
    : null;

  const products: ProductOption[] = (productsData ?? []).map((p) => ({ id: p.id, name: p.name }));
  const locations: LocationOption[] = (locationsData ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    providerName: l.providerName ?? null,
    providerKind: l.providerKind ?? null,
  }));

  const initial: ReceiveShipmentInitial = {
    shipmentId,
    destinationLocationId: detail.shipment.destinationLocationId,
    label: detail.shipment.label ?? '',
    supplierName: detail.shipment.supplierName ?? '',
    supplierReference: detail.shipment.supplierReference ?? '',
    expectedArrivalDate: toDateInputValue(detail.shipment.expectedArrivalAt),
    totalLandingCost: moneyToFormValue(detail.shipment.totalLandingCost),
    notes: detail.shipment.notes ?? '',
    lines: detail.lines.map((line) => ({
      productId: line.productId,
      expectedQuantity: String(line.expectedQuantity),
      factoryCost: moneyToFormValue(line.factoryCost),
    })),
  };

  const canIntake =
    isAdminLevel(user) || actorPerms.has(canonicalPermissionCode('inventory.intake'));

  return {
    initial,
    referenceLabel: detail.shipment.referenceLabel,
    products,
    locations,
    canIntake,
    loadError:
      productsRes.ok && locationsRes.ok
        ? null
        : [
            !productsRes.ok
              ? extractApiErrorMessage(productsRes.data, 'Failed to load products')
              : null,
            !locationsRes.ok
              ? extractApiErrorMessage(locationsRes.data, 'Failed to load locations')
              : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'Failed to load edit-shipment data',
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const shipmentId = params['id'];
  if (!shipmentId) return json({ error: 'Missing shipment id' }, { status: 400 });

  const formData = await request.formData();
  if (formData.get('intent')?.toString() !== 'editShipment') {
    return json({ error: 'Unknown intent' }, { status: 400 });
  }

  await requirePermission(request, 'inventory.intake');

  const totalLandingCost = Number(formData.get('totalLandingCost')?.toString() ?? '0');
  if (!Number.isFinite(totalLandingCost) || totalLandingCost < 0) {
    return json({ error: 'Total landing cost must be a positive number.' }, { status: 400 });
  }

  const expectedArrivalDate = formData.get('expectedArrivalDate')?.toString() ?? '';
  if (expectedArrivalDate && !/^\d{4}-\d{2}-\d{2}$/u.test(expectedArrivalDate)) {
    return json({ error: 'Expected arrival must be a valid date.' }, { status: 400 });
  }

  const linesRaw = formData.get('lines')?.toString() ?? '[]';
  let lines: Array<{ productId: string; expectedQuantity: number; factoryCost?: number }>;
  try {
    const parsed = JSON.parse(linesRaw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return json({ error: 'Add at least one line item to the shipment.' }, { status: 400 });
    }
    lines = parsed;
  } catch {
    return json({ error: 'Invalid shipment line payload.' }, { status: 400 });
  }

  const res = await apiRequest<unknown>('/trpc/inventory.shipments.updateLines', {
    method: 'POST',
    cookie,
    body: {
      shipmentId,
      label: formData.get('label')?.toString() ?? '',
      supplierName: formData.get('supplierName')?.toString() ?? '',
      supplierReference: formData.get('supplierReference')?.toString() ?? '',
      expectedArrivalDate,
      notes: formData.get('notes')?.toString() ?? '',
      totalLandingCost,
      lines,
    },
  });

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to update shipment') },
      { status: safeStatus(res.status) },
    );
  }

  return redirect(`/admin/shipments/${shipmentId}`);
}

export default function EditShipmentRoute() {
  const data = useLoaderData<typeof loader>() as unknown as {
    initial: ReceiveShipmentInitial;
    referenceLabel: string;
    products: ProductOption[];
    locations: LocationOption[];
    canIntake: boolean;
    loadError: string | null;
  };
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const detailUrl = `/admin/shipments/${data.initial.shipmentId}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${data.referenceLabel}`}
        description="Correct shipment details and line items. Destination cannot be changed."
        breadcrumb={
          <Breadcrumb
            items={[
              { label: 'Shipments', to: '/admin/shipments' },
              { label: data.referenceLabel, to: detailUrl },
              { label: 'Edit' },
            ]}
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <Link to={detailUrl} prefetch="intent" className="btn-secondary btn-sm">
              Back to shipment
            </Link>
          </div>
        }
      />

      {!data.canIntake ? (
        <div className="card p-4">
          <PageNotification
            variant="error"
            message="You don’t have permission to edit shipments. Ask an Admin or Stock Manager."
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
        actionUrl={`${detailUrl}/edit`}
        initial={data.initial}
        cancelTo={detailUrl}
      />
    </div>
  );
}
