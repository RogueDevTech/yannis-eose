import { json, redirect, defer } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader, invalidateCachedLoader } from '~/lib/loader-cache';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { respondToOfferTemplateIntent } from '~/lib/marketing-offer-template-actions.server';
import { userCanManageOfferTemplates } from '~/lib/marketing-offer-tier.server';
import { FormsPage } from '~/features/campaigns/CampaignsPage';
import { MarketingFormsLoadingShell } from '~/features/marketing/MarketingDeferredLoadingShells';
import type { Campaign, OfferTemplateListRow, OfferGroupRow, Product, FormsStreamData } from '~/features/campaigns/types';

function parseOfferListRows(payload: unknown): OfferTemplateListRow[] {
  const data = payload as { result?: { data?: { templates?: unknown[] } } } | null;
  const raw = data?.result?.data?.templates ?? [];
  const out: OfferTemplateListRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = r.id != null ? String(r.id) : '';
    const productId = r.productId != null ? String(r.productId) : '';
    const productName = r.productName != null ? String(r.productName) : '';
    const name = r.name != null ? String(r.name) : '';
    if (!id || !productId || !name) continue;
    const qtyRaw = r.quantity;
    const quantity =
      typeof qtyRaw === 'number' && Number.isFinite(qtyRaw)
        ? qtyRaw
        : parseInt(String(qtyRaw ?? '1'), 10) || 1;
    const priceRaw = r.price;
    const price: string | number =
      typeof priceRaw === 'number' && Number.isFinite(priceRaw)
        ? priceRaw
        : typeof priceRaw === 'string'
          ? priceRaw
          : String(priceRaw ?? '0');
    const status = r.status != null ? String(r.status) : 'ACTIVE';
    const imgsRaw = r.imageUrls ?? r.image_urls;
    const imageUrls = Array.isArray(imgsRaw)
      ? imgsRaw.filter((u): u is string => typeof u === 'string')
      : [];
    out.push({ id, productId, productName, name, quantity, price, status, imageUrls });
  }
  return out;
}

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
            quantity: typeof rr.quantity === 'number' ? rr.quantity : parseInt(String(rr.quantity ?? '1'), 10) || 1,
            price: rr.price != null ? (typeof rr.price === 'number' ? rr.price : String(rr.price)) : '0',
            imageUrl: rr.imageUrl != null ? String(rr.imageUrl) : null,
            sortOrder: typeof rr.sortOrder === 'number' ? rr.sortOrder : parseInt(String(rr.sortOrder ?? '0'), 10) || 0,
            status: rr.status != null ? String(rr.status) : 'ACTIVE',
          }))
          .filter((it) => it.id && it.productId && it.label)
      : [];
    out.push({ id, name, status, createdBy, createdAt, updatedAt, items });
  }
  return out;
}

export const meta: MetaFunction = ({ location }) => {
  const tab = new URLSearchParams(location.search).get('tab');
  const title =
    tab === 'offers' ? 'Offers — Yannis EOSE' : tab === 'mine' ? 'My forms — Yannis EOSE' : 'Forms — Yannis EOSE';
  return [{ title }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const cookie = getSessionCookie(request);
  const url = new URL(request.url);
  const tab = url.searchParams.get('tab');
  const isOffersTab = tab === 'offers';

  // Offers management moved to Products → Offers.
  if (isOffersTab) {
    await requirePermission(request, 'products.offers');
    const dest = new URL('/admin/products', url.origin);
    dest.searchParams.set('tab', 'offers');
    return redirect(dest.pathname + dest.search);
  }

  const user = await requirePermission(request, 'marketing.campaigns');

  // Marketing team supervisor on the active branch sees their team's forms
  // (server-side `applyMarketingSupervisorScope` injects `mediaBuyerIds = team`
  // when no explicit buyer filter). Auto-pinning to self would override that
  // and limit them to their own forms only — drop it for supervisors.
  const isMarketingSupervisor =
    user.role === 'MEDIA_BUYER' && user.isMarketingTeamSupervisorOnActiveBranch === true;
  const isMediaBuyer = user.role === 'MEDIA_BUYER' && !isMarketingSupervisor;
  const mediaBuyerId = isMediaBuyer ? user.id : undefined;

  const listInput = {
    page: 1,
    limit: 20,
    ...(mediaBuyerId && { mediaBuyerId }),
  };
  const listInputStr = encodeURIComponent(JSON.stringify(listInput));

  const formsShell = {
    isMediaBuyer,
    showMediaBuyerColumn:
      user.role === 'HEAD_OF_MARKETING' ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      isMarketingSupervisor,
    currentUserId: user.id,
    currentUserName: user.name,
    canManageOfferTemplates: userCanManageOfferTemplates(user),
  };

  const pageData = (async () => {
  // Forms list + the product catalog that powers the "Filter by product" picker.
  const [formsRes, productsRes] = await Promise.all([
    apiRequest<unknown>(`/trpc/marketing.listCampaigns?input=${listInputStr}`, {
      method: 'GET',
      cookie,
    }),
    apiRequest<unknown>(
      `/trpc/products.options?input=${encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  const resultData = formsRes.ok ? (formsRes.data as { result?: { data?: { campaigns: Campaign[]; pagination: { total: number } } } })?.result?.data : null;
  const formsData = resultData ?? null;

  const productOptionsRaw = productsRes.ok
    ? ((productsRes.data as { result?: { data?: Array<{ id: string; name: string }> } })?.result?.data ?? [])
    : [];
  const products: Product[] = productOptionsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    baseSalePrice: '0',
  }));

  return {
    forms: formsData?.campaigns ?? [],
    totalForms: formsData?.pagination?.total ?? 0,
    products,
    productsLoadError: productsRes.ok ? null : 'Could not load products for the filter.',
    allOfferTemplates: [] as OfferTemplateListRow[],
    offersListLoadError: null,
    offerGroups: [] as OfferGroupRow[],
    offerGroupsLoadError: null,
  } satisfies Pick<
    FormsStreamData,
    | 'forms'
    | 'totalForms'
    | 'products'
    | 'productsLoadError'
    | 'allOfferTemplates'
    | 'offersListLoadError'
    | 'offerGroups'
    | 'offerGroupsLoadError'
  >;
  })();

  return defer({ formsShell, pageData });
}

// A form was just created when the create flow redirects here with `?saved=1`.
// Drop any stale cached forms-list data first so the new form is in the very
// first paint — not only after the background revalidate lands.
export const clientLoader: typeof cachedClientLoader = (args) => {
  if (new URL(args.request.url).searchParams.get('saved') === '1') {
    invalidateCachedLoader('/admin/marketing/forms');
  }
  return cachedClientLoader(args);
};
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (
    intent === 'createOfferTemplate' ||
    intent === 'updateOfferTemplate' ||
    intent === 'archiveAllOfferTemplates'
  ) {
    await requirePermission(request, 'products.offers');
    if (!cookie) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tierResp = await respondToOfferTemplateIntent({
      intent,
      formData,
      cookie,
      unauthorizedRedirect: '/admin/marketing/forms',
    });
    if (tierResp) return tierResp;
  }

  /** Status-only updates from the list (deactivate / archive / activate). Must not send a partial formConfig. */
  if (intent === 'updateFormStatus') {
    await requirePermission(request, 'marketing.campaigns');
    const id = formData.get('id')?.toString() ?? '';
    const status = formData.get('status')?.toString() || undefined;
    if (!id || !status) {
      return json({ error: 'Missing id or status' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/marketing.updateCampaign', {
      method: 'POST',
      cookie,
      body: { id, status },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update status') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FormsIndexRoute() {
  const { formsShell, pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<MarketingFormsLoadingShell isMediaBuyer={formsShell.isMediaBuyer} />}
      loaderShell={{ formsShell }}
      deferredKey="pageData"
    >
      {(stream) => (
          <FormsPage
            forms={stream.forms}
            totalForms={stream.totalForms}
            products={stream.products}
            productsLoadError={stream.productsLoadError}
            allOfferTemplates={stream.allOfferTemplates}
            offersListLoadError={stream.offersListLoadError}
            offerGroups={stream.offerGroups}
            offerGroupsLoadError={stream.offerGroupsLoadError}
            isMediaBuyer={formsShell.isMediaBuyer}
            showMediaBuyerColumn={formsShell.showMediaBuyerColumn}
            currentUserName={formsShell.currentUserName}
            currentUserId={formsShell.currentUserId}
            canManageOfferTemplates={formsShell.canManageOfferTemplates}
          />
        )}
    </CachedAwait>
  );
}
