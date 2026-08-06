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
import type { AutomationRuleRow, AutomationChannel } from '~/features/automation/types';

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
    const [rulesRes, channelsRes] = await Promise.all([
      apiRequest<unknown>('/trpc/automation.list', { method: 'GET', cookie }),
      apiRequest<unknown>('/trpc/automation.configuredChannels', { method: 'GET', cookie }),
    ]);

    const rules = rulesRes.ok
      ? (((rulesRes.data as { result?: { data?: AutomationRuleRow[] } })?.result?.data ?? []) as AutomationRuleRow[])
      : [];
    const configuredChannels = channelsRes.ok
      ? (((channelsRes.data as { result?: { data?: AutomationChannel[] } })?.result?.data ?? []) as AutomationChannel[])
      : [];

    return { rules: Array.isArray(rules) ? rules : [], configuredChannels };
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
  return json({ error: 'Unknown action' }, { status: 400 });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export default function MarketingAutomationRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<MarketingAutomationLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <MarketingAutomationPage rules={data.rules} configuredChannels={data.configuredChannels} />}
    </CachedAwait>
  );
}
