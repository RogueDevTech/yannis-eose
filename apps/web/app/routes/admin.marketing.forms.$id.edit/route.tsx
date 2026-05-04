import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { MarketingFormEditPage } from '~/features/campaigns/MarketingFormEditPage';
import { parseCustomFieldsPayload } from '~/features/campaigns/parse-custom-fields.server';
import {
  parseAdditionalFieldSelectOptionsPayload,
  parseStandardFieldsPayload,
  toLegacyStandardFieldFlags,
} from '~/features/campaigns/standard-fields';
import type { Campaign, CampaignFormConfig, Product } from '~/features/campaigns/types';

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.campaign?.name ? `Edit: ${data.campaign.name} — Yannis EOSE` : 'Edit form — Yannis EOSE' },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.campaigns');
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

  return { campaign, formProducts };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermission(request, 'marketing.campaigns');
  const cookie = getSessionCookie(request);
  const id = params.id;
  if (!id) return json({ error: 'Missing form id' }, { status: 400 });

  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

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

  const body: Record<string, unknown> = { id, formConfig };
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
  return redirect('/admin/marketing/forms?saved=1');
}

export default function MarketingFormEditRoute() {
  const { campaign, formProducts } = useLoaderData<typeof loader>();
  return (
    <MarketingFormEditPage key={`${campaign.id}-${campaign.status}`} campaign={campaign} formProducts={formProducts} />
  );
}
