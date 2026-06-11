import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useRouteError, isRouteErrorResponse } from '@remix-run/react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { FollowUpConfigPage } from '~/features/settings/FollowUpConfigPage';

export const meta: MetaFunction = () => [{ title: 'Follow-up config — Yannis EOSE' }];

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'orders.followUpConfig');
  const cookie = getSessionCookie(request);

  const [rulesRes, branchesRes, groupsRes, logsRes, closersRes] = await Promise.all([
    apiRequest<unknown>('/trpc/orders.followUpConfigListRules?input=%7B%7D', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/branches.list?input=%7B%7D', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/orders.listFollowUpGroups?input=%7B%7D', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/orders.followUpConfigListSyncLogs?input=%7B%22page%22%3A1%2C%22limit%22%3A100%7D', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/orders.listCSClosersWithBranches?input=%7B%7D', { method: 'GET', cookie }),
  ]);

  const rulesRaw = rulesRes.ok ? (rulesRes.data as Record<string, unknown>)?.result : null;
  const rules = Array.isArray(rulesRaw) ? rulesRaw : (rulesRaw as Record<string, unknown>)?.data ?? [];
  const branchesRaw = branchesRes.ok ? (branchesRes.data as Record<string, unknown>)?.result : null;
  const branches = Array.isArray(branchesRaw) ? branchesRaw : (branchesRaw as Record<string, unknown>)?.data ?? [];
  const groupsRaw = groupsRes.ok ? (groupsRes.data as Record<string, unknown>)?.result : null;
  const groupsData = (groupsRaw as Record<string, unknown>)?.data ?? groupsRaw;
  const groups = Array.isArray(groupsData) ? groupsData : (groupsData as Record<string, unknown>)?.groups ?? [];
  const logsRaw = logsRes.ok ? (logsRes.data as Record<string, unknown>)?.result : null;
  const logsData = (logsRaw as Record<string, unknown>)?.data ?? logsRaw;
  const syncLogsExtracted = Array.isArray(logsData) ? logsData : (logsData as Record<string, unknown>)?.logs ?? [];
  const syncLogs = Array.isArray(syncLogsExtracted) ? syncLogsExtracted : [];
  const closersRaw = closersRes.ok ? (closersRes.data as Record<string, unknown>)?.result : null;
  const closers = Array.isArray(closersRaw) ? closersRaw : (closersRaw as Record<string, unknown>)?.data ?? [];

  return json({ rules, branches, groups, syncLogs, closers });
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'orders.followUpConfig');
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  // ── Rule CRUD ──────────────────────────────────────────────────
  if (intent === 'createRule') {
    const body = JSON.parse(formData.get('json')?.toString() ?? '{}');
    const res = await apiRequest<unknown>('/trpc/orders.followUpConfigCreateRule', { method: 'POST', cookie, body });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to create rule') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'updateRule') {
    const body = JSON.parse(formData.get('json')?.toString() ?? '{}');
    const res = await apiRequest<unknown>('/trpc/orders.followUpConfigUpdateRule', { method: 'POST', cookie, body });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update rule') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'deleteRule') {
    const ruleId = formData.get('ruleId')?.toString();
    if (!ruleId) return json({ error: 'Missing rule ID' }, { status: 400 });
    const res = await apiRequest<unknown>('/trpc/orders.followUpConfigDeleteRule', { method: 'POST', cookie, body: { ruleId } });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to delete rule') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'syncNow') {
    const res = await apiRequest<unknown>('/trpc/orders.followUpConfigSyncNow', { method: 'POST', cookie, body: {}, timeoutMs: 60_000 });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Sync failed') }, { status: safeStatus(res.status) });
    const data = (res.data as { result?: { data?: { totalPulled?: number } } })?.result?.data;
    return json({ success: true, totalPulled: data?.totalPulled ?? 0 });
  }

  // ── Group CRUD ─────────────────────────────────────────────────
  if (intent === 'createFollowUpGroup') {
    const name = formData.get('groupName')?.toString()?.trim() ?? '';
    if (!name) return json({ error: 'Group name is required' }, { status: 400 });
    let memberIds: string[] = [];
    try { memberIds = JSON.parse(formData.get('memberIds')?.toString() ?? '[]'); } catch { /* empty */ }
    const res = await apiRequest<unknown>('/trpc/orders.createFollowUpGroup', { method: 'POST', cookie, body: { name, memberIds } });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to create group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'updateFollowUpGroup') {
    const groupId = formData.get('groupId')?.toString() ?? '';
    const name = formData.get('groupName')?.toString()?.trim() ?? '';
    if (!groupId || !name) return json({ error: 'Group ID and name are required' }, { status: 400 });
    let memberIds: string[] = [];
    try { memberIds = JSON.parse(formData.get('memberIds')?.toString() ?? '[]'); } catch { /* empty */ }
    const res = await apiRequest<unknown>('/trpc/orders.updateFollowUpGroup', { method: 'POST', cookie, body: { groupId, name, memberIds } });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update group') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }
  if (intent === 'deleteFollowUpGroup') {
    const groupId = formData.get('groupId')?.toString() ?? '';
    if (!groupId) return json({ error: 'Missing group ID' }, { status: 400 });
    const transferToBranchId = formData.get('transferToBranchId')?.toString() || undefined;
    const transferToGroupId = formData.get('transferToGroupId')?.toString() || undefined;
    const res = await apiRequest<unknown>('/trpc/orders.deleteFollowUpGroup', {
      method: 'POST', cookie,
      body: { groupId, ...(transferToBranchId && { transferToBranchId }), ...(transferToGroupId && { transferToGroupId }) },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to delete group') }, { status: safeStatus(res.status) });
    return json({ success: true, message: 'Group deleted' });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export function ErrorBoundary() {
  const error = useRouteError();
  let message = 'Unknown error';
  let detail = '';
  if (isRouteErrorResponse(error)) {
    message = `${error.status} ${error.statusText}`;
    detail = typeof error.data === 'string' ? error.data : JSON.stringify(error.data, null, 2);
  } else if (error instanceof Error) {
    message = error.message;
    detail = error.stack ?? '';
  } else {
    detail = JSON.stringify(error, null, 2);
  }
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold text-red-600">Follow-Up Config Error</h1>
      <pre className="mt-2 text-xs text-red-500 whitespace-pre-wrap">{message}</pre>
      <pre className="mt-1 text-xs text-app-fg-muted whitespace-pre-wrap max-h-96 overflow-auto">{detail}</pre>
    </div>
  );
}

export default function FollowUpConfigRoute() {
  const data = useLoaderData<typeof loader>();
  return (
    <FollowUpConfigPage
      rules={Array.isArray(data.rules) ? data.rules as never[] : []}
      branches={Array.isArray(data.branches) ? data.branches as never[] : []}
      groups={Array.isArray(data.groups) ? data.groups as never[] : []}
      syncLogs={Array.isArray(data.syncLogs) ? data.syncLogs as never[] : []}
      followUpGroups={Array.isArray(data.groups) ? data.groups as never[] : []}
      closers={Array.isArray(data.closers) ? data.closers as never[] : []}
    />
  );
}
