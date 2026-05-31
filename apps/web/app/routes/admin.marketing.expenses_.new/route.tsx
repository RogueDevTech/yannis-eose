import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { ensureBranchScopeOrRedirect, getSessionCookie, requirePermission } from '~/lib/api.server';
import { runMarketingAdSpendAction } from '~/lib/marketing-pages.server';
import { DailySpendLogPage } from '~/features/marketing/DailySpendLogPage';

export const meta: MetaFunction = () => [{ title: 'Log Spend — Ads Expense — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermission(request, 'marketing.adSpend');
  const guard = ensureBranchScopeOrRedirect(request, user, '/admin/marketing/expenses');
  if (guard) return guard;
  return json({});
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  if (!cookie) return json({ error: 'Not authenticated' }, { status: 401 });
  await requirePermission(request, 'marketing.adSpend');
  const formData = await request.formData();
  const result = await runMarketingAdSpendAction(cookie, formData);
  if (!result) return json({ error: 'Unknown action' }, { status: 400 });
  return result;
}

export default function AdminMarketingAdSpendNewRoute() {
  return <DailySpendLogPage />;
}
