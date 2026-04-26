import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { MarketingFormEditPage } from '~/features/campaigns/MarketingFormEditPage';
import { parseCustomFieldsPayload } from '~/features/campaigns/parse-custom-fields.server';
import type { Campaign, CampaignFormConfig } from '~/features/campaigns/types';

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

  return { campaign };
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
  const showDeliveryAddress = formData.get('showDeliveryAddress') === 'on';
  const showDeliveryNotes = formData.get('showDeliveryNotes') === 'on';
  const showDeliveryState = formData.get('showDeliveryState') === 'on';
  const showGender = formData.get('showGender') === 'on';
  const showPreferredDeliveryDate = formData.get('showPreferredDeliveryDate') === 'on';
  const showPaymentMethod = formData.get('showPaymentMethod') === 'on';

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
    ...(subtitle ? { subtitle } : {}),
    ...(buttonText ? { buttonText } : {}),
    ...(accentColor ? { accentColor } : {}),
    ...(successCallbackUrl ? { successCallbackUrl } : {}),
    showDeliveryAddress,
    showDeliveryNotes,
    showDeliveryState,
    showGender,
    showPreferredDeliveryDate,
    showPaymentMethod,
    customFields: parsedCustom.fields,
  };

  const body: Record<string, unknown> = { id, formConfig };
  if (name) body.name = name;
  if (status) body.status = status;

  const res = await apiRequest<unknown>('/trpc/marketing.updateCampaign', {
    method: 'POST',
    cookie,
    body,
  });
  if (!res.ok) {
    const errorData = res.data as { error?: { message?: string } };
    return json({ error: errorData?.error?.message ?? 'Failed to update form' }, { status: safeStatus(res.status) });
  }
  return redirect('/admin/marketing/forms?saved=1');
}

export default function MarketingFormEditRoute() {
  const { campaign } = useLoaderData<typeof loader>();
  return <MarketingFormEditPage key={`${campaign.id}-${campaign.status}`} campaign={campaign} />;
}
