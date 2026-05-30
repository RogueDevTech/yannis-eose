import { json, type LoaderFunctionArgs, type MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { ProfitByShipmentPage, type ProfitByShipmentPayload, type ShipmentOption } from '~/features/finance/ProfitByShipmentPage';

export const meta: MetaFunction = () => [{ title: 'Profit by shipment — Finance — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'finance.read');
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const shipmentId = url.searchParams.get('shipmentId') || '';

  // Picker list: most-recent shipments first. We only need {id, label, status}
  // for the dropdown — full P&L is fetched on demand for the selected one.
  const shipmentsRes = await apiRequest<unknown>(
    `/trpc/inventory.shipments.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100 }))}`,
    { method: 'GET', cookie },
  );
  const shipmentRows =
    shipmentsRes.ok
      ? ((shipmentsRes.data as {
          result?: {
            data?: {
              rows?: Array<{
                id: string;
                referenceNumber: string;
                label: string | null;
                status: string;
                arrivedAt: string | null;
                createdAt: string;
              }>;
            };
          };
        })?.result?.data?.rows ?? [])
      : [];
  const shipments: ShipmentOption[] = shipmentRows.map((r) => ({
    id: r.id,
    referenceNumber: r.referenceNumber,
    label: r.label ?? null,
    status: r.status,
    arrivedAt: r.arrivedAt,
    createdAt: r.createdAt,
  }));

  let profit: ProfitByShipmentPayload | null = null;
  if (shipmentId) {
    const profitRes = await apiRequest<unknown>(
      `/trpc/finance.profitByShipment?input=${encodeURIComponent(JSON.stringify({ shipmentId }))}`,
      { method: 'GET', cookie },
    );
    if (profitRes.ok) {
      profit =
        (profitRes.data as { result?: { data?: ProfitByShipmentPayload } })?.result?.data ?? null;
    }
  }

  return json({ shipments, shipmentId, profit });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function ProfitByShipmentRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <ProfitByShipmentPage
      shipments={data.shipments}
      shipmentId={data.shipmentId}
      profit={data.profit}
    />
  );
}
