import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { isAdminLevel } from '~/lib/rbac';
import { apiRequest, getCurrentUser, getSessionCookie } from '~/lib/api.server';
import { TargetGroupImportPage } from '~/features/automation/TargetGroupImportPage';

export const meta: MetaFunction = () => [{ title: 'Import members — Yannis EOSE' }];

function canManageAutomation(user: { role: string; permissions?: string[] }) {
  if (isAdminLevel(user)) return true;
  const codes = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  return codes.has('marketing.automation.manage');
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) throw new Response('Unauthorized', { status: 401 });
  if (!canManageAutomation(user)) throw new Response('Forbidden', { status: 403 });

  const groupId = params.groupId ?? '';
  const cookie = getSessionCookie(request);
  const res = await apiRequest<unknown>(
    '/trpc/automation.targetGroups.get?input=' + encodeURIComponent(JSON.stringify({ groupId })),
    { method: 'GET', cookie },
  );
  const group = res.ok
    ? ((res.data as { result?: { data?: { id: string; name: string } } })?.result?.data ?? null)
    : null;
  if (!group) throw new Response('Target group not found', { status: 404 });

  return json({ groupId: group.id, groupName: group.name });
}

export default function TargetGroupImportRoute() {
  const { groupId, groupName } = useLoaderData<typeof loader>();
  return <TargetGroupImportPage groupId={groupId} groupName={groupName} />;
}
