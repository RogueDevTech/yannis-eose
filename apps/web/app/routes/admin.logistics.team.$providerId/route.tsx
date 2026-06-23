
import { Await, useLoaderData } from '@remix-run/react';
import type { ShouldRevalidateFunctionArgs } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { redirect, defer } from '@remix-run/node';
import {
  apiRequest,
  getSessionCookie,
  requirePermissionOrRoles,
  redirectIfUnauthorized,
  parsePerPage,
} from '~/lib/api.server';
import { LogisticsProviderDetailPage } from '~/features/logistics/LogisticsProviderDetailPage';
import { LogisticsProviderDetailLoadingShell } from '~/features/logistics/LogisticsDeferredLoadingShells';
import type { LogisticsProviderDetailRecord, LogisticsProviderRow } from '~/features/logistics/team-types';
import type { Location } from '~/features/logistics/types';
import type { StockMovement } from '~/features/inventory/types';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseProvidersList(res: { ok: boolean; status: number; data: unknown }): LogisticsProviderRow[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const result = raw.result as { data?: LogisticsProviderRow[] } | undefined;
  const data = result?.data;
  return Array.isArray(data) ? data : [];
}

function parseProvider(res: { ok: boolean; data: unknown }): LogisticsProviderDetailRecord | null {
  if (!res.ok) return null;
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || 'error' in raw) return null;
  const data = (raw.result as { data?: LogisticsProviderDetailRecord } | undefined)?.data;
  if (!data || typeof data.id !== 'string') return null;
  return data;
}

function parseLocations(res: { ok: boolean; data: unknown }): Location[] {
  if (!res.ok) return [];
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return [];
  const data = (raw.result as { data?: { locations: Location[] } } | undefined)?.data;
  return Array.isArray(data?.locations) ? data.locations : [];
}

interface ProviderMovementsData {
  movements: (StockMovement & { productName?: string | null })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  inQty: number;
  outQty: number;
  deliveredQty: number;
  products: { id: string; name: string }[];
}

function parseProviderMovements(res: { ok: boolean; data: unknown }): ProviderMovementsData {
  const empty: ProviderMovementsData = {
    movements: [], total: 0, page: 1, limit: 40, totalPages: 1,
    inQty: 0, outQty: 0, deliveredQty: 0, products: [],
  };
  if (!res.ok) return empty;
  const raw = res.data as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return empty;
  const data = (raw.result as { data?: ProviderMovementsData } | undefined)?.data;
  if (!data) return empty;
  return {
    movements: Array.isArray(data.movements) ? data.movements : [],
    total: typeof data.total === 'number' ? data.total : 0,
    page: typeof data.page === 'number' ? data.page : 1,
    limit: typeof data.limit === 'number' ? data.limit : 40,
    totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
    inQty: typeof data.inQty === 'number' ? data.inQty : 0,
    outQty: typeof data.outQty === 'number' ? data.outQty : 0,
    deliveredQty: typeof data.deliveredQty === 'number' ? data.deliveredQty : 0,
    products: Array.isArray(data.products) ? data.products : [],
  };
}

function buildTeamListHref(url: URL): string {
  // If we came from the partners page, go back there.
  if (url.searchParams.get('from') === 'partners') return '/admin/logistics/partners';
  const sp = new URLSearchParams(url.searchParams);
  sp.delete('from');
  const qs = sp.toString();
  return qs ? `/admin/logistics/team?${qs}` : '/admin/logistics/team';
}

/** Skip loader when only `?tab=` changes — data is identical; instant tab UX. */
function normalizeSearchExcludingTab(search: string): string {
  const sp = new URLSearchParams(search);
  sp.delete('tab');
  const entries = [...sp.entries()].sort(([a], [b]) => a.localeCompare(b));
  return new URLSearchParams(entries).toString();
}

export function shouldRevalidate({ currentUrl, nextUrl }: ShouldRevalidateFunctionArgs): boolean {
  const cur = new URL(currentUrl);
  const nex = new URL(nextUrl);
  if (cur.pathname !== nex.pathname) return true;
  if (cur.pathname === nex.pathname && cur.search === nex.search) return true;
  if (normalizeSearchExcludingTab(cur.search) === normalizeSearchExcludingTab(nex.search)) {
    return false;
  }
  return true;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_LOGISTICS', 'STOCK_MANAGER'],
    permission: 'logistics.teamOverview',
  });
  const cookie = getSessionCookie(request);
  if (!cookie) throw new Response('Session cookie missing', { status: 401 });

  const providerId = params['providerId']?.trim() ?? '';
  if (!providerId || !UUID_RE.test(providerId)) {
    throw redirect('/admin/logistics/team');
  }

  const url = new URL(request.url);
  const backHref = buildTeamListHref(url);

  const logisticsProviderShell = { backHref };

  const pageData = (async () => {
    const movementsPage = Math.max(1, Number(url.searchParams.get('movementsPage') ?? '1') || 1);
    const { perPage: movementsPerPage } = parsePerPage(url.searchParams, { param: 'movementsPerPage' });
    const productFilter = url.searchParams.get('productId') ?? undefined;
    const locationFilter = url.searchParams.get('locationId') ?? undefined;
    const shipmentFilter = url.searchParams.get('shipmentId') ?? undefined;
    const startDate = url.searchParams.get('startDate') ?? undefined;
    const endDate = url.searchParams.get('endDate') ?? undefined;
    const periodAllTime = url.searchParams.get('periodAllTime') === 'true';

    const providerInput = encodeURIComponent(JSON.stringify({ providerId }));
    const locationsInput = encodeURIComponent(
      JSON.stringify({ providerId, page: 1, limit: 100 }),
    );
    const teamInputEnc = encodeURIComponent(JSON.stringify({
      ...(periodAllTime ? {} : {
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      }),
      ...(productFilter ? { productId: productFilter } : {}),
    }));
    const movementsInput = encodeURIComponent(
      JSON.stringify({
        providerId,
        page: movementsPage,
        limit: movementsPerPage,
        ...(productFilter ? { productId: productFilter } : {}),
        ...(locationFilter ? { locationId: locationFilter } : {}),
        ...(periodAllTime ? {} : {
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
        }),
      }),
    );

    const breakdownInput = encodeURIComponent(
      JSON.stringify({
        providerId,
        ...(shipmentFilter ? { shipmentId: shipmentFilter } : {}),
      }),
    );

    const shipmentsInput = encodeURIComponent(JSON.stringify({ providerId }));

    const [providerRes, locationsRes, teamRes, movementsRes, productBreakdownRes, locationBreakdownRes, shipmentsRes] = await Promise.all([
      apiRequest<unknown>(`/trpc/logistics.getProvider?input=${providerInput}`, { method: 'GET', cookie }),
      apiRequest<unknown>(`/trpc/logistics.listLocations?input=${locationsInput}`, { method: 'GET', cookie }),
      apiRequest<unknown>(
        `/trpc/logistics.teamOverview?input=${teamInputEnc}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/inventory.providerMovements?input=${movementsInput}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/inventory.providerProductBreakdown?input=${breakdownInput}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/inventory.providerLocationBreakdown?input=${breakdownInput}`,
        { method: 'GET', cookie },
      ),
      apiRequest<unknown>(
        `/trpc/inventory.providerShipments?input=${shipmentsInput}`,
        { method: 'GET', cookie },
      ),
    ]);

    redirectIfUnauthorized(providerRes, url.pathname);
    redirectIfUnauthorized(teamRes, url.pathname);

    const provider = parseProvider(providerRes);
    if (!provider) {
      throw new Response('Logistics company not found', { status: 404 });
    }

    const locations = parseLocations(locationsRes);
    const overviewRow =
      parseProvidersList(teamRes).find((p) => p.providerId === providerId) ?? null;

    const movementsData = parseProviderMovements(movementsRes);

    // Parse product breakdown
    const pbRaw = productBreakdownRes.ok
      ? ((productBreakdownRes.data as Record<string, unknown>)?.result as { data?: { productId: string; productName: string; received: number; sold: number; available: number; qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string }[] })?.data
      : null;
    const productBreakdown = Array.isArray(pbRaw) ? pbRaw : [];

    // Parse location breakdown
    type LocBreakdown = { locationId: string; locationName: string; available: number; received: number; sold: number; qtyRemitted: number; qtyPending: number; amountRemitted: string; amountPending: string };
    const lbRaw = locationBreakdownRes.ok
      ? ((locationBreakdownRes.data as Record<string, unknown>)?.result as { data?: LocBreakdown[] })?.data
      : null;
    const locationBreakdown = Array.isArray(lbRaw) ? lbRaw : [];

    // Parse shipments for dropdown
    type ShipmentOption = { id: string; referenceNumber: number; label: string | null; destinationName: string | null; verifiedAt: string | null };
    const shRaw = shipmentsRes.ok
      ? ((shipmentsRes.data as Record<string, unknown>)?.result as { data?: ShipmentOption[] })?.data
      : null;
    const shipments = Array.isArray(shRaw) ? shRaw : [];

    return {
      provider,
      locations,
      performance: overviewRow,
      backHref,
      movementsData,
      productFilter: productFilter ?? null,
      locationFilter: locationFilter ?? null,
      shipmentFilter: shipmentFilter ?? null,
      productBreakdown,
      locationBreakdown,
      shipments,
      dateFilters: {
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        periodAllTime,
      },
    };
  })();

  return defer({ logisticsProviderShell, pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export const meta: MetaFunction = () => [{ title: 'Logistics company — Yannis EOSE' }];

export default function LogisticsProviderDetailRoute() {
  const { logisticsProviderShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<LogisticsProviderDetailLoadingShell />}
      loaderShell={{ logisticsProviderShell }}
      deferredKey="pageData"
    >
        {(data) => (
          <LogisticsProviderDetailPage
            provider={data.provider}
            locations={data.locations}
            performance={data.performance}
            backHref={data.backHref}
            movementsData={data.movementsData}
            productFilter={data.productFilter}
            locationFilter={data.locationFilter}
            shipmentFilter={data.shipmentFilter}
            productBreakdown={data.productBreakdown}
            locationBreakdown={data.locationBreakdown}
            shipments={data.shipments}
            dateFilters={data.dateFilters}
          />
        )}
      </CachedAwait>
  );
}
