import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { ContractorDeliveryImportPage } from '~/features/logistics/ContractorDeliveryImportPage';
import type { ProductInfo } from '~/features/logistics/contractor-delivery-import-shared';

export const meta: MetaFunction = () => [
  { title: 'Import contractor deliveries — Yannis EOSE' },
];

/**
 * Loader for `/admin/logistics/contractor-deliveries/import`. Gated on
 * `orders.createOffline` (matches the backend importContractorDelivery gate).
 * Fetches products (for name resolution) and logistics providers/locations (so
 * imported deliveries can be attributed to a 3PL and surface on the dashboard).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'orders.createOffline');
  const cookie = getSessionCookie(request);

  const [productsRes, providersRes, locationsRes] = await Promise.all([
    apiRequest<unknown>(
      `/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 500, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/logistics.listProviders?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 200 }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      `/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 500 }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  type ProductRow = { id: string; name: string };
  let products: ProductInfo[] = [];
  if (productsRes.ok) {
    const data = productsRes.data as { result?: { data?: { products?: ProductRow[] } } };
    products = (data?.result?.data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  type ProviderRow = { id: string; name: string };
  let providers: ProviderRow[] = [];
  if (providersRes.ok) {
    const data = providersRes.data as { result?: { data?: { providers?: ProviderRow[] } | ProviderRow[] } };
    const raw = data?.result?.data;
    providers = (Array.isArray(raw) ? raw : (raw?.providers ?? [])).map((p) => ({ id: p.id, name: p.name }));
  }

  type LocationRow = { id: string; name: string; providerId?: string | null };
  let locations: LocationRow[] = [];
  if (locationsRes.ok) {
    const data = locationsRes.data as { result?: { data?: { locations?: LocationRow[] } | LocationRow[] } };
    const raw = data?.result?.data;
    locations = (Array.isArray(raw) ? raw : (raw?.locations ?? [])).map((l) => ({
      id: l.id,
      name: l.name,
      providerId: l.providerId ?? null,
    }));
  }

  return json({ products, providers, locations });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'orders.createOffline');
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent')?.toString();

  if (intent !== 'importContractorDelivery') {
    return json({ error: 'Unknown intent' }, { status: 400 });
  }

  const rowIndex = Number.parseInt(form.get('rowIndex')?.toString() ?? '', 10);
  const contractorName = form.get('contractorName')?.toString()?.trim() ?? '';
  const customerName = form.get('customerName')?.toString()?.trim() ?? '';
  const customerPhone = form.get('customerPhone')?.toString()?.trim() ?? '';
  const branchId = form.get('branchId')?.toString()?.trim() ?? '';

  if (contractorName.length < 2) {
    return json({ error: 'Contractor name is required', rowIndex }, { status: 400 });
  }
  if (customerName.length < 2) {
    return json({ error: 'Customer name is required', rowIndex }, { status: 400 });
  }
  if (!customerPhone) {
    return json({ error: 'Customer phone is required', rowIndex }, { status: 400 });
  }
  if (!branchId) {
    return json({ error: 'Branch is required', rowIndex }, { status: 400 });
  }

  let items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  try {
    items = JSON.parse(form.get('items')?.toString() ?? '[]');
  } catch {
    return json({ error: 'Invalid items', rowIndex }, { status: 400 });
  }
  if (!items.length || items.some((i) => !i.productId || i.quantity < 1)) {
    return json({ error: 'At least one valid item is required', rowIndex }, { status: 400 });
  }

  const body: Record<string, unknown> = { contractorName, customerName, customerPhone, branchId, items };

  const deliveredAtOverride = form.get('deliveredAtOverride')?.toString()?.trim();
  if (deliveredAtOverride) body.deliveredAtOverride = deliveredAtOverride;
  const deliveryAddress = form.get('deliveryAddress')?.toString()?.trim();
  if (deliveryAddress) body.deliveryAddress = deliveryAddress;
  const deliveryState = form.get('deliveryState')?.toString()?.trim();
  if (deliveryState) body.deliveryState = deliveryState;
  const providerId = form.get('logisticsProviderId')?.toString()?.trim();
  if (providerId) body.logisticsProviderId = providerId;
  const locationId = form.get('logisticsLocationId')?.toString()?.trim();
  if (locationId) body.logisticsLocationId = locationId;
  if (form.get('remitted')?.toString() === 'true') body.remitted = true;
  const totalAmountRaw = form.get('totalAmount')?.toString()?.trim();
  if (totalAmountRaw) {
    const totalAmount = parseFloat(totalAmountRaw);
    if (Number.isFinite(totalAmount) && totalAmount >= 0) body.totalAmount = totalAmount;
  }

  const res = await apiRequest<unknown>('/trpc/orders.importContractorDelivery', {
    method: 'POST',
    cookie,
    body,
  });

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to import delivery'), rowIndex },
      { status: safeStatus(res.status) },
    );
  }
  return json({ success: true, rowIndex });
}

export default function ContractorDeliveryImportRoute() {
  const { products, providers, locations } = useLoaderData<typeof loader>();
  return (
    <ContractorDeliveryImportPage
      products={products}
      providers={providers}
      locations={locations}
    />
  );
}
