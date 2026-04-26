import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { FormBuilderPage } from '~/features/campaigns/FormBuilderPage';
import type { Campaign, CampaignFormConfig } from '~/features/campaigns/types';

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.campaign?.name ? `${data.campaign.name} — Form Builder` : 'Form Builder — Yannis EOSE' },
];

/**
 * Dedicated form-builder page — `/admin/marketing/forms/:id/builder`.
 *
 * The list page (`/admin/marketing/forms`) handles basic config (name, deployment, copy,
 * accent colour, standard-field toggles). This route is exclusively for managing the
 * dynamic `customFields` array — the field-builder UI Sniper has at /form_builder.
 *
 * Auth: marketing.campaigns. Media Buyers see only their own campaigns; the loader cross-
 * checks ownership so MB-A can't edit MB-B's form by URL guessing.
 */
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

  // Ownership check — MB can only edit their own campaigns.
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

  if (intent === 'saveCustomFields') {
    // Field array is JSON-serialised on the client to keep the action body tidy.
    const customFieldsJson = formData.get('customFields')?.toString() ?? '[]';
    let customFields: unknown;
    try {
      customFields = JSON.parse(customFieldsJson);
    } catch {
      return json({ error: 'Invalid customFields payload' }, { status: 400 });
    }

    // Pull the existing formConfig and merge — never blow away unrelated keys (heading,
    // accentColor, showDelivery* etc.) that the basic-settings page owns.
    const existingRes = await apiRequest<{ result?: { data?: Campaign } }>(
      `/trpc/marketing.getCampaign?input=${encodeURIComponent(JSON.stringify({ id }))}`,
      { method: 'GET', cookie },
    );
    const existing = existingRes.ok ? existingRes.data?.result?.data : null;
    const existingFormConfig: CampaignFormConfig = (existing?.formConfig as CampaignFormConfig) ?? {};

    const merged: CampaignFormConfig = {
      ...existingFormConfig,
      customFields: customFields as CampaignFormConfig['customFields'],
    };

    const res = await apiRequest<unknown>('/trpc/marketing.updateCampaign', {
      method: 'POST',
      cookie,
      body: { id, formConfig: merged },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json(
        { error: errorData?.error?.message ?? 'Failed to save form' },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true });
  }

  if (intent === 'exit') {
    return redirect('/admin/marketing/forms');
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FormBuilderRoute() {
  const { campaign } = useLoaderData<typeof loader>();
  return <FormBuilderPage campaign={campaign} />;
}
