import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { extractApiErrorMessage } from '~/lib/api-error';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import { MarketingAutomationPage } from '~/features/automation/MarketingAutomationPage';
import { MarketingAutomationLoadingShell } from '~/features/automation/MarketingAutomationLoadingShell';
import type { AutomationRuleRow, AutomationChannel, AutomationTemplateRow, TargetGroupRow } from '~/features/automation/types';

export const meta: MetaFunction = () => [{ title: 'Marketing Automation — Yannis EOSE' }];

/** Mirrors the API `marketing.automation.manage` gate (SUPER_ADMIN/SUPPORT bypass; ADMIN; Head of Marketing). */
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
  const pageData = (async () => {
    const [rulesRes, channelsRes, tplRes, groupsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/automation.list', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/automation.configuredChannels', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/automation.templates.list?input=' + encodeURIComponent(JSON.stringify({ includeArchived: false })), { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/automation.targetGroups.list', { method: 'GET', cookie }),
    ]);

    const rules = rulesRes.ok
      ? (((rulesRes.data as { result?: { data?: AutomationRuleRow[] } })?.result?.data ?? []) as AutomationRuleRow[])
      : [];
    const configuredChannels = channelsRes.ok
      ? (((channelsRes.data as { result?: { data?: AutomationChannel[] } })?.result?.data ?? []) as AutomationChannel[])
      : [];
    type RawTpl = AutomationTemplateRow & { channel?: AutomationChannel | null };
    const templates = tplRes.ok
      ? (((tplRes.data as { result?: { data?: RawTpl[] } })?.result?.data ?? []) as RawTpl[]).map((t) => ({
          ...t,
          // Post-migration every row has `channels`; fall back to the legacy single
          // `channel` defensively for any not-yet-backfilled row.
          channels: t.channels && t.channels.length > 0 ? t.channels : t.channel ? [t.channel] : [],
        }))
      : [];

    const targetGroups = groupsRes.ok
      ? (((groupsRes.data as { result?: { data?: TargetGroupRow[] } })?.result?.data ?? []) as TargetGroupRow[])
      : [];

    return {
      rules: Array.isArray(rules) ? rules : [],
      configuredChannels,
      templates: Array.isArray(templates) ? templates : [],
      targetGroups: Array.isArray(targetGroups) ? targetGroups : [],
    };
  })();

  return defer({ pageData });
}

/** Toggle / delete / run-now / test-send a rule. Gated the same as the loader. */
export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Unauthorized', { status: 401 });
  if (!canManageAutomation(user)) throw new Response('Forbidden', { status: 403 });

  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent')?.toString();
  const ruleId = form.get('ruleId')?.toString() ?? '';

  const call = async (proc: string, body: Record<string, unknown>, fallback: string) => {
    const res = await apiRequest<unknown>(`/trpc/${proc}`, { method: 'POST', cookie, body });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, fallback) }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  };

  if (intent === 'toggle') {
    return call('automation.toggle', { ruleId, enabled: form.get('enabled') === 'true' }, 'Failed to update rule');
  }
  if (intent === 'remove') {
    return call('automation.remove', { ruleId }, 'Failed to delete rule');
  }
  if (intent === 'runNow') {
    return call('automation.runNow', { ruleId }, 'Failed to run broadcast');
  }
  if (intent === 'testSend') {
    return call(
      'automation.testSend',
      {
        ruleId,
        channel: form.get('channel')?.toString() ?? 'EMAIL',
        to: form.get('to')?.toString() ?? '',
      },
      'Test send failed',
    );
  }

  // ── Message template intents ──
  if (intent === 'createTemplate') {
    const channels = (form.get('channels')?.toString() ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    return call(
      'automation.templates.create',
      {
        name: form.get('name')?.toString() ?? '',
        channels,
        ...(channels.includes('EMAIL') ? { subject: form.get('subject')?.toString() ?? '' } : {}),
        body: form.get('body')?.toString() ?? '',
      },
      'Failed to create template',
    );
  }
  if (intent === 'updateTemplate') {
    const channelsRaw = form.get('channels')?.toString();
    const channels = channelsRaw != null ? channelsRaw.split(',').map((c) => c.trim()).filter(Boolean) : undefined;
    return call(
      'automation.templates.update',
      {
        templateId: form.get('templateId')?.toString() ?? '',
        ...(form.get('name') != null ? { name: form.get('name')?.toString() } : {}),
        ...(channels ? { channels } : {}),
        ...(channels?.includes('EMAIL') ? { subject: form.get('subject')?.toString() ?? '' } : {}),
        ...(form.get('body') != null ? { body: form.get('body')?.toString() } : {}),
      },
      'Failed to update template',
    );
  }
  if (intent === 'archiveTemplate') {
    return call('automation.templates.archive', { templateId: form.get('templateId')?.toString() ?? '' }, 'Failed to archive template');
  }

  // ── Target group intents ──
  const parseFilter = (): Record<string, unknown> => {
    const raw = form.get('filter')?.toString();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  if (intent === 'createGroup') {
    return call(
      'automation.targetGroups.create',
      {
        name: form.get('name')?.toString() ?? '',
        ...(form.get('description')?.toString() ? { description: form.get('description')?.toString() } : {}),
        sourceKind: 'RULE',
        filter: parseFilter(),
        enabled: form.get('enabled') !== 'false',
      },
      'Failed to create target group',
    );
  }
  if (intent === 'updateGroup') {
    return call(
      'automation.targetGroups.update',
      {
        groupId: form.get('groupId')?.toString() ?? '',
        ...(form.get('name') != null ? { name: form.get('name')?.toString() } : {}),
        ...(form.get('description') != null ? { description: form.get('description')?.toString() || null } : {}),
        filter: parseFilter(),
        enabled: form.get('enabled') !== 'false',
      },
      'Failed to update target group',
    );
  }
  if (intent === 'archiveGroup') {
    return call('automation.targetGroups.archive', { groupId: form.get('groupId')?.toString() ?? '' }, 'Failed to archive target group');
  }
  if (intent === 'syncGroup') {
    return call('automation.targetGroups.syncNow', { groupId: form.get('groupId')?.toString() ?? '' }, 'Failed to sync target group');
  }
  if (intent === 'importMember') {
    return call(
      'automation.targetGroups.importMember',
      {
        groupId: form.get('groupId')?.toString() ?? '',
        ...(form.get('name')?.toString() ? { name: form.get('name')?.toString() } : {}),
        ...(form.get('phone')?.toString() ? { phone: form.get('phone')?.toString() } : {}),
        ...(form.get('email')?.toString() ? { email: form.get('email')?.toString() } : {}),
      },
      'Failed to import member',
    );
  }
  return json({ error: 'Unknown action' }, { status: 400 });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function MarketingAutomationRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<MarketingAutomationLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => (
        <MarketingAutomationPage
          rules={data.rules}
          configuredChannels={data.configuredChannels}
          templates={data.templates}
          targetGroups={data.targetGroups}
        />
      )}
    </CachedAwait>
  );
}
