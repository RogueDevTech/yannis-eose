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
  const res = await apiRequest<unknown>('/trpc/automation.configuredChannels', { method: 'GET', cookie });
  const configuredChannels = res.ok
    ? (((res.data as { result?: { data?: AutomationChannel[] } })?.result?.data ?? []) as AutomationChannel[])
    : [];

  return json({ configuredChannels });
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

  const res = await apiRequest<unknown>('/trpc/automation.create', {
    method: 'POST',
    cookie,
    body: {
      name: fd.get('name')?.toString() ?? '',
      kind,
      channels,
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
  const { configuredChannels } = useLoaderData<typeof loader>();
  return <NewAutomationPage configuredChannels={configuredChannels} />;
}
