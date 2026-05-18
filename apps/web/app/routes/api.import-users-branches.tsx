import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requireStaffAccountsAccess } from '~/lib/api.server';

/**
 * Branch picklist for the Users → Import users modal. The modal opens lazily, so this
 * resource route is only fetched on demand. ACTIVE branches only — inactive branches
 * shouldn't be a valid `primaryBranchId` target for new users.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireStaffAccountsAccess(request);
  const cookie = getSessionCookie(request);

  const res = await apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie });
  if (!res.ok) {
    return json({ branches: [] as unknown[] });
  }
  const data = res.data as {
    result?: { data?: Array<{ id: string; code: string; name: string; status: string }> };
  };
  const all = data?.result?.data ?? [];
  const active = all.filter((b) => b.status === 'ACTIVE');
  return json({ branches: active });
}
