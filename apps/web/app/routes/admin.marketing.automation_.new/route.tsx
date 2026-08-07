import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { NewAutomationPage } from '~/features/automation/NewAutomationPage';
import type { AutomationChannel } from '~/features/automation/types';

export const meta: MetaFunction = () => [{ title: 'New automation — Yannis EOSE' }];

function canManageAutomation(user: { role: string; permissions?: string[] }) {
  if (isAdminLevel(user)) return true;
  const codes = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  return codes.has('marketing.automation.manage');
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Unauthorized', { status: 401 });
  if (!canManageAutomation(user)) throw new Response('Forbidden', { status: 403 });

  const cookie = getSessionCookie(request);
  const [chRes, tplRes, brRes, tgRes] = await Promise.all([
    apiRequest<unknown>('/trpc/automation.configuredChannels', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/automation.templates.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/automation.targetGroups.list', { method: 'GET', cookie }),
  ]);

  const configuredChannels = chRes.ok
    ? (((chRes.data as { result?: { data?: AutomationChannel[] } })?.result?.data ?? []) as AutomationChannel[])
    : [];

  type TplRow = { id: string; name: string; channels: AutomationChannel[] | null; channel: AutomationChannel | null; subject: string | null };
  const templates = tplRes.ok
    ? (((tplRes.data as { result?: { data?: TplRow[] } })?.result?.data ?? []) as TplRow[]).map((t) => ({
        id: t.id,
        name: t.name,
        // Prefer the channels array; fall back to the legacy single channel for old rows.
        channels: (t.channels && t.channels.length > 0 ? t.channels : t.channel ? [t.channel] : []) as AutomationChannel[],
        subject: t.subject ?? null,
      }))
    : [];

  type BranchRow = { id: string; name: string };
  const branches = brRes.ok
    ? (((brRes.data as { result?: { data?: BranchRow[] } })?.result?.data ?? []) as BranchRow[]).map((b) => ({
        id: b.id,
        name: b.name,
      }))
    : [];

  type TgRow = { id: string; name: string; memberCount: number };
  const targetGroups = tgRes.ok
    ? (((tgRes.data as { result?: { data?: TgRow[] } })?.result?.data ?? []) as TgRow[]).map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount ?? 0,
      }))
    : [];

  return json({ configuredChannels, templates, branches, targetGroups });
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAutomation(user)) return json({ error: 'Forbidden' }, { status: 403 });

  const cookie = getSessionCookie(request);
  const fd = await request.formData();

  const kind = fd.get('kind')?.toString() ?? 'EVENT';
  const channels = fd.getAll('channels').map((c) => c.toString()).filter(Boolean);
  const delayRaw = fd.get('delayMinutes')?.toString();
  const scheduleRaw = fd.get('scheduleCron')?.toString();
  const templateId = fd.get('templateId')?.toString() || undefined;

  // Trigger jsonb serialized by the form (event {event,toStatus?} or segment filter).
  let trigger: Record<string, unknown> = {};
  const triggerRaw = fd.get('trigger')?.toString();
  if (triggerRaw) {
    try {
      const parsed = JSON.parse(triggerRaw);
      if (parsed && typeof parsed === 'object') trigger = parsed as Record<string, unknown>;
    } catch {
      // Malformed trigger — fall back to empty ({}) so create still succeeds as a draft.
    }
  }

  const res = await apiRequest<unknown>('/trpc/automation.create', {
    method: 'POST',
    cookie,
    body: {
      name: fd.get('name')?.toString() ?? '',
      kind,
      channels,
      trigger,
      ...(templateId ? { templateId } : {}),
      respectOptOut: fd.get('respectOptOut') === 'on',
      priority: Number(fd.get('priority')?.toString() || '0'),
      enabled: fd.get('enabled') !== 'off',
      ...(kind === 'EVENT' && delayRaw ? { delayMinutes: Number(delayRaw) } : {}),
      ...(kind === 'SEGMENT' && scheduleRaw ? { scheduleCron: scheduleRaw } : {}),
    },
  });

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to create automation') },
      { status: safeStatus(res.status) },
    );
  }
  // Success: back to the list, which revalidates and shows the new rule.
  throw redirect('/admin/marketing/automation');
}

export default function NewAutomationRoute() {
  const { configuredChannels, templates, branches, targetGroups } = useLoaderData<typeof loader>();
  return (
    <NewAutomationPage
      configuredChannels={configuredChannels}
      templates={templates}
      branches={branches}
      targetGroups={targetGroups}
    />
  );
}
