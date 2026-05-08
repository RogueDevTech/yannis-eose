import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import {
  apiRequest,
  ensureBranchScopeOrRedirect,
  getSessionCookie,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { respondToOfferTemplateIntent } from '~/lib/marketing-offer-template-actions.server';
import { userCanManageOfferTemplates } from '~/lib/marketing-offer-tier.server';
import { MarketingFormEditPage } from '~/features/campaigns/MarketingFormEditPage';
import { parseCustomFieldsPayload } from '~/features/campaigns/parse-custom-fields.server';
import {
  parseAdditionalFieldSelectOptionsPayload,
  parseStandardFieldsPayload,
  toLegacyStandardFieldFlags,
} from '~/features/campaigns/standard-fields';
import type { Campaign, CampaignFormConfig, OfferGroupRow, Product } from '~/features/campaigns/types';
import type { MinimalOfferTemplateForPreview } from '~/features/campaigns/offer-template-preview';

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

function mapApiOfferTemplatesRow(api: Record<string, unknown>): MinimalOfferTemplateForPreview | null {
  const id = api.id != null ? String(api.id) : '';
  if (!id) return null;
  const qtyRaw = api.quantity ?? api.qty;
  const quantity = typeof qtyRaw === 'number' ? qtyRaw : parseInt(String(qtyRaw), 10) || 1;
  const imgsRaw = api.imageUrls ?? api.image_urls;
  const imageUrls = Array.isArray(imgsRaw)
    ? imgsRaw.filter((u): u is string => typeof u === 'string')
    : [];
  return {
    id,
    name: String(api.name ?? ''),
    quantity,
    price: String(api.price ?? '0'),
    status: String(api.status ?? 'ACTIVE'),
    imageUrls,
  };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.campaign?.name ? `Edit: ${data.campaign.name} — Yannis EOSE` : 'Edit form — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.campaigns');
  // Pre-flight branch picker safety net — see ensureBranchScopeOrRedirect docs.
  const guard = ensureBranchScopeOrRedirect(request, user, '/admin/marketing/forms');
  if (guard) return guard;
  const cookie = getSessionCookie(request);
  const id = params.id;
  if (!id) throw new Response('Missing form id', { status: 400 });

  const res = await apiRequest<{ result?: { data?: Campaign } }>(
    `/trpc/marketing.getCampaign?input=${encodeURIComponent(JSON.stringify({ id }))}`,
    { method: 'GET', cookie },
  );
  if (!res.ok || !res.data?.result?.data) {
    throw new Response('Form not found', { status: 404 });
  }
  const campaign = res.data.result.data;

  if (user.role === 'MEDIA_BUYER' && campaign.mediaBuyerId !== user.id) {
    throw new Response('Forbidden', { status: 403 });
  }

  const productsListInput = {
    page: 1,
    limit: 100,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
  };
  const productsInputStr = encodeURIComponent(JSON.stringify(productsListInput));
  const productsPromise = apiRequest<unknown>(`/trpc/products.list?input=${productsInputStr}`, { method: 'GET', cookie });

  let formProducts: Product[] = [];
  try {
    const productsRes = await productsPromise;
    if (productsRes.ok) {
      const productsData = (productsRes.data as { result?: { data?: { products: Product[] } } })?.result?.data;
      const all = productsData?.products ?? [];
      const ids = new Set((campaign.productIds ?? []).filter(Boolean));
      formProducts = all.filter((p) => ids.has(p.id));
    }
  } catch (err) {
    console.error('[admin.marketing.forms.$id.edit] products.list error', err);
  }

  const soleProductId =
    Array.isArray(campaign.productIds) && campaign.productIds.length > 0 ? String(campaign.productIds[0]) : '';

  let offerTemplates: MinimalOfferTemplateForPreview[] = [];
  if (soleProductId) {
    const tmplRes = await apiRequest<unknown>(
      `/trpc/marketing.listOfferTemplates?input=${encodeURIComponent(
        JSON.stringify({ productId: soleProductId, page: 1, limit: 100 }),
      )}`,
      { method: 'GET', cookie },
    );
    if (tmplRes.ok) {
      const td = tmplRes.data as { result?: { data?: { templates?: unknown[] } } };
      const raw = td?.result?.data?.templates ?? [];
      offerTemplates = raw
        .map((r) => mapApiOfferTemplatesRow(typeof r === 'object' && r ? (r as Record<string, unknown>) : {}))
        .filter((x): x is MinimalOfferTemplateForPreview => x != null);
    }
  }

  let offerGroups: OfferGroupRow[] = [];
  let offerGroupsLoadError: string | null = null;
  try {
    const offerGroupsRes = await apiRequest<unknown>(
      `/trpc/marketing.listOfferGroups?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 250 }))}`,
      { method: 'GET', cookie },
    );
    if (offerGroupsRes.ok) {
      offerGroups = parseOfferGroups(offerGroupsRes.data);
    } else {
      offerGroupsLoadError = extractApiErrorMessage(offerGroupsRes.data, 'Could not load offers. Try refreshing.');
    }
  } catch (err) {
    console.error('[admin.marketing.forms.$id.edit] listOfferGroups error', err);
    offerGroupsLoadError = 'Could not load offers. Try refreshing.';
  }

  return {
    campaign,
    formProducts,
    offerTemplates,
    offerGroups,
    offerGroupsLoadError,
    canManageOfferTemplates: userCanManageOfferTemplates(user),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermission(request, 'marketing.campaigns');
  const cookie = getSessionCookie(request);
  const id = params.id;
  if (!id) return json({ error: 'Missing form id' }, { status: 400 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  const tierIntent =
    intent === 'createOfferTemplate' ||
    intent === 'updateOfferTemplate' ||
    intent === 'archiveAllOfferTemplates';

  if (tierIntent) {
    await requirePermission(request, 'marketing.offerTemplate');
    if (!cookie) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const campRes = await apiRequest<{ result?: { data?: { productIds?: unknown } } }>(
      `/trpc/marketing.getCampaign?input=${encodeURIComponent(JSON.stringify({ id }))}`,
      { method: 'GET', cookie },
    );
    const rawIds = campRes.ok ? campRes.data?.result?.data?.productIds : undefined;
    const pids = Array.isArray(rawIds) ? rawIds : [];
    const soleProductId = pids.length > 0 && typeof pids[0] === 'string' ? pids[0] : '';
    if (!soleProductId) {
      return json({ error: 'This form has no catalog product to attach tiers to.' }, { status: 400 });
    }

    const tierResp = await respondToOfferTemplateIntent({
      intent,
      formData,
      cookie,
      enforceProductId: soleProductId,
      unauthorizedRedirect: `/admin/marketing/forms/${id}/edit`,
    });
    if (tierResp) return tierResp;
  }

  if (intent !== 'updateForm') {
    return json({ error: 'Unknown action' }, { status: 400 });
  }

  const name = formData.get('name')?.toString()?.trim() || undefined;
  const status = formData.get('status')?.toString() || undefined;

  const heading = formData.get('formHeading')?.toString()?.trim();
  const subtitle = formData.get('formSubtitle')?.toString()?.trim();
  const buttonText = formData.get('formButtonText')?.toString()?.trim();
  const accentColor = formData.get('formAccentColor')?.toString()?.trim();
  const successCallbackUrl = formData.get('successCallbackUrl')?.toString()?.trim() || undefined;
  const showProductImages = formData.get('showProductImages')?.toString() !== 'false';
  const offerGroupIdRaw = formData.get('offerGroupId')?.toString();
  const offerGroupId = offerGroupIdRaw && offerGroupIdRaw.trim().length > 0 ? offerGroupIdRaw.trim() : null;

  let selectedOfferTemplateIds: string[] = [];
  try {
    const selRaw = formData.get('selectedOfferTemplateIds')?.toString() ?? '[]';
    selectedOfferTemplateIds = JSON.parse(selRaw);
    if (
      !Array.isArray(selectedOfferTemplateIds) ||
      !selectedOfferTemplateIds.every((x) => typeof x === 'string')
    ) {
      return json({ error: 'Invalid offer-tier selection payload' }, { status: 400 });
    }
  } catch {
    return json({ error: 'Invalid offer-tier selection payload' }, { status: 400 });
  }
  const parsedStandard = parseStandardFieldsPayload(formData.get('standardFields')?.toString());
  if (!parsedStandard.ok) {
    return json({ error: parsedStandard.error }, { status: 400 });
  }

  const parsedSelectOpts = parseAdditionalFieldSelectOptionsPayload(
    formData.get('additionalFieldSelectOptions')?.toString(),
  );
  if (!parsedSelectOpts.ok) {
    return json({ error: parsedSelectOpts.error }, { status: 400 });
  }

  const parsedCustom = parseCustomFieldsPayload(formData.get('customFields')?.toString());
  if (!parsedCustom.ok) {
    return json({ error: parsedCustom.error }, { status: 400 });
  }

  const existingRes = await apiRequest<{ result?: { data?: Campaign } }>(
    `/trpc/marketing.getCampaign?input=${encodeURIComponent(JSON.stringify({ id }))}`,
    { method: 'GET', cookie },
  );
  const existingFormConfig: CampaignFormConfig =
    (existingRes.ok ? existingRes.data?.result?.data?.formConfig : null) as CampaignFormConfig ?? {};

  const formConfig: CampaignFormConfig = {
    ...existingFormConfig,
    ...(heading ? { heading } : {}),
    ...(buttonText ? { buttonText } : {}),
    ...(accentColor ? { accentColor } : {}),
    ...(successCallbackUrl ? { successCallbackUrl } : {}),
    showProductImages,
    standardFields: parsedStandard.fields,
    ...toLegacyStandardFieldFlags(parsedStandard.fields),
    customFields: parsedCustom.fields,
    deliveryStateOptions: parsedSelectOpts.options.deliveryStateOptions,
    preferredDeliveryDateOptions: parsedSelectOpts.options.preferredDeliveryDateOptions,
    genderOptions: parsedSelectOpts.options.genderOptions,
  };
  if (subtitle) {
    formConfig.subtitle = subtitle;
  } else {
    delete formConfig.subtitle;
  }
  if (selectedOfferTemplateIds.length > 0) {
    formConfig.selectedOfferTemplateIds = selectedOfferTemplateIds;
  } else {
    delete formConfig.selectedOfferTemplateIds;
  }
  if (offerGroupId) {
    // Offer groups supersede legacy tier selection.
    delete formConfig.selectedOfferTemplateIds;
  }

  const body: Record<string, unknown> = { id, formConfig, offerGroupId };
  if (name) body.name = name;
  if (status) body.status = status;

  const res = await apiRequest<unknown>('/trpc/marketing.updateCampaign', {
    method: 'POST',
    cookie,
    body,
  });
  if (!res.ok) {
    return json({ error: extractApiErrorMessage(res.data, 'Failed to update form') }, { status: safeStatus(res.status) });
  }
  // After a successful save, redirect to the forms list. `?saved=1` triggers
  // the list page's success toast.
  return redirect('/admin/marketing/forms?saved=1');
}

export default function MarketingFormEditRoute() {
  const { campaign, formProducts, offerTemplates, offerGroups, offerGroupsLoadError, canManageOfferTemplates } =
    useLoaderData<typeof loader>();
  return (
    <MarketingFormEditPage
      key={`${campaign.id}-${campaign.status}`}
      campaign={campaign}
      formProducts={formProducts}
      offerTemplates={offerTemplates}
      offerGroups={offerGroups}
      offerGroupsLoadError={offerGroupsLoadError}
      canManageOfferTemplates={canManageOfferTemplates}
    />
  );
}
