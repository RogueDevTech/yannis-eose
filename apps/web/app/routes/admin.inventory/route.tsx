import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { usePageRefreshOnEvent } from '~/hooks/useSocket';
import { InventoryPage } from '~/features/inventory/InventoryPage';
import type { InventoryLevel, StockMovement, InventoryStreamData, ProductOption, LocationOption } from '~/features/inventory/types';

export const meta: MetaFunction = () => [
  { title: 'Inventory — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  // Heads (HoM, HoCS) get inventory visibility by role so they can see stock levels
  // when planning campaigns / CS priorities, even without the inventory.read permission.
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'HEAD_OF_CS'],
    permission: 'inventory.read',
  });
  const cookie = getSessionCookie(request);

  // Start fetches concurrently
  const levelsPromise = apiRequest<unknown>('/trpc/inventory.levels', { method: 'GET', cookie });
  const movementsPromise = apiRequest<unknown>('/trpc/inventory.movements', { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>(`/trpc/products.list?input=${encodeURIComponent(JSON.stringify({ limit: 20, status: 'ACTIVE' }))}`, { method: 'GET', cookie });
  const locationsPromise = apiRequest<unknown>(`/trpc/logistics.listLocations?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE', limit: 20 }))}`, { method: 'GET', cookie });

  // Await levels (critical for stats)
  const levelsRes = await levelsPromise;

  const levelsData = levelsRes.ok
    ? (levelsRes.data as { result?: { data?: { levels: InventoryLevel[]; pagination: { total: number } } } })?.result?.data
    : null;

  // Await movements data
  const movementsData = await movementsPromise.then((movementsRes) => {
    if (!movementsRes.ok) return { movements: [] as StockMovement[], total: 0 };
    const data = (movementsRes.data as { result?: { data?: { movements: StockMovement[]; pagination: { total: number } } } })?.result?.data;
    return { movements: data?.movements ?? [], total: data?.pagination?.total ?? 0 };
  }).catch(() => ({ movements: [] as StockMovement[], total: 0 }));

  // Products and locations for Stock Intake
  const [productsRes, locationsRes] = await Promise.all([productsPromise, locationsPromise]);

  let products: ProductOption[] = [];
  if (productsRes.ok) {
    const data = (productsRes.data as { result?: { data?: { products: { id: string; name: string }[] } } })?.result?.data;
    products = (data?.products ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  let locations: LocationOption[] = [];
  if (locationsRes.ok) {
    const data = (locationsRes.data as { result?: { data?: { locations: { id: string; name: string }[] } } })?.result?.data;
    locations = (data?.locations ?? []).map((l) => ({ id: l.id, name: l.name }));
  }

  return {
    levels: levelsData?.levels ?? [],
    totalLevels: levelsData?.pagination?.total ?? 0,
    movements: movementsData.movements,
    totalMovements: movementsData.total,
    products,
    locations,
    canIntake: user.permissions?.includes('inventory.intake') ?? false,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'inventory.intake');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'stockIntake') {
    const productId = formData.get('productId')?.toString() ?? '';
    const locationId = formData.get('locationId')?.toString() ?? '';
    const quantity = parseInt(formData.get('quantity')?.toString() ?? '0', 10);
    const factoryCost = formData.get('factoryCost')?.toString() ?? '';
    const landingCost = formData.get('landingCost')?.toString() ?? '0';

    if (!productId || !locationId || quantity < 1 || !factoryCost) {
      return json({ error: 'Product, location, quantity, and factory cost are required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/inventory.intake', {
      method: 'POST',
      cookie,
      body: {
        productId,
        locationId,
        quantity,
        factoryCost,
        landingCost: landingCost || '0',
      },
    });

    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to add stock' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function InventoryRoute() {
  const data = useLoaderData<typeof loader>() as InventoryStreamData;
  usePageRefreshOnEvent(['stock:updated', 'transfer:created']);
  return <InventoryPage {...data} />;
}
