import { json } from '@remix-run/node';
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
  const productsListInput = {
    page: 1,
    limit: 100,
    status: 'ACTIVE' as const,
    sortBy: 'name' as const,
    sortOrder: 'asc' as const,
  };
  const productsInputStr = encodeURIComponent(JSON.stringify(productsListInput));
  const productsPromise = apiRequest<unknown>(`/trpc/products.list?input=${productsInputStr}`, { method: 'GET', cookie });

  const formsRes = await formsPromise;

  // tRPC success shape: { result: { data: { campaigns, pagination } } }
  const resultData = formsRes.ok ? (formsRes.data as { result?: { data?: { campaigns: Campaign[]; pagination: { total: number } } } })?.result?.data : null;
  const formsData = resultData ?? null;

  let products: Product[] = [];
  let productsLoadError: string | null = null;
  try {
    const productsRes = await productsPromise;
    if (productsRes.ok) {
      const productsData = (productsRes.data as { result?: { data?: { products: Product[] } } })?.result?.data;
      products = productsData?.products ?? [];
    } else {
      console.error('[admin.marketing.forms] products.list failed', productsRes.status, productsRes.data);
      productsLoadError = 'Could not load products. Try refreshing the page.';
    }
  } catch (err) {
    console.error('[admin.marketing.forms] products.list error', err);
    productsLoadError = 'Could not load products. Try refreshing the page.';
  }

  return {
    forms: formsData?.campaigns ?? [],
    totalForms: formsData?.pagination?.total ?? 0,
    products,
    productsLoadError,
    isMediaBuyer,
    showMediaBuyerColumn: user.role === 'HEAD_OF_MARKETING' || user.role === 'SUPER_ADMIN' || user.role === 'ADMIN',
    currentUserId: user.id,
    currentUserName: user.name,
  } satisfies FormsStreamData;
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'updateForm') {
    const id = formData.get('id')?.toString() ?? '';
    const name = formData.get('name')?.toString()?.trim() || undefined;
    const status = formData.get('status')?.toString() || undefined;

    // Build formConfig from optional fields
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
    // Always send formConfig on update to ensure toggles are persisted (even when all unchecked)
    const formConfig: Record<string, unknown> = {
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
      productsLoadError={data.productsLoadError}
      isMediaBuyer={data.isMediaBuyer}
      showMediaBuyerColumn={data.showMediaBuyerColumn}
      currentUserName={data.currentUserName}
      currentUserId={data.currentUserId}
    />
  );
}
