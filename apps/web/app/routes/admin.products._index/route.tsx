import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import * as React from 'react';
import { Await, Link, useFetcher, useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { isSuperAdminOnly } from '~/lib/rbac';
import { extractApiErrorMessage } from '~/lib/api-error';
import { describeApiFetchFailure } from '~/lib/loader-api-fetch';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Button } from '~/components/ui/button';
import { MarketingOffersTab } from '~/features/campaigns/MarketingOffersTab';
import { OfferGroupCreateModal } from '~/features/campaigns/OfferGroupCreateModal';
import { ProductsListPage } from '~/features/products/ProductsListPage';
import { ProductsHubLoadingShell } from '~/features/products/ProductsDeferredLoadingShells';
import type { Product } from '~/features/products/types';
import type { OfferGroupRow } from '~/features/campaigns/types';

type ResolvedProductsList = {
  products: Product[];
  total: number;
  page: number;
  totalPages: number;
  loadError: string | null;
};

type ResolvedOffersSummary = {
  offersProducts: Product[];
  productsLoadError: string | null;
  offerGroups: OfferGroupRow[];
  offerGroupsLoadError: string | null;
};

type OffersSummaryApiOk = { ok: true } & ResolvedOffersSummary;
type OffersSummaryApiErr = { ok: false; error: string } & ResolvedOffersSummary;
type OffersSummaryApiResponse = OffersSummaryApiOk | OffersSummaryApiErr;

type ProductsLoaderData = {
  /** URL tab hint for direct-link SSR; UI switching is client-side. */
  initialTab: 'product' | 'offers';
  pageData: Promise<{ products: ResolvedProductsList; offerGroupsCount: number }>;
  canEditProduct: boolean;
  canCreateProduct: boolean;
  canInstantArchiveProduct: boolean;
  canManageOffers: boolean;
};

export const meta: MetaFunction = () => [
  { title: 'Products — Yannis EOSE' },
];

function parseOfferGroups(payload: unknown): OfferGroupRow[] {
  const data = payload as { result?: { data?: { groups?: unknown[] } } } | null;
  const raw = data?.result?.data?.groups ?? [];
  const out: OfferGroupRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = r.id != null ? String(r.id) : '';
    const name = r.name != null ? String(r.name) : '';
    if (!id || !name) continue;
    const status = r.status != null ? String(r.status) : 'ACTIVE';
    const createdBy = r.createdBy != null ? String(r.createdBy) : '';
    const createdAt = r.createdAt != null ? String(r.createdAt) : '';
    const updatedAt = r.updatedAt != null ? String(r.updatedAt) : '';
    const itemsRaw = r.items;
    const items = Array.isArray(itemsRaw)
      ? itemsRaw
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((rr) => ({
            id: rr.id != null ? String(rr.id) : '',
            offerGroupId: rr.offerGroupId != null ? String(rr.offerGroupId) : id,
            productId: rr.productId != null ? String(rr.productId) : '',
            productName: rr.productName != null ? String(rr.productName) : '',
            label: rr.label != null ? String(rr.label) : '',
            quantity:
              typeof rr.quantity === 'number'
                ? rr.quantity
                : parseInt(String(rr.quantity ?? '1'), 10) || 1,
            price: rr.price != null ? (typeof rr.price === 'number' ? rr.price : String(rr.price)) : '0',
            imageUrl: rr.imageUrl != null ? String(rr.imageUrl) : null,
            sortOrder:
              typeof rr.sortOrder === 'number'
                ? rr.sortOrder
                : parseInt(String(rr.sortOrder ?? '0'), 10) || 0,
            status: rr.status != null ? String(rr.status) : 'ACTIVE',
          }))
          .filter((it) => it.id && it.productId && it.label)
      : [];
    out.push({ id, name, status, createdBy, createdAt, updatedAt, items });
  }
  return out;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const initialTab = url.searchParams.get('tab') === 'offers' ? 'offers' : 'product';

  const user = await requirePermission(request, 'products.read');
  const cookie = getSessionCookie(request);

  const permSet = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  const canEditProduct =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    permSet.has(canonicalPermissionCode('products.update'));
  const canCreateProduct =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    permSet.has(canonicalPermissionCode('products.create'));
  const canInstantArchiveProduct = isSuperAdminOnly(user);

  const canManageOffers =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'ADMIN' ||
    permSet.has(canonicalPermissionCode('products.offers'));

  const pageParam = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const input = { page, limit: 20, sortBy: 'createdAt' as const, sortOrder: 'desc' as const };
  const productsPromise = apiRequest<unknown>(
    `/trpc/products.list?input=${encodeURIComponent(JSON.stringify(input))}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) {
        return {
          products: [] as Product[],
          total: 0,
          page,
          totalPages: 0,
          loadError: describeApiFetchFailure('Products', res),
        };
      }
      const trpcData = res.data as {
        result?: { data?: { products: Product[]; pagination: { total: number; page: number; totalPages: number } } };
      };
      const data = trpcData?.result?.data;
      return {
        products: data?.products ?? [],
        total: data?.pagination?.total ?? 0,
        page: data?.pagination?.page ?? page,
        totalPages: data?.pagination?.totalPages ?? 0,
        loadError: null as string | null,
      };
    })
    .catch(() => ({
      products: [] as Product[],
      total: 0,
      page,
      totalPages: 0,
      loadError: 'Products could not be loaded. Try Reload data.',
    }));

  const offerGroupsCountPromise = canManageOffers
    ? apiRequest<unknown>(
        `/trpc/marketing.listOfferGroups?input=${encodeURIComponent(
          JSON.stringify({ page: 1, limit: 1, status: 'ACTIVE' }),
        )}`,
        { method: 'GET', cookie },
      )
        .then((res) => {
          if (!res.ok) return 0;
          const total =
            (res.data as { result?: { data?: { pagination?: { total?: number } } } })?.result?.data?.pagination
              ?.total;
          return typeof total === 'number' && Number.isFinite(total) ? total : 0;
        })
        .catch(() => 0)
    : Promise.resolve(0);

  const pageData = Promise.all([productsPromise, offerGroupsCountPromise] as const).then(
    ([products, offerGroupsCount]) => ({ products, offerGroupsCount }),
  );

  return defer({
    initialTab,
    pageData,
    canEditProduct,
    canCreateProduct,
    canInstantArchiveProduct,
    canManageOffers,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createOfferGroup') {
    await requirePermission(request, 'products.offers');
    const name = formData.get('offerGroupName')?.toString()?.trim() ?? '';
    if (!name) return json({ error: 'Offer name is required' }, { status: 400 });

    const productId = formData.get('productId')?.toString() ?? '';
    if (!productId) return json({ error: 'Product is required' }, { status: 400 });

    let items: unknown[] = [];
    try {
      const raw = JSON.parse(formData.get('itemsJson')?.toString() ?? '[]');
      items = Array.isArray(raw) ? raw : [];
    } catch {
      return json({ error: 'Invalid items JSON' }, { status: 400 });
    }

    const bodyItems = items
      .map((it, idx) => {
        const r = it && typeof it === 'object' ? (it as Record<string, unknown>) : {};
        const label = r.label != null ? String(r.label).trim() : '';
        const quantityRaw = r.quantity;
        const quantity =
          typeof quantityRaw === 'number' && Number.isFinite(quantityRaw)
            ? quantityRaw
            : parseInt(String(quantityRaw ?? '1'), 10) || 1;
        const priceRaw = r.price;
        const price =
          typeof priceRaw === 'number' && Number.isFinite(priceRaw)
            ? priceRaw
            : Number(String(priceRaw ?? '0').replace(/,/g, '').trim());
        const imageUrl = r.imageUrl != null ? String(r.imageUrl) : undefined;
        return { productId, label, quantity, price, imageUrl, sortOrder: idx };
      })
      .filter((it) => it.label.length > 0);

    if (bodyItems.length === 0) {
      return json({ error: 'Add at least one offer item' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/marketing.createOfferGroup', {
      method: 'POST',
      cookie,
      body: { name, items: bodyItems },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to create offer') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'clearLegacyOffers') {
    await requirePermission(request, 'products.offers');
    const res = await apiRequest<unknown>('/trpc/marketing.clearLegacyOfferTemplates', {
      method: 'POST',
      cookie,
      body: { detachCampaigns: true },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to clear legacy offers') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'archiveProduct') {
    const id = formData.get('id')?.toString() ?? '';
    const reason = formData.get('reason')?.toString().trim() ?? '';
    if (!id) return json({ error: 'Product id required' }, { status: 400 });
    if (reason.length < 10) {
      return json({ error: 'A reason of at least 10 characters is required' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/products.requestArchive', {
      method: 'POST',
      cookie,
      body: { productId: id, reason },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to archive product') },
        { status: safeStatus(res.status) },
      );
    }
    const data = (res.data as { result?: { data?: { requiresApproval?: boolean; message?: string } } })?.result
      ?.data;
    return json({
      success: true,
      requiresApproval: data?.requiresApproval === true,
      message: typeof data?.message === 'string' ? data.message : null,
    });
  }

  if (intent === 'archiveOfferGroup') {
    await requirePermission(request, 'products.offers');
    const id = formData.get('id')?.toString() ?? '';
    if (!id) return json({ error: 'Offer id required' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/marketing.updateOfferGroup', {
      method: 'POST',
      cookie,
      body: { id, status: 'ARCHIVED' },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to archive offer') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

function ProductsRouteInner(
  data: Omit<ProductsLoaderData, 'pageData'> & {
    products: ResolvedProductsList;
    offerGroupsCount: number;
  },
) {
  const [uiTab, setUiTab] = React.useState<'product' | 'offers'>(data.initialTab);
  const [showCreateOffer, setShowCreateOffer] = React.useState(false);

  const offersFetcher = useFetcher<OffersSummaryApiResponse>();
  const offersFetchStartedRef = React.useRef(false);
  const [offersCache, setOffersCache] = React.useState<ResolvedOffersSummary>(() => ({
    offersProducts: [],
    productsLoadError: null,
    offerGroups: [],
    offerGroupsLoadError: null,
  }));
  const [offersLoaded, setOffersLoaded] = React.useState(false);

  const setTabInstant = React.useCallback((next: 'product' | 'offers') => {
    setUiTab(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === 'offers') url.searchParams.set('tab', 'offers');
    else url.searchParams.delete('tab');
    window.history.replaceState({}, '', url.pathname + url.search);
  }, []);

  const startOffersSummaryFetch = React.useCallback(() => {
    if (!data.canManageOffers) return;
    if (offersLoaded) return;
    if (offersFetchStartedRef.current) return;
    offersFetchStartedRef.current = true;
    offersFetcher.load('/api/products-offers-summary');
  }, [data.canManageOffers, offersLoaded, offersFetcher]);

  // Lazy-load offers content on first switch (no Remix navigation).
  React.useEffect(() => {
    if (uiTab !== 'offers') return;
    startOffersSummaryFetch();
  }, [uiTab, startOffersSummaryFetch]);

  // Ensure the Create Offer modal can load products even if the user
  // opens it from the Product tab before ever switching to Offers.
  React.useEffect(() => {
    if (!showCreateOffer) return;
    startOffersSummaryFetch();
  }, [showCreateOffer, startOffersSummaryFetch]);

  React.useEffect(() => {
    if (!offersFetcher.data) return;
    if (offersFetcher.data.ok) {
      setOffersCache(offersFetcher.data);
      setOffersLoaded(true);
      return;
    }
    setOffersCache({
      offersProducts: offersFetcher.data.offersProducts,
      productsLoadError: offersFetcher.data.productsLoadError ?? offersFetcher.data.error ?? 'Offers could not be loaded.',
      offerGroups: offersFetcher.data.offerGroups,
      offerGroupsLoadError: offersFetcher.data.offerGroupsLoadError ?? offersFetcher.data.error ?? 'Offers could not be loaded.',
    });
    setOffersLoaded(true);
  }, [offersFetcher.data]);

  // Back/forward should switch the UI tab instantly too.
  React.useEffect(() => {
    const onPopState = () => {
      const url = new URL(window.location.href);
      const next = url.searchParams.get('tab') === 'offers' ? 'offers' : 'product';
      setUiTab(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const resolved = data.products;
  const offersCount = data.offerGroupsCount;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        description="Manage products and reusable offer packages."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            {data.canManageOffers ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  startOffersSummaryFetch();
                  setShowCreateOffer(true);
                }}
              >
                + Create offer
              </Button>
            ) : null}
            {data.canCreateProduct ? (
              <Link to="/admin/products/new" prefetch="intent">
                <Button variant="primary" size="sm">
                  + Add product
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Products', value: resolved.total, valueClassName: 'text-app-fg' },
          {
            label: 'Active',
            value: resolved.products.filter((p) => p.status === 'ACTIVE').length,
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'Categories',
            value: new Set(resolved.products.map((p) => p.category).filter(Boolean)).size,
            valueClassName: 'text-app-fg',
          },
          { label: 'Offers available', value: offersCount, valueClassName: 'text-app-fg' },
        ]}
      />

      <Tabs
        value={uiTab}
        onChange={(v) => setTabInstant(v as 'product' | 'offers')}
        tabs={[
          { value: 'product', label: 'Product' },
          ...(data.canManageOffers ? [{ value: 'offers', label: 'Offers' }] : []),
        ]}
      />

      {data.canManageOffers ? (
        <div className="space-y-4">
          <OfferGroupCreateModal
            open={showCreateOffer}
            onClose={() => setShowCreateOffer(false)}
            products={offersLoaded ? offersCache.offersProducts : []}
            productsLoading={!offersLoaded && offersFetcher.state !== 'idle'}
            actionUrl="/admin/products?index"
            onCreated={() => {
              setOffersLoaded(false);
              offersFetchStartedRef.current = false;
              offersFetcher.load('/api/products-offers-summary');
            }}
          />

          {uiTab === 'offers' ? (
            <MarketingOffersTab
              products={offersCache.offersProducts}
              offerGroups={offersCache.offerGroups}
              offerGroupsLoadError={offersCache.offerGroupsLoadError}
              canManageOfferTemplates={true}
              offersLoading={!offersLoaded}
            />
          ) : null}
        </div>
      ) : null}

      {uiTab === 'product' ? (
        <ProductsListPage
          products={resolved.products}
          total={resolved.total}
          page={resolved.page}
          totalPages={resolved.totalPages}
          productsLoadError={resolved.loadError}
          canEditProduct={data.canEditProduct}
          canCreateProduct={data.canCreateProduct}
          canInstantArchiveProduct={data.canInstantArchiveProduct}
        />
      ) : null}
    </div>
  );
}

export default function ProductsRoute() {
  const data = useLoaderData<ProductsLoaderData>();
  return (
    <React.Suspense fallback={<ProductsHubLoadingShell initialTab={data.initialTab} />}>
      <Await resolve={data.pageData}>
        {({ products, offerGroupsCount }) => (
          <ProductsRouteInner
            initialTab={data.initialTab}
            canEditProduct={data.canEditProduct}
            canCreateProduct={data.canCreateProduct}
            canInstantArchiveProduct={data.canInstantArchiveProduct}
            canManageOffers={data.canManageOffers}
            products={products}
            offerGroupsCount={offerGroupsCount}
          />
        )}
      </Await>
    </React.Suspense>
  );
}
