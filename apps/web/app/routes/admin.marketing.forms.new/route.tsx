import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  ensureBranchScopeOrRedirect,
  getSessionCookie,
  requirePermission,
  safeStatus,
} from '~/lib/api.server';
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
  const user = await requirePermission(request, 'marketing.campaigns');
  // Pre-flight branch picker safety net — redirect deep links / bookmarked URLs
  // back to the parent list with `?branchPickerNext=` so the modal opens before
  // the user invests time in the builder.
  const guard = ensureBranchScopeOrRedirect(request, user, '/admin/marketing/forms');
  if (guard) return guard;
  const cookie = getSessionCookie(request);

  // App Shell pattern — defer the offer groups fetch so the form chrome (heading,
  // subtitle, button text, accent color, custom field builder, preview pane)
  // renders instantly. Only the offer-group dropdown briefly shows "Loading…".
  const offerGroupsInputStr = encodeURIComponent(JSON.stringify({ page: 1, limit: 250 }));
  const offerGroupsPromise: Promise<{ offerGroups: OfferGroupRow[]; offerGroupsLoadError: string | null }> = apiRequest<unknown>(
    `/trpc/marketing.listOfferGroups?input=${offerGroupsInputStr}`,
    { method: 'GET', cookie },
  )
    .then((res) => {
      if (!res.ok) {
        console.error('[admin.marketing.forms.new] listOfferGroups failed', res.status, res.data);
        return { offerGroups: [], offerGroupsLoadError: 'Could not load offers. Try refreshing the page.' };
      }
      const raw = (res.data as { result?: { data?: { groups?: unknown[] } } })?.result?.data?.groups ?? [];
      return {
        offerGroups: Array.isArray(raw) ? (raw as OfferGroupRow[]) : [],
        offerGroupsLoadError: null,
      };
    })
    .catch((err) => {
      console.error('[admin.marketing.forms.new] listOfferGroups error', err);
      return { offerGroups: [], offerGroupsLoadError: 'Could not load offers. Try refreshing the page.' };
    });

  return defer({ offerGroupsPromise });
}

export const clientLoader = cachedClientLoader;
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
  return <MarketingFormCreatePage offerGroupsPromise={data.offerGroupsPromise} />;
}
