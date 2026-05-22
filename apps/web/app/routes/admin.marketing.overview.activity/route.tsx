import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { apiRequest, getSessionCookie, requirePermissionOrRoles } from '~/lib/api.server';
import { canViewAllBranches } from '~/lib/rbac';

/**
 * Sibling endpoint for the Marketing Overview "Live activity" strip — mirrors the shape
 * of `/admin/sales/queue/carts` but uses marketing-scoped permission so MBs and HoM can
 * subscribe to live cart/order activity for their own funnel(s) without being granted
 * the broader `cart.read`. Backed by `cart.listActivity` which already accepts an OR of
 * `cart.read` / `marketing.read` (see apps/api/src/trpc/routers/cart.router.ts).
 *
 * Scoping rules (loader-side — also enforced server-side via the tRPC input):
 *   - Active branch wins when selected → `branchId = viewer.currentBranchId`
 *   - MEDIA_BUYER also keeps `mediaBuyerId = viewer.id`
 *   - admin-class / explicit global-scope holders with no selected branch → org-wide
 *   - everyone else with no active branch falls back to the current server-side rules
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
  // A plain Media Buyer sees ALL their own carts/orders across every branch
  // (the mediaBuyerId filter is itself an exact scope). Branch-scoping here
  // would undercount — same rationale as `marketingOrdersOverviewStripFor`.
  if (user.role === 'MEDIA_BUYER') {
    return { limit, mediaBuyerId: user.id };
  }
  // Selected branch should scope the live feed even for admin/global viewers.
  if (user.currentBranchId) {
    return { limit, branchId: user.currentBranchId };
  }
  // No selected branch: admin/global viewers keep org-wide visibility.
  if (canViewAllBranches(user)) {
    return { limit };
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
