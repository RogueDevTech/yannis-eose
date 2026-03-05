import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useRouteLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { RemitPage } from '~/features/remittances/RemitPage';
import type {
  RemittanceRecord,
  DeliveryRemittanceRecord,
  DeliveryRemittanceEligibleOrder,
} from '~/features/remittances/RemitPage';

export const meta: MetaFunction = () => [
  { title: 'Remit to warehouse — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'logistics.remit');
  const cookie = getSessionCookie(request);

  const [remittancesRes, productsRes, locationsRes, deliveryRemittancesRes, eligibleOrdersRes] = await Promise.all([
    apiRequest<unknown>('/trpc/logistics.listRemittances?input=' + encodeURIComponent(JSON.stringify({ page: 1, limit: 50 })), { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/products.list?input=' + encodeURIComponent(JSON.stringify({ page: 1, limit: 500 })), { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/logistics.listLocations?input=' + encodeURIComponent(JSON.stringify({ page: 1, limit: 100, status: 'ACTIVE' })), { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/logistics.listDeliveryRemittances?input=' + encodeURIComponent(JSON.stringify({ page: 1, limit: 50 })), { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/logistics.listDeliveryRemittanceEligibleOrders', { method: 'GET', cookie }),
  ]);

  const remittancesData = remittancesRes.ok
    ? (remittancesRes.data as { result?: { data?: { records: RemittanceRecord[] } } })?.result?.data
    : null;
  const productsData = productsRes.ok
    ? (productsRes.data as { result?: { data?: { products: Array<{ id: string; name: string }> } } })?.result?.data
    : null;
  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Array<{ id: string; name: string }> } } })?.result?.data
    : null;
  const deliveryRemittancesData = deliveryRemittancesRes.ok
    ? (deliveryRemittancesRes.data as { result?: { data?: { records: DeliveryRemittanceRecord[] } } })?.result?.data
    : null;
  const eligibleOrdersData = eligibleOrdersRes.ok
    ? (eligibleOrdersRes.data as { result?: { data?: DeliveryRemittanceEligibleOrder[] } })?.result?.data
    : null;

  return {
    remittances: remittancesData?.records ?? [],
    products: productsData?.products ?? [],
    locations: locationsData?.locations ?? [],
    userLocationId: user.logisticsLocationId ?? null,
    deliveryRemittances: deliveryRemittancesData?.records ?? [],
    eligibleOrders: eligibleOrdersData ?? [],
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createRemittance') {
    await requirePermission(request, 'logistics.remit');
    const productId = formData.get('productId')?.toString();
    const toLocationId = formData.get('toLocationId')?.toString();
    const quantitySent = parseInt(formData.get('quantitySent')?.toString() ?? '0', 10);
    const receiptUrl = formData.get('receiptUrl')?.toString();

    if (!productId || !toLocationId || quantitySent < 1) {
      return json({ error: 'Product, destination location, and quantity are required' }, { status: 400 });
    }
    if (!receiptUrl || !receiptUrl.startsWith('http')) {
      return json({ error: 'Please upload a receipt image before submitting' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/logistics.createRemittance', {
      method: 'POST',
      cookie,
      body: {
        productId,
        toLocationId,
        quantitySent,
        receiptUrl,
      },
    });

    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to submit remittance';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'createDeliveryRemittance') {
    await requirePermission(request, 'logistics.remit');
    const orderIdsJson = formData.get('orderIds')?.toString();
    const receiptUrlsJson = formData.get('receiptUrls')?.toString();
    let orderIds: string[] = [];
    let receiptUrls: string[] = [];
    try {
      if (orderIdsJson) orderIds = JSON.parse(orderIdsJson) as string[];
      if (receiptUrlsJson) receiptUrls = JSON.parse(receiptUrlsJson) as string[];
    } catch {
      return json({ error: 'Invalid form data' }, { status: 400 });
    }
    if (orderIds.length === 0) {
      return json({ error: 'Select at least one delivered order' }, { status: 400 });
    }
    if (receiptUrls.length === 0) {
      return json({ error: 'Upload at least one payment receipt' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/logistics.createDeliveryRemittance', {
      method: 'POST',
      cookie,
      body: { orderIds, receiptUrls },
    });

    if (!res.ok) {
      const err = (res.data as { error?: { message?: string } })?.error?.message ?? 'Failed to submit delivery remittance';
      return json({ error: err }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TplRemitRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <RemitPage
      remittances={data.remittances}
      products={data.products}
      locations={data.locations}
      userLocationId={data.userLocationId}
      deliveryRemittances={data.deliveryRemittances}
      eligibleOrders={data.eligibleOrders}
    />
  );
}
