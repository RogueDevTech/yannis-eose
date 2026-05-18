import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requireGlobalAuditAccess } from '~/lib/api.server';
import type { ActorMap } from '~/features/audit/types';

export async function action({ request }: ActionFunctionArgs) {
  await requireGlobalAuditAccess(request);
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const raw = formData.get('userIdsJson')?.toString() ?? '[]';

  let userIds: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      userIds = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 200);
    }
  } catch {
    userIds = [];
  }

  if (userIds.length === 0) {
    return json({ ok: true as const, actorNames: {} as ActorMap });
  }

  const res = await apiRequest<unknown>(
    `/trpc/audit.actorNames?input=${encodeURIComponent(JSON.stringify({ userIds }))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) {
    return json({ ok: false as const, error: 'Failed to resolve actor names', actorNames: {} as ActorMap });
  }

  const actorNames =
    (res.data as { result?: { data?: ActorMap } })?.result?.data ?? ({} as ActorMap);

  return json({ ok: true as const, actorNames });
}

