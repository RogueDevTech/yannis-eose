import { json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { FormsPage } from '~/features/campaigns/CampaignsPage';
import type { Campaign, Product, FormsStreamData } from '~/features/campaigns/types';

export const meta: MetaFunction = () => [
  { title: 'Forms — Yannis EOSE' },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.campaigns');
  const cookie = getSessionCookie(request);

  const isMediaBuyer = user.role === 'MEDIA_BUYER';
  // Media Buyer: only their forms. HoM/SuperAdmin: always load all forms (tab filter is client-side).
  const mediaBuyerId = isMediaBuyer ? user.id : undefined;

  const listInput = {
    page: 1,
    limit: 20,
    ...(mediaBuyerId && { mediaBuyerId }),
  };
  const listInputStr = encodeURIComponent(JSON.stringify(listInput));

  const formsPromise = apiRequest<unknown>(`/trpc/marketing.listCampaigns?input=${listInputStr}`, { method: 'GET', cookie });
  const productsPromise = apiRequest<unknown>('/trpc/products.list?input=%7B%22limit%22%3A20%7D', { method: 'GET', cookie });

  const formsRes = await formsPromise;

  // tRPC success shape: { result: { data: { campaigns, pagination } } }
  const resultData = formsRes.ok ? (formsRes.data as { result?: { data?: { campaigns: Campaign[]; pagination: { total: number } } } })?.result?.data : null;
  const formsData = resultData ?? null;

  const products = await productsPromise
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
    isMediaBuyer,
    showMediaBuyerColumn: user.role === 'HEAD_OF_MARKETING' || user.role === 'SUPER_ADMIN',
    currentUserId: user.id,
    currentUserName: user.name,
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
    const showDeliveryAddress = formData.get('showDeliveryAddress') === 'on';
    const showDeliveryNotes = formData.get('showDeliveryNotes') === 'on';
    const showDeliveryState = formData.get('showDeliveryState') === 'on';
    const showGender = formData.get('showGender') === 'on';
    const showPreferredDeliveryDate = formData.get('showPreferredDeliveryDate') === 'on';
    const showPaymentMethod = formData.get('showPaymentMethod') === 'on';
    const hasToggles = showDeliveryAddress || showDeliveryNotes || showDeliveryState || showGender || showPreferredDeliveryDate || showPaymentMethod;
    const formConfig = (heading || subtitle || buttonText || accentColor || hasToggles) ? {
      ...(heading ? { heading } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(buttonText ? { buttonText } : {}),
      ...(accentColor ? { accentColor } : {}),
      showDeliveryAddress,
      showDeliveryNotes,
      showDeliveryState,
      showGender,
      showPreferredDeliveryDate,
      showPaymentMethod,
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
      return json({ error: errorData?.error?.message ?? 'Failed to create form' }, { status: safeStatus(res.status) });
    }
    return redirect(new URL(request.url).pathname + '?saved=1');
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
    const showDeliveryAddress = formData.get('showDeliveryAddress') === 'on';
    const showDeliveryNotes = formData.get('showDeliveryNotes') === 'on';
    const showDeliveryState = formData.get('showDeliveryState') === 'on';
    const showGender = formData.get('showGender') === 'on';
    const showPreferredDeliveryDate = formData.get('showPreferredDeliveryDate') === 'on';
    const showPaymentMethod = formData.get('showPaymentMethod') === 'on';
    // Always send formConfig on update to ensure toggles are persisted (even when all unchecked)
    const formConfig: Record<string, unknown> = {
      ...(heading ? { heading } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(buttonText ? { buttonText } : {}),
      ...(accentColor ? { accentColor } : {}),
      showDeliveryAddress,
      showDeliveryNotes,
      showDeliveryState,
      showGender,
      showPreferredDeliveryDate,
      showPaymentMethod,
    };

    const body: Record<string, unknown> = { id };
    if (name) body.name = name;
    if (status) body.status = status;
    body.formConfig = formConfig;

    const res = await apiRequest<unknown>('/trpc/marketing.updateCampaign', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) {
      const errorData = res.data as { error?: { message?: string } };
      return json({ error: errorData?.error?.message ?? 'Failed to update form' }, { status: safeStatus(res.status) });
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
      isMediaBuyer={data.isMediaBuyer}
      showMediaBuyerColumn={data.showMediaBuyerColumn}
      currentUserName={data.currentUserName}
      currentUserId={data.currentUserId}
    />
  );
}
