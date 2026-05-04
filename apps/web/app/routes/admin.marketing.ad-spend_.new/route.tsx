import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { getSessionCookie, requirePermission } from '~/lib/api.server';
import {
  getMarketingRoleFlags,
  loadAdSpendExpenseFormData,
  runMarketingAdSpendAction,
} from '~/lib/marketing-pages.server';
import { MarketingAddExpensePage } from '~/features/marketing/MarketingAddExpensePage';

export const meta: MetaFunction = () => [{ title: 'Log expenses — Ads Expense — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.adSpend');
  const cookie = getSessionCookie(request);
  if (!cookie) {
    throw redirect(`/auth?redirectTo=${encodeURIComponent(new URL(request.url).pathname)}`);
  }
  const { isMediaBuyer } = getMarketingRoleFlags(user);
  const { campaigns, products } = await loadAdSpendExpenseFormData(cookie, {
    mediaBuyerId: isMediaBuyer ? user.id : undefined,
  });
  return json({ campaigns, products });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  await requirePermission(request, 'marketing.adSpend');
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const result = await runMarketingAdSpendAction(cookie, formData);
  if (!result) return json({ error: 'Unknown action' }, { status: 400 });
  if (intent === 'createAdSpendBatch' && result.ok) {
    return redirect('/admin/marketing/ad-spend');
  }
  return result;
}

export default function AdminMarketingAdSpendNewRoute() {
  const data = useLoaderData<typeof loader>();
  return <MarketingAddExpensePage campaigns={data.campaigns} products={data.products} />;
}
