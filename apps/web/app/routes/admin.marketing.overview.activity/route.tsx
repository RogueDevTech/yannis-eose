import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { canViewAllBranches } from '~/lib/rbac';

/**
 * Sibling endpoint for the Marketing Overview "Live activity" strip — mirrors the shape
 * of `/admin/cs/queue/carts` but uses marketing-scoped permission so MBs and HoM can
 * subscribe to live cart/order activity for their own funnel(s) without being granted
 * the broader `cart.read`. Backed by `cart.listActivity` which already accepts an OR of
 * `cart.read` / `marketing.read` (see apps/api/src/trpc/routers/cart.router.ts).
 *
 * Scoping rules (loader-side — also enforced server-side via the tRPC input):
 *   - MEDIA_BUYER → `mediaBuyerId = viewer.id`
 *   - admin-class / explicit global-scope holders → no scope (org-wide)
 *   - everyone else → `branchId = viewer.currentBranchId` (when set)
 */
type ActivityItem = {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  productName: string | null;
  offerLabel: string | null;
  cartStatus: 'PENDING' | 'ABANDONED' | 'CONVERTED' | null;
  orderStatus: string | null;
  linkedOrderId: string | null;
  totalAmount: string | null;
  updatedAt: string;
};

type ScopeInput = { limit: number; mediaBuyerId?: string; branchId?: string };

function buildScopeInput(user: {
  id: string;
  role: string;
  permissions?: string[];
  scopeOrgWideHead?: boolean;
  currentBranchId?: string | null;
}): ScopeInput {
  const limit = 60;
  // Media Buyers see their own funnel only — same MB filter the API runs internally.
  if (user.role === 'MEDIA_BUYER') {
    return { limit, mediaBuyerId: user.id };
  }
  // Admin-class or explicit global-scope holder — org-wide visibility, no filter.
  if (canViewAllBranches(user)) {
    return { limit };
  }
  // Otherwise scope to the viewer's active branch when set.
  if (user.currentBranchId) {
    return { limit, branchId: user.currentBranchId };
  }
  return { limit };
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Mirror /admin/marketing/overview's gate so anyone who can see the page can hit this endpoint.
  const user = await requirePermissionOrRoles(request, {
    roles: ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_MARKETING', 'MEDIA_BUYER'],
    permission: ['marketing.read', 'marketing.teamOverview'],
  });
  const cookie = getSessionCookie(request);

  const scopeInput = buildScopeInput(user as Parameters<typeof buildScopeInput>[0]);

  const res = await apiRequest<unknown>(
    `/trpc/cart.listActivity?input=${encodeURIComponent(JSON.stringify(scopeInput))}`,
    { method: 'GET', cookie },
  );

  const activityItems: ActivityItem[] = res.ok
    ? (res.data as { result?: { data?: ActivityItem[] } })?.result?.data ?? []
    : [];

  return json({ activityItems });
}

export default function AdminMarketingOverviewActivityRoute() {
  return null;
}
