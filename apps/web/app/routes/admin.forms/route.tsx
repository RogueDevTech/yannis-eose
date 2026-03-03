import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { FormsPage } from '~/features/campaigns/CampaignsPage';
import type { Campaign, Product, FormsStreamData } from '~/features/campaigns/types';

export const meta: MetaFunction = () => [
  { title: 'Forms — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.campaigns');
  const cookie = getSessionCookie(request);

  const formsPromise = apiRequest<unknown>('/trpc/marketing.listCampaigns?input=%7B%7D', { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>('/trpc/products.list?input=%7B%22limit%22%3A100%7D', { method: 'GET', cookie });

  const formsRes = await formsPromise;

  const formsData = formsRes.ok
    ? (formsRes.data as { result?: { data?: { campaigns: Campaign[]; pagination: { total: number } } } })?.result?.data
    : null;

  const products = productsPromise
    .then((productsRes) => {
      const productsData = productsRes.ok
        ? (productsRes.data as { result?: { data?: { products: Product[] } } })?.result?.data
        : null;
      return productsData?.products ?? [];
    })
    .catch(() => [] as Product[]);

  return {
    forms: formsData?.campaigns ?? [],
    totalForms: formsData?.pagination?.total ?? 0,
    products,
  } satisfies FormsStreamData;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createForm') {
    const productId = formData.get('productId')?.toString() ?? '';

    // Build formConfig from optional fields
    const heading = formData.get('formHeading')?.toString();
    const subtitle = formData.get('formSubtitle')?.toString();
    const buttonText = formData.get('formButtonText')?.toString();
    const accentColor = formData.get('formAccentColor')?.toString();
    const formConfig = (heading || subtitle || buttonText || accentColor) ? {
      ...(heading ? { heading } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(buttonText ? { buttonText } : {}),
      ...(accentColor ? { accentColor } : {}),
    } : undefined;

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
      return json({ error: errorData?.error?.message ?? 'Failed to create form' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'updateForm') {
    const id = formData.get('id')?.toString() ?? '';
    const name = formData.get('name')?.toString()?.trim() || undefined;
    const status = formData.get('status')?.toString() || undefined;

    // Build formConfig from optional fields
    const heading = formData.get('formHeading')?.toString()?.trim();
    const subtitle = formData.get('formSubtitle')?.toString()?.trim();
    const buttonText = formData.get('formButtonText')?.toString()?.trim();
    const accentColor = formData.get('formAccentColor')?.toString()?.trim();
    const formConfig = (heading || subtitle || buttonText || accentColor) ? {
      ...(heading ? { heading } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(buttonText ? { buttonText } : {}),
      ...(accentColor ? { accentColor } : {}),
    } : undefined;

    const body: Record<string, unknown> = { id };
    if (name) body.name = name;
    if (status) body.status = status;
    if (formConfig) body.formConfig = formConfig;

    const res = await apiRequest<unknown>('/trpc/marketing.updateCampaign', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update form' }, { status: res.status });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function FormsRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <FormsPage
      forms={data.forms}
      totalForms={data.totalForms}
      products={data.products}
    />
  );
}
