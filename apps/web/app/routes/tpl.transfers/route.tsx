import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { TransfersPage } from '~/features/transfers/TransfersPage';
import type { Transfer, Location, Product, InventoryLevel, TransfersStreamData } from '~/features/transfers/types';

export const meta: MetaFunction = () => [
  { title: 'Transfers — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: ['TPL_MANAGER', 'SUPER_ADMIN'], permission: 'transfers.read' });
  const cookie = getSessionCookie(request);

  const transfersPromise = apiRequest<unknown>('/trpc/inventory.transfers', { method: 'GET', cookie });
  const locationsPromise = apiRequest<unknown>('/trpc/logistics.listLocations', { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>('/trpc/products.list', { method: 'GET', cookie });
  const levelsPromise = apiRequest<unknown>('/trpc/inventory.levels', { method: 'GET', cookie });

  const [transfersRes, locationsRes] = await Promise.all([transfersPromise, locationsPromise]);

  const transfersData = transfersRes.ok
    ? (transfersRes.data as { result?: { data?: Transfer[] } })?.result?.data
    : null;
  const locationsData = locationsRes.ok
    ? (locationsRes.data as { result?: { data?: { locations: Location[] } } })?.result?.data
    : null;

  const products = productsPromise.then((res) => {
    if (!res.ok) return [] as Product[];
    return (res.data as { result?: { data?: { products: Product[] } } })?.result?.data?.products ?? [];
  }).catch(() => [] as Product[]);

  const levels = levelsPromise.then((res) => {
    if (!res.ok) return [] as InventoryLevel[];
    return (res.data as { result?: { data?: { levels: InventoryLevel[] } } })?.result?.data?.levels ?? [];
  }).catch(() => [] as InventoryLevel[]);

  return {
    transfers: transfersData ?? [],
    locations: locationsData?.locations ?? [],
    products,
    levels,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'verifyTransfer') {
    const quantityReceived = parseInt(formData.get('quantityReceived')?.toString() ?? '0', 10);
    const shrinkageReason = formData.get('shrinkageReason')?.toString() || undefined;

    const res = await apiRequest<unknown>('/trpc/inventory.verifyTransfer', {
      method: 'POST',
      cookie,
      body: {
        transferId: formData.get('transferId')?.toString() ?? '',
        quantityReceived,
        shrinkageReason,
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to verify transfer' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function TplTransfersRoute() {
  const data = useLoaderData<typeof loader>() as TransfersStreamData;
  return <TransfersPage {...data} />;
}
