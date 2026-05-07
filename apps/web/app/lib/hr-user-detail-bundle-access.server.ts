import { json } from '@remix-run/node';
import {
  apiRequest,
  DEFERRED_LOADER_TIMEOUT_MS,
  getCurrentUser,
  getSessionCookie,
} from '~/lib/api.server';
import { actorUserIdsMatch } from '~/lib/rbac';
import type { UserDetail } from '~/features/users/types';

export async function authorizeUserDetailBundle(request: Request, userId: string) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return { ok: false as const, response: json({ ok: false as const, error: 'Not authenticated' }) };
  }
  const cookie = getSessionCookie(request);
  const userRes = await apiRequest<unknown>(
    `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );
  if (!userRes.ok) {
    return { ok: false as const, response: json({ ok: false as const, error: 'User not found' }) };
  }
  const profileUser =
    (userRes.data as { result?: { data?: UserDetail } })?.result?.data ?? null;
  if (!profileUser) {
    return { ok: false as const, response: json({ ok: false as const, error: 'User not found' }) };
  }

  const isSelfView =
    actorUserIdsMatch(currentUser.id, profileUser.id) || actorUserIdsMatch(currentUser.id, userId);
  const headOfCSViewingTeam =
    currentUser.role === 'HEAD_OF_CS' && ['CS_AGENT', 'HEAD_OF_CS'].includes(profileUser.role);
  const headOfMarketingViewingTeam =
    currentUser.role === 'HEAD_OF_MARKETING' &&
    ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(profileUser.role);
  const isHoMOrHoCS =
    currentUser.role === 'HEAD_OF_MARKETING' || currentUser.role === 'HEAD_OF_CS';

  if (!isSelfView && isHoMOrHoCS && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    return {
      ok: false as const,
      response: json({ ok: false as const, error: 'This user is not on your team.' }, { status: 403 }),
    };
  }

  return { ok: true as const, currentUser, profileUser, cookie };
}
