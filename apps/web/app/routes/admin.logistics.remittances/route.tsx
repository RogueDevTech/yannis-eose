import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

import { Await, useLoaderData } from '@remix-run/react';
import { Suspense } from 'react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { RemittancesAdminPage } from '~/features/remittances/RemittancesAdminPage';
import { LogisticsRemittancesLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';
import type { TransferConfirmationRecord } from '~/features/remittances/RemittancesAdminPage';

export const meta: MetaFunction = () => [
  { title: 'Stock Transfer Confirmations — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, ['logistics.write', 'inventory.verifyTransfer']);
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
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

  // Fetch transfers + locations first. Products are paginated below so archived /
  // inactive items still resolve a name (otherwise the row shows "Unknown product").
  const [transfersRes, locationsRes] = await Promise.all([
    apiRequest<unknown>('/trpc/inventory.transfers?input=' + encodeURIComponent(JSON.stringify({})), {
      method: 'GET',
      cookie,
    }),
    apiRequest<unknown>(
      '/trpc/logistics.locationOptions?input=' + encodeURIComponent(JSON.stringify({})),
      { method: 'GET', cookie },
    ),
  ]);

  // Walk every page of products.list (max 100 per call). Without this, transfers
  // referencing the 101st+ product (or any INACTIVE / ARCHIVED one) silently fall
  // through to "Unknown product" because the previous fetch was capped + ACTIVE-only.
  type ProductRow = { id: string; name: string };
  const products: ProductRow[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await apiRequest<unknown>(
      '/trpc/products.list?input=' + encodeURIComponent(JSON.stringify({ page, limit: 100 })),
      { method: 'GET', cookie },
    );
    if (!res.ok) break;
    const pageRows =
      (res.data as { result?: { data?: { products?: ProductRow[] } } })?.result?.data?.products ?? [];
    if (pageRows.length === 0) break;
    products.push(...pageRows);
    if (pageRows.length < 100) break;
  }

  const transfersRaw = transfersRes.ok
    ? (transfersRes.data as { result?: { data?: { transfers?: TransferConfirmationRecord[] } | TransferConfirmationRecord[] } })?.result?.data
    : null;
  const transfers: TransferConfirmationRecord[] = Array.isArray(transfersRaw)
    ? transfersRaw
    : (transfersRaw?.transfers ?? []);
  const locations =
    locationsRes.ok
      ? (
          (locationsRes.data as { result?: { data?: Array<{ id: string; name: string; providerName?: string | null }> | { locations?: Array<{ id: string; name: string; providerName?: string | null }> } } })
            ?.result?.data ?? []
        )
        : [];
  // Normalize: listLocationOptions returns Array directly; listLocations wraps in { locations }
  const locationsList: Array<{ id: string; name: string; providerName: string | null }> = (
    Array.isArray(locations)
      ? locations
      : (locations as { locations?: Array<{ id: string; name: string; providerName?: string | null }> }).locations ?? []
  ).map((l) => ({ id: l.id, name: l.name, providerName: l.providerName ?? null }));

  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const locationMap = new Map(locationsList.map((l) => [l.id, l.name]));
  const providerMap = new Map(locationsList.map((l) => [l.id, l.providerName]));

  type TransferRow = typeof transfers[number] & {
    fromLocationName?: string | null;
    toLocationName?: string | null;
    fromProviderName?: string | null;
    toProviderName?: string | null;
    senderName?: string | null;
  };
  const records = transfers.map((t: TransferRow) => ({
    ...t,
    productName: productMap.get(t.productId) ?? 'Unknown product',
    // Prefer server-side names (joined in listTransfers), fall back to client-side lookup
    fromLocationName: t.fromLocationName ?? locationMap.get(t.fromLocationId) ?? 'Unknown location',
    toLocationName: t.toLocationName ?? locationMap.get(t.toLocationId) ?? 'Unknown location',
    fromProviderName: t.fromProviderName ?? providerMap.get(t.fromLocationId) ?? null,
    toProviderName: t.toProviderName ?? providerMap.get(t.toLocationId) ?? null,
    senderName: t.senderName ?? null,
  }));

  const statusWhitelist = new Set(['IN_TRANSIT', 'RECEIVED', 'DISPUTED']);
  const normalizedStatus = statusWhitelist.has(status) ? status : '';

  // Date + non-status filters — applied to both stats and table rows.
  const dateAndFieldFiltered = records.filter((r) => {
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

  // Status filter is only for the table — stats always show all-status counts.
  const filteredRemittances = normalizedStatus
    ? dateAndFieldFiltered.filter((r) => r.transferStatus === normalizedStatus)
    : dateAndFieldFiltered;

  const senderOptions = Array.from(
    new Set(
      records
        .map((r) => r.senderName)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));

    return {
      remittances: filteredRemittances,
      allRemittances: dateAndFieldFiltered,
      locations: locationsList,
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
  })();

  return defer({ pageData });
}


export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'markTransferReceived') {
    await requirePermission(request, ['logistics.write', 'inventory.verifyTransfer']);
    const transferId = formData.get('transferId')?.toString();
    const quantityReceived = parseInt(formData.get('quantityReceived')?.toString() ?? '0', 10);
    const shrinkageReason = formData.get('shrinkageReason')?.toString()?.trim() || undefined;
    const receiverNotes = formData.get('receiverNotes')?.toString()?.trim() || undefined;

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
        ...(receiverNotes && { receiverNotes }),
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
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<LogisticsRemittancesLoadingShell />}>
      <Await resolve={pageData}>
        {(data) => (
          <RemittancesAdminPage
            remittances={data.remittances}
            allRemittances={data.allRemittances}
            locations={data.locations ?? []}
            senderOptions={data.senderOptions ?? []}
            filters={data.filters}
          />
        )}
      </Await>
    </Suspense>
  );
}
