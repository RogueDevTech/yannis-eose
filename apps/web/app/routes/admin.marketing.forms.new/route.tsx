import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { MarketingFormCreatePage } from '~/features/campaigns/MarketingFormCreatePage';
import { parseCustomFieldsPayload } from '~/features/campaigns/parse-custom-fields.server';
import { parseStandardFieldsPayload, toLegacyStandardFieldFlags } from '~/features/campaigns/standard-fields';
import type { Product } from '~/features/campaigns/types';

export const meta: MetaFunction = () => [{ title: 'New form — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.campaigns');
  const cookie = getSessionCookie(request);

  const productsListInput = {
    page: 1,
    limit: 100,
    status: 'ACTIVE' as const,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
  };
  const productsInputStr = encodeURIComponent(JSON.stringify(productsListInput));
  const productsPromise = apiRequest<unknown>(`/trpc/products.list?input=${productsInputStr}`, { method: 'GET', cookie });

  let products: Product[] = [];
  let productsLoadError: string | null = null;
  try {
    const productsRes = await productsPromise;
    if (productsRes.ok) {
      const productsData = (productsRes.data as { result?: { data?: { products: Product[] } } })?.result?.data;
      products = productsData?.products ?? [];
    } else {
      console.error('[admin.marketing.forms.new] products.list failed', productsRes.status, productsRes.data);
      productsLoadError = 'Could not load products. Try refreshing the page.';
    }
  } catch (err) {
    console.error('[admin.marketing.forms.new] products.list error', err);
    productsLoadError = 'Could not load products. Try refreshing the page.';
  }

  return { products, productsLoadError };
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent !== 'createForm') {
    return json({ error: 'Unknown action' }, { status: 400 });
  }

  const productId = formData.get('productId')?.toString() ?? '';
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
          ...(hasCustomFields ? { customFields } : {}),
        }
      : undefined;

  const res = await apiRequest<unknown>('/trpc/marketing.createCampaign', {
    method: 'POST',
    cookie,
    body: {
      name: formData.get('name')?.toString() ?? '',
      productIds: [productId],
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
  return <MarketingFormCreatePage products={data.products} productsLoadError={data.productsLoadError} />;
}
