import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission } from '~/lib/api.server';
import { CampaignsPage } from '~/features/campaigns/CampaignsPage';
import type { OfferTemplate, Campaign, Product, CampaignsStreamData } from '~/features/campaigns/types';

export const meta: MetaFunction = () => [
  { title: 'Campaigns — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'marketing.campaigns');
  const cookie = getSessionCookie(request);

  // Start all 3 fetches concurrently
  const templatesPromise = apiRequest<unknown>('/trpc/marketing.listOfferTemplates?input=%7B%7D', { method: 'GET', cookie });
  const campaignsPromise = apiRequest<unknown>('/trpc/marketing.listCampaigns?input=%7B%7D', { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>('/trpc/products.list?input=%7B%22limit%22%3A100%7D', { method: 'GET', cookie });

  // Await only critical data: templates and campaigns
  const [templatesRes, campaignsRes] = await Promise.all([templatesPromise, campaignsPromise]);

  const templatesData = templatesRes.ok
    ? (templatesRes.data as { result?: { data?: { templates: OfferTemplate[]; pagination: { total: number } } } })?.result?.data
    : null;

  const campaignsData = campaignsRes.ok
    ? (campaignsRes.data as { result?: { data?: { campaigns: Campaign[]; pagination: { total: number } } } })?.result?.data
    : null;

  // Products returned as un-awaited promise — streams to client
  const products = productsPromise
    .then((productsRes) => {
      const productsData = productsRes.ok
        ? (productsRes.data as { result?: { data?: { products: Product[] } } })?.result?.data
        : null;
      return productsData?.products ?? [];
    })
    .catch(() => [] as Product[]);

  return {
    templates: templatesData?.templates ?? [],
    totalTemplates: templatesData?.pagination?.total ?? 0,
    campaigns: campaignsData?.campaigns ?? [],
    totalCampaigns: campaignsData?.pagination?.total ?? 0,
    products,
  } satisfies CampaignsStreamData;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createTemplate') {
    const res = await apiRequest<unknown>('/trpc/marketing.createOfferTemplate', {
      method: 'POST',
      cookie,
      body: {
        productId: formData.get('productId')?.toString() ?? '',
        name: formData.get('name')?.toString() ?? '',
        price: formData.get('price')?.toString() ?? '',
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create template' }, { status: res.status });
    }
    return json({ success: true });
  }

  if (intent === 'createCampaign') {
    const offerTemplateId = formData.get('offerTemplateId')?.toString() ?? '';
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
        offerTemplateId,
        productIds: [productId],
        deploymentType: formData.get('deploymentType')?.toString() ?? 'HOSTED',
        ...(formConfig ? { formConfig } : {}),
      },
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to create campaign' }, { status: res.status });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function CampaignsRoute() {
  const data = useLoaderData<typeof loader>();

  return (
    <CampaignsPage
      templates={data.templates}
      totalTemplates={data.totalTemplates}
      campaigns={data.campaigns}
      totalCampaigns={data.totalCampaigns}
      products={data.products}
    />
  );
}
