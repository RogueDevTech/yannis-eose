import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { RemittancesAdminPage } from '~/features/remittances/RemittancesAdminPage';
import type { TransferConfirmationRecord } from '~/features/remittances/RemittancesAdminPage';

export const meta: MetaFunction = () => [
  { title: 'Stock Transfer Confirmations — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'logistics.write');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const status = (url.searchParams.get('status') ?? '').trim();
  const locationId = (url.searchParams.get('locationId') ?? '').trim();
  const search = (url.searchParams.get('search') ?? '').trim().toLowerCase();
  const sender = (url.searchParams.get('sender') ?? '').trim().toLowerCase();
  const minQtyRaw = (url.searchParams.get('minQty') ?? '').trim();
  const maxQtyRaw = (url.searchParams.get('maxQty') ?? '').trim();
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const startDate = periodAllTime ? '' : (url.searchParams.get('startDate') ?? '').trim();
  const endDate = periodAllTime ? '' : (url.searchParams.get('endDate') ?? '').trim();
  const minQty = minQtyRaw === '' ? undefined : Number.parseInt(minQtyRaw, 10);
  const maxQty = maxQtyRaw === '' ? undefined : Number.parseInt(maxQtyRaw, 10);

  const [transfersRes, productsRes, locationsRes] = await Promise.all([
    apiRequest<unknown>('/trpc/inventory.transfers?input=' + encodeURIComponent(JSON.stringify({})), {
      method: 'GET',
      cookie,
    }),
    apiRequest<unknown>(
      '/trpc/products.list?input=' + encodeURIComponent(JSON.stringify({ limit: 200, status: 'ACTIVE' })),
      { method: 'GET', cookie },
    ),
    apiRequest<unknown>(
      '/trpc/logistics.listLocations?input=' + encodeURIComponent(JSON.stringify({ limit: 100 })),
      { method: 'GET', cookie },
    ),
  ]);

  const transfers =
    transfersRes.ok
      ? ((transfersRes.data as { result?: { data?: TransferConfirmationRecord[] } })?.result?.data ?? [])
      : [];
  const products =
    productsRes.ok
      ? ((productsRes.data as { result?: { data?: { products?: Array<{ id: string; name: string }> } } })?.result?.data?.products ?? [])
      : [];
  const locations =
    locationsRes.ok
      ? ((locationsRes.data as { result?: { data?: { locations?: Array<{ id: string; name: string }> } } })?.result?.data?.locations ?? [])
      : [];

  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const locationMap = new Map(locations.map((l) => [l.id, l.name]));

  const records = transfers.map((t) => ({
    ...t,
    productName: productMap.get(t.productId) ?? 'Unknown product',
    fromLocationName: locationMap.get(t.fromLocationId) ?? 'Unknown location',
    toLocationName: locationMap.get(t.toLocationId) ?? 'Unknown location',
    senderName: (t as { senderName?: string | null }).senderName ?? null,
  }));

  const statusWhitelist = new Set(['IN_TRANSIT', 'RECEIVED', 'DISPUTED']);
  const normalizedStatus = statusWhitelist.has(status) ? status : '';
  const filteredRemittances = records.filter((r) => {
    if (normalizedStatus && r.transferStatus !== normalizedStatus) return false;
    if (locationId && r.toLocationId !== locationId && r.fromLocationId !== locationId) return false;
    if (search && !(`${r.id} ${r.productName}`.toLowerCase().includes(search))) return false;
    if (sender && !(r.senderName ?? '').toLowerCase().includes(sender)) return false;
    if (Number.isFinite(minQty) && r.quantitySent < (minQty as number)) return false;
    if (Number.isFinite(maxQty) && r.quantitySent > (maxQty as number)) return false;
    if (startDate) {
      const created = new Date(r.createdAt);
      if (Number.isNaN(created.getTime())) return false;
      if (created < new Date(`${startDate}T00:00:00`)) return false;
    }
    if (endDate) {
      const created = new Date(r.createdAt);
      if (Number.isNaN(created.getTime())) return false;
      if (created > new Date(`${endDate}T23:59:59`)) return false;
    }
    return true;
  });

  const senderOptions = Array.from(
    new Set(
      records
        .map((r) => r.senderName)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return {
    remittances: filteredRemittances,
    locations,
    senderOptions,
    filters: {
      status: normalizedStatus,
      locationId,
      search: (url.searchParams.get('search') ?? '').trim(),
      sender: (url.searchParams.get('sender') ?? '').trim(),
      minQty: minQtyRaw,
      maxQty: maxQtyRaw,
      startDate,
      endDate,
      periodAllTime,
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'markTransferReceived') {
    await requirePermission(request, 'logistics.write');
    const transferId = formData.get('transferId')?.toString();
    const quantityReceived = parseInt(formData.get('quantityReceived')?.toString() ?? '0', 10);
    const shrinkageReason = formData.get('shrinkageReason')?.toString()?.trim() || undefined;

    if (!transferId) {
      return json({ error: 'Transfer ID is required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.verifyTransfer', {
      method: 'POST',
      cookie,
      body: {
        transferId,
        quantityReceived,
        ...(shrinkageReason && { shrinkageReason }),
      },
    });

    if (!res.ok) {
      const err = extractApiErrorMessage(res.data, 'Failed to mark as received');
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function AdminLogisticsRemittancesRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <RemittancesAdminPage
      remittances={data.remittances}
      locations={data.locations ?? []}
      senderOptions={data.senderOptions ?? []}
      filters={data.filters}
    />
  );
}
