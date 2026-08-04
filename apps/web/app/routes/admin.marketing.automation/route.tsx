import { defer, json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
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

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManageAutomation(user)) return json({ error: 'Forbidden' }, { status: 403 });

  const cookie = getSessionCookie(request);
  const fd = await request.formData();
  const intent = fd.get('intent')?.toString() ?? '';

  if (intent === 'createRule') {
    const delayRaw = fd.get('delayMinutes')?.toString();
    const scheduleRaw = fd.get('scheduleCron')?.toString();
    const kind = fd.get('kind')?.toString() ?? 'EVENT';
    const res = await apiRequest<unknown>('/trpc/automation.create', {
      method: 'POST',
      cookie,
      body: {
        name: fd.get('name')?.toString() ?? '',
        kind,
        channel: fd.get('channel')?.toString() ?? '',
        respectOptOut: fd.get('respectOptOut') === 'on',
        priority: Number(fd.get('priority')?.toString() || '0'),
        enabled: fd.get('enabled') !== 'off',
        // EVENT rules carry a delay; SEGMENT rules carry a schedule. Send only the
        // relevant one so the server-side refine passes.
        ...(kind === 'EVENT' && delayRaw ? { delayMinutes: Number(delayRaw) } : {}),
        ...(kind === 'SEGMENT' && scheduleRaw ? { scheduleCron: scheduleRaw } : {}),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create automation') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

export default function MarketingAutomationRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait resolve={pageData} fallback={<MarketingAutomationLoadingShell />} loaderShell={{}} deferredKey="pageData">
      {(data) => <MarketingAutomationPage rules={data.rules} configuredChannels={data.configuredChannels} />}
    </CachedAwait>
  );
}
