import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { respondToOfferTemplateIntent } from '~/lib/marketing-offer-template-actions.server';
import { MarketingFormCreatePage } from '~/features/campaigns/MarketingFormCreatePage';
import { parseCustomFieldsPayload } from '~/features/campaigns/parse-custom-fields.server';
import {
  parseAdditionalFieldSelectOptionsPayload,
  parseStandardFieldsPayload,
  toLegacyStandardFieldFlags,
} from '~/features/campaigns/standard-fields';
import type { OfferGroupRow } from '~/features/campaigns/types';

export const meta: MetaFunction = () => [{ title: 'New form — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.campaigns');
  const cookie = getSessionCookie(request);

  const offerGroupsInputStr = encodeURIComponent(JSON.stringify({ page: 1, limit: 250 }));
  let offerGroups: OfferGroupRow[] = [];
  let offerGroupsLoadError: string | null = null;
  try {
    const offerGroupsRes = await apiRequest<unknown>(
      `/trpc/marketing.listOfferGroups?input=${offerGroupsInputStr}`,
      { method: 'GET', cookie },
    );
    if (offerGroupsRes.ok) {
      const raw = (offerGroupsRes.data as { result?: { data?: { groups?: unknown[] } } })?.result?.data?.groups ?? [];
      offerGroups = Array.isArray(raw) ? (raw as OfferGroupRow[]) : [];
    } else {
      console.error('[admin.marketing.forms.new] listOfferGroups failed', offerGroupsRes.status, offerGroupsRes.data);
      offerGroupsLoadError = 'Could not load offers. Try refreshing the page.';
    }
  } catch (err) {
    console.error('[admin.marketing.forms.new] listOfferGroups error', err);
    offerGroupsLoadError = 'Could not load offers. Try refreshing the page.';
  }

  return {
    offerGroups,
    offerGroupsLoadError,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (
    intent === 'createOfferTemplate' ||
    intent === 'updateOfferTemplate' ||
    intent === 'archiveAllOfferTemplates'
  ) {
    await requirePermission(request, 'marketing.offerTemplate');
    if (!cookie) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tierResp = await respondToOfferTemplateIntent({
      intent,
      formData,
      cookie,
      unauthorizedRedirect: '/admin/marketing/forms/new',
    });
    if (tierResp) return tierResp;
  }

  if (intent !== 'createForm') {
    return json({ error: 'Unknown action' }, { status: 400 });
  }

  const offerGroupId = formData.get('offerGroupId')?.toString()?.trim() ?? '';
  if (!offerGroupId) {
    return json({ error: 'Select an offer for this form.' }, { status: 400 });
  }
  const heading = formData.get('formHeading')?.toString();
  const subtitle = formData.get('formSubtitle')?.toString();
  const buttonText = formData.get('formButtonText')?.toString();
  const accentColor = formData.get('formAccentColor')?.toString();
  const successCallbackUrl = formData.get('successCallbackUrl')?.toString()?.trim() || undefined;
  const showProductImages = formData.get('showProductImages')?.toString() !== 'false';
  const parsedStandard = parseStandardFieldsPayload(formData.get('standardFields')?.toString());
  if (!parsedStandard.ok) {
    return json({ error: parsedStandard.error }, { status: 400 });
  }
  const standardFields = parsedStandard.fields;
  const legacyStandardFlags = toLegacyStandardFieldFlags(standardFields);
  const hasStandardFields = standardFields.length > 0;

  const parsedSelectOpts = parseAdditionalFieldSelectOptionsPayload(
    formData.get('additionalFieldSelectOptions')?.toString(),
  );
  if (!parsedSelectOpts.ok) {
    return json({ error: parsedSelectOpts.error }, { status: 400 });
  }

  const parsedFields = parseCustomFieldsPayload(formData.get('customFields')?.toString());
  if (!parsedFields.ok) {
    return json({ error: parsedFields.error }, { status: 400 });
  }
  const customFields = parsedFields.fields;
  const hasCustomFields = customFields.length > 0;

  const formConfig =
    heading ||
    subtitle ||
    buttonText ||
    accentColor ||
    successCallbackUrl ||
    showProductImages === false ||
    hasStandardFields ||
    hasCustomFields
      ? {
          ...(heading ? { heading } : {}),
          ...(subtitle ? { subtitle } : {}),
          ...(buttonText ? { buttonText } : {}),
          ...(accentColor ? { accentColor } : {}),
          ...(successCallbackUrl ? { successCallbackUrl } : {}),
          ...(showProductImages === false ? { showProductImages: false } : {}),
          standardFields,
          ...legacyStandardFlags,
          deliveryStateOptions: parsedSelectOpts.options.deliveryStateOptions,
          preferredDeliveryDateOptions: parsedSelectOpts.options.preferredDeliveryDateOptions,
          genderOptions: parsedSelectOpts.options.genderOptions,
          ...(hasCustomFields ? { customFields } : {}),
        }
      : undefined;

  const res = await apiRequest<unknown>('/trpc/marketing.createCampaign', {
    method: 'POST',
    cookie,
    body: {
      name: formData.get('name')?.toString() ?? '',
      offerGroupId,
      deploymentType: formData.get('deploymentType')?.toString() ?? 'HOSTED',
      ...(formConfig ? { formConfig } : {}),
    },
  });
  if (!res.ok) {
    return json({ error: extractApiErrorMessage(res.data, 'Failed to create form') }, { status: safeStatus(res.status) });
  }
  return redirect('/admin/marketing/forms?saved=1');
}

export default function MarketingFormNewRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <MarketingFormCreatePage offerGroups={data.offerGroups} offerGroupsLoadError={data.offerGroupsLoadError} />
  );
}
