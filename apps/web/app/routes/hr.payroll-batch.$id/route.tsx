import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';

const PAYROLL_VIEWER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'HR_MANAGER',
  'FINANCE_OFFICER',
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
];

/**
 * JSON-only data route — the Monthly Payrolls modal fetches batch detail from here
 * when it opens (or when a mutation succeeds and we need to re-render the panel).
 *
 * The backend authorizes per-viewer; this route just forwards the call.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissionOrRoles(request, { roles: PAYROLL_VIEWER_ROLES, permission: 'hr.read' });
  const cookie = getSessionCookie(request);
  const batchId = params['id'];
  if (!batchId) return json(null, { status: 400 });

  const res = await apiRequest<unknown>(
    `/trpc/hr.getBatch?input=${encodeURIComponent(JSON.stringify({ batchId }))}`,
    { method: 'GET', cookie },
  );
  if (!res.ok) return json(null, { status: res.status });
  const data = (res.data as { result?: { data?: unknown } })?.result?.data ?? null;
  return json(data);
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;
