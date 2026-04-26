import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { MarketingFormCreatePage } from '~/features/campaigns/MarketingFormCreatePage';
import { parseCustomFieldsPayload } from '~/features/campaigns/parse-custom-fields.server';
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
  const showDeliveryAddress = formData.get('showDeliveryAddress') === 'on';
  const showDeliveryNotes = formData.get('showDeliveryNotes') === 'on';
  const showDeliveryState = formData.get('showDeliveryState') === 'on';
  const showGender = formData.get('showGender') === 'on';
  const showPreferredDeliveryDate = formData.get('showPreferredDeliveryDate') === 'on';
  const showPaymentMethod = formData.get('showPaymentMethod') === 'on';
  const hasToggles =
    showDeliveryAddress ||
    showDeliveryNotes ||
    showDeliveryState ||
    showGender ||
    showPreferredDeliveryDate ||
    showPaymentMethod;

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
    hasToggles ||
    hasCustomFields
      ? {
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
    const errorData = res.data as { error?: { message?: string } };
    return json({ error: errorData?.error?.message ?? 'Failed to create form' }, { status: safeStatus(res.status) });
  }
  return redirect('/admin/marketing/forms?saved=1');
}

export default function MarketingFormNewRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketingFormCreatePage products={data.products} productsLoadError={data.productsLoadError} />;
}
