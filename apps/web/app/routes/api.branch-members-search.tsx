import { json } from '@remix-run/node';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { apiRequest, getCurrentUser, getSessionCookie, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';

/**
 * Resource route for the branch detail page's Members panel.
 *
 * Usage from the panel:
 *   const fetcher = useFetcher<MembersSearchResponse>();
 *   fetcher.load(`/api/branch-members-search?branchId=${id}&q=${term}&page=1&limit=20`);
 *
 * Returns the same `members` shape as `branches.overview` so the existing
 * <BranchMembersPanel> render path consumes either source uniformly.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const branchId = url.searchParams.get('branchId')?.trim();
  if (!branchId || !/^[0-9a-f-]{32,36}$/i.test(branchId)) {
    return json({ error: 'branchId is required' }, { status: 400 });
  }
  const search = url.searchParams.get('q')?.trim() ?? undefined;
  const deptRaw = url.searchParams.get('department')?.trim();
  const department =
    deptRaw === 'MARKETING' || deptRaw === 'CS' || deptRaw === 'OTHER' ? deptRaw : undefined;
  const pageRaw = Number(url.searchParams.get('page') ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const limitRaw = Number(url.searchParams.get('limit') ?? '20');
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 20;

  const cookie = getSessionCookie(request);
  const input = encodeURIComponent(
    JSON.stringify({
      branchId,
      ...(search ? { search } : {}),
      ...(department ? { department } : {}),
      page,
      limit,
    }),
  );
  const res = await apiRequest<unknown>(
    `/trpc/branches.searchMembers?input=${input}`,
    { method: 'GET', cookie },
  );
  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Members search failed') },
      { status: safeStatus(res.status) },
    );
  }
  const payload = (res.data as { result?: { data?: unknown } })?.result?.data ?? null;
  return json({ data: payload });
}
