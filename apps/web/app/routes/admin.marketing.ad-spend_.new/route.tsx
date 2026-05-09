import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { cachedClientLoader } from '~/lib/loader-cache';
import { ensureBranchScopeOrRedirect, getSessionCookie, requirePermission } from '~/lib/api.server';
import {
  getMarketingRoleFlags,
  loadAdSpendExpenseFormData,
  runMarketingAdSpendAction,
} from '~/lib/marketing-pages.server';
import { MarketingAddExpensePage } from '~/features/marketing/MarketingAddExpensePage';
import type { Campaign, Product } from '~/features/marketing/types';

export const meta: MetaFunction = () => [{ title: 'Log expenses — Ads Expense — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.adSpend');
  // Pre-flight branch picker safety net — see ensureBranchScopeOrRedirect docs.
  const guard = ensureBranchScopeOrRedirect(request, user, '/admin/marketing/ad-spend');
  if (guard) return guard;
  const cookie = getSessionCookie(request);
  if (!cookie) {
    throw redirect(`/auth?redirectTo=${encodeURIComponent(new URL(request.url).pathname)}`);
  }
  const { isMediaBuyer } = getMarketingRoleFlags(user);

  // App Shell pattern — defer the picklists fetch so the form chrome (date,
  // line rows, screenshot upload, totals) renders instantly. Only the campaign
  // and product dropdowns briefly show "Loading…".
  const picklistsPromise: Promise<{ campaigns: Campaign[]; products: Product[] }> =
    loadAdSpendExpenseFormData(cookie, {
      mediaBuyerId: isMediaBuyer ? user.id : undefined,
    }).catch(() => ({ campaigns: [], products: [] }));

  return defer({ picklistsPromise });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

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
  const { picklistsPromise } = useLoaderData<typeof loader>();
  return <MarketingAddExpensePage picklistsPromise={picklistsPromise} />;
}
