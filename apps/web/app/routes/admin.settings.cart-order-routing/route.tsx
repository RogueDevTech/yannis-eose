import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { CartOrderRoutingPage } from '~/features/settings/CartOrderRoutingPage';

export const meta: MetaFunction = () => [{ title: 'Cart order routing — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'orders.followUpConfig');
  const cookie = getSessionCookie(request);

  const [rulesRes, branchesRes, logsRes] = await Promise.all([
    apiRequest<unknown>('/trpc/cartOrders.routingListRules?input=%7B%7D', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/branches.list?input=%7B%7D', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/cartOrders.routingListSyncLogs?input=%7B%22page%22%3A1%2C%22limit%22%3A50%7D', { method: 'GET', cookie }),
  ]);

  const rulesRaw = rulesRes.ok ? (rulesRes.data as Record<string, unknown>)?.result : null;
  const rules = Array.isArray(rulesRaw) ? rulesRaw : (rulesRaw as Record<string, unknown>)?.data ?? [];
  const branchesRaw = branchesRes.ok ? (branchesRes.data as Record<string, unknown>)?.result : null;
  const branches = Array.isArray(branchesRaw) ? branchesRaw : (branchesRaw as Record<string, unknown>)?.data ?? [];
  const logsRaw = logsRes.ok ? (logsRes.data as Record<string, unknown>)?.result : null;
  const logsData = (logsRaw as Record<string, unknown>)?.data ?? logsRaw;
  const syncLogsExtracted = Array.isArray(logsData) ? logsData : (logsData as Record<string, unknown>)?.logs ?? [];
  const syncLogs = Array.isArray(syncLogsExtracted) ? syncLogsExtracted : [];

  return json({ rules, branches, syncLogs });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'orders.followUpConfig');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'createRule') {
    const body = JSON.parse(formData.get('json')?.toString() ?? '{}');
    const res = await apiRequest<unknown>('/trpc/cartOrders.routingCreateRule', { method: 'POST', cookie, body });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to create rule') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'updateRule') {
    const body = JSON.parse(formData.get('json')?.toString() ?? '{}');
    const res = await apiRequest<unknown>('/trpc/cartOrders.routingUpdateRule', { method: 'POST', cookie, body });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update rule') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'deleteRule') {
    const ruleId = formData.get('ruleId')?.toString();
    if (!ruleId) return json({ error: 'Missing rule ID' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/cartOrders.routingDeleteRule', { method: 'POST', cookie, body: { ruleId } });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to delete rule') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'syncNow') {
    const res = await apiRequest<unknown>('/trpc/cartOrders.routingSyncNow', { method: 'POST', cookie, body: {}, timeoutMs: 60_000 });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Sync failed') }, { status: safeStatus(res.status) });
    const data = (res.data as { result?: { data?: { totalPulled?: number } } })?.result?.data;
    return json({ success: true, totalPulled: data?.totalPulled ?? 0 });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function CartOrderRoutingRoute() {
  const { rules, branches, syncLogs } = useLoaderData<typeof loader>();
  return (
    <CartOrderRoutingPage
      rules={rules as never[]}
      branches={branches as never[]}
      syncLogs={syncLogs as never[]}
    />
  );
}
