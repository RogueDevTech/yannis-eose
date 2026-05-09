import { useLoaderData, Await } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Suspense } from 'react';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  ensureBranchScopeOrRedirect,
  getSessionCookie,
  requireStaffAccountsAccess,
  safeStatus,
  USER_WRITE_ACTION_TIMEOUT_MS,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { UserCreatePage } from '~/features/users/UserCreatePage';
import { UserCreateEditLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import type {
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserCreateBranch,
  UserCreateLoaderData,
  ActiveHeadUser,
  RoleTemplateOption,
  PermissionCatalogItem,
} from '~/features/users/types';

export const meta: MetaFunction = () => [
  { title: 'Add User — Yannis EOSE' },
];

// ─── Loader ─────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireStaffAccountsAccess(request);
  // Pre-flight branch picker safety net — see ensureBranchScopeOrRedirect docs.
  // This route is shared between /hr/users/new and /admin/finance/staff-accounts/new
  // (they both use the same module). We fall back to /hr/users for org-wide heads.
  const guard = ensureBranchScopeOrRedirect(request, viewer, '/hr/users');
  if (guard) return guard;
  const cookie = getSessionCookie(request);

  const pageData = (async (): Promise<UserCreateLoaderData> => {
  const productsInput = encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));

  const [productsRes, locationsRes, plansRes, branchesRes, activeHeadsRes, templatesRes, permissionCatalogRes, templateBaselinesRes] =
    await Promise.all([
    apiRequest<unknown>(`/trpc/products.options?input=${productsInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/logistics.locationOptions?input=${locationsInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/hr.listPlans?input=${plansInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/users.listActiveHeads', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/roleTemplates.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/permissions.listCatalog', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/permissions.listTemplateBaselines', { method: 'GET', cookie }),
  ]);

  const extractData = (res: { ok: boolean; data: unknown }, key: string) => {
    if (!res.ok) return [];
    const d = res.data as Record<string, unknown>;
    const result = d?.result as Record<string, unknown> | undefined;
    const data = result?.data as Record<string, unknown> | undefined;
    return (data?.[key] as unknown[]) ?? [];
  };

  /** Same SYSTEM templates as `roleTemplates.list`, returned when staff has baselines but list failed (defensive). */
  const roleTemplatesFromBaselines = (): RoleTemplateOption[] => {
    if (!templateBaselinesRes.ok) return [];
    const rows =
      (
        templateBaselinesRes.data as {
          result?: { data?: { templates?: Array<{ id: string; key: string; name: string; kind: string; mappedRole: string | null }> } };
        }
      )?.result?.data?.templates ?? [];
    return rows.map((t) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      kind: t.kind,
      mappedRole: t.mappedRole ?? null,
    }));
  };

  let roleTemplates = templatesRes.ok
    ? (((templatesRes.data as { result?: { data?: { templates?: RoleTemplateOption[] } } })?.result?.data?.templates) ??
        [])
    : [];
  if (roleTemplates.length === 0) {
    roleTemplates = roleTemplatesFromBaselines();
  }
  const permissionCatalog = permissionCatalogRes.ok
    ? (((permissionCatalogRes.data as { result?: { data?: { permissions?: PermissionCatalogItem[] } } })?.result?.data?.permissions) ??
        [])
    : [];
  const templatePermissionsById = templateBaselinesRes.ok
    ? (((templateBaselinesRes.data as { result?: { data?: { byTemplateId?: Record<string, string[]> } } })?.result?.data?.byTemplateId) ??
        {})
    : {};

  const branches = ((branchesRes.ok
    ? (branchesRes.data as { result?: { data?: unknown[] } })?.result?.data
    : []) ?? []) as UserCreateBranch[];

  const activeBranchIds = new Set(branches.filter((b) => b.status === 'ACTIVE').map((b) => b.id));
  const sessionBranchId = viewer.currentBranchId ?? null;
  let defaultMembershipBranchId: string | null = null;
  if (sessionBranchId && activeBranchIds.has(sessionBranchId)) {
    defaultMembershipBranchId = sessionBranchId;
  } else if (activeBranchIds.size === 1) {
    defaultMembershipBranchId = [...activeBranchIds][0] ?? null;
  }

  return {
    products: extractData(productsRes, 'products') as UserCreateProduct[],
    locations: (extractData(locationsRes, 'locations') as Array<{ id: string; name: string; address: string; providerName?: string | null }>).map(
      (l) => ({ id: l.id, name: l.name, address: l.address, providerName: l.providerName ?? null }),
    ) as UserCreateLocation[],
    plans: extractData(plansRes, 'plans') as UserCreateCommissionPlan[],
    branches,
    activeHeads: ((activeHeadsRes.ok
      ? (activeHeadsRes.data as { result?: { data?: unknown[] } })?.result?.data
      : []) ?? []) as ActiveHeadUser[],
    roleTemplates,
    permissionCatalog,
    templatePermissionsById,
    defaultMembershipBranchId,
  };
  })();

  return defer({ pageData });
}

// `clientLoader` cache — once the form has been opened and its 8 picklists
// (products, locations, plans, branches, role templates, permissions catalog,
// active heads, template baselines) have resolved on first visit, every
// subsequent visit within the 5-min TTL skips the server roundtrip entirely
// and renders the full form on the same React tick as the click. Refactoring
// the form itself to pure App Shell (each picklist independent) is a bigger
// surgery — caching gets us the instant-revisit win without that risk.
export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

// ─── Action ─────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();

  // Section 1: Account
  const name = formData.get('name')?.toString() ?? '';
  const email = formData.get('email')?.toString() ?? '';
  const role = formData.get('role')?.toString() ?? '';
  const status = formData.get('status')?.toString() ?? 'ACTIVE';
  const primaryBranchId = formData.get('primaryBranchId')?.toString() || undefined;
  const branchIdsStr = formData.get('branchIds')?.toString();
  const roleTemplateId = formData.get('roleTemplateId')?.toString() || undefined;

  if (!name || !email || !role) {
    return json({ error: 'Name, email, and role are required' }, { status: 400 });
  }

  // Section 2: Role-specific
  const capacityStr = formData.get('capacity')?.toString();
  const logisticsLocationId = formData.get('logisticsLocationId')?.toString() || undefined;
  const productIdsStr = formData.get('productIds')?.toString();
  const restrictProductAccess = formData.get('restrictProductAccess') === 'true';

  // Section 3: Compensation
  const commissionPlanId = formData.get('commissionPlanId')?.toString() || undefined;
  const fixedSalaryStr = formData.get('fixedSalary')?.toString();
  const bonusStr = formData.get('bonus')?.toString();
  const commissionType = formData.get('commissionType')?.toString() || undefined;
  const commissionValueStr = formData.get('commissionValue')?.toString();
  const upsellCommissionType = formData.get('upsellCommissionType')?.toString() || undefined;
  const upsellCommissionValueStr = formData.get('upsellCommissionValue')?.toString();
  const salesTargetEnabled = formData.get('salesTargetEnabled') === 'true';
  const salesTargetPercentageStr = formData.get('salesTargetPercentage')?.toString();

  // Section 4: Contact
  const phone = formData.get('phone')?.toString() || undefined;

  // Probation flag — server-side eligibility check (PROBATION_INELIGIBLE_ROLES) rejects
  // ADMIN / SUPER_ADMIN. Default review window is 90 days.
  const isProbation = formData.get('isProbation') === 'true';
  const probationUntilStr = formData.get('probationUntil')?.toString().trim();

  const permissionOverridesRaw = formData.get('permissionOverrides')?.toString();

  // Build request body (password is auto-generated on the backend)
  const body: Record<string, unknown> = {
    name, email, role, status,
    phone,
    restrictProductAccess,
    primaryBranchId,
    branchIds: [],
    roleTemplateId,
  };

  if (capacityStr) body.capacity = parseInt(capacityStr, 10) || 10;
  if (logisticsLocationId) body.logisticsLocationId = logisticsLocationId;
  if (isProbation) {
    body.isProbation = true;
    if (probationUntilStr) body.probationUntil = probationUntilStr;
  }
  try {
    if (productIdsStr) body.productIds = JSON.parse(productIdsStr);
  } catch {
    // ignore invalid JSON
  }
  if (commissionPlanId) body.commissionPlanId = commissionPlanId;
  try {
    if (branchIdsStr) body.branchIds = JSON.parse(branchIdsStr);
  } catch {
    // ignore invalid JSON
  }
  if (permissionOverridesRaw) {
    try {
      const parsed = JSON.parse(permissionOverridesRaw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body.permissionOverrides = parsed;
      }
    } catch {
      // ignore malformed overrides payload
    }
  }

  // Build inline compensation if any values were provided (and no existing plan selected)
  const hasCompensation = fixedSalaryStr || bonusStr || commissionValueStr || upsellCommissionValueStr;
  if (hasCompensation && !commissionPlanId) {
    body.compensation = {
      fixedSalary: fixedSalaryStr ? parseFloat(fixedSalaryStr) : undefined,
      bonus: bonusStr ? parseFloat(bonusStr) : undefined,
      commissionType: commissionType as 'FLAT' | 'PERCENTAGE' | undefined,
      commissionValue: commissionValueStr ? parseFloat(commissionValueStr) : undefined,
      upsellCommissionType: upsellCommissionType as 'FLAT' | 'PERCENTAGE' | undefined,
      upsellCommissionValue: upsellCommissionValueStr ? parseFloat(upsellCommissionValueStr) : undefined,
      salesTargetEnabled,
      salesTargetPercentage: salesTargetPercentageStr ? parseFloat(salesTargetPercentageStr) : undefined,
    };
  }

  const cookie = getSessionCookie(request);
  const res = await apiRequest<unknown>('/trpc/users.create', {
    method: 'POST',
    cookie,
    body,
    timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
  });

  if (!res.ok) {
    // Use the shared extractor — handles tRPC v11's `error.json.message`
    // wrapping that the previous inline reader missed (and was falling back
    // to "Failed to create user" for every error).
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to create user') },
      { status: safeStatus(res.status) },
    );
  }

  const resultData = res.data as { result?: { data?: Record<string, unknown> } };
  const data = resultData?.result?.data;
  if (data && (data as { requiresApproval?: boolean }).requiresApproval) {
    const payload = data as { requiresApproval: boolean; requestId?: string; message?: string };
    return json({
      success: true,
      requiresApproval: true,
      requestId: payload.requestId,
      message: payload.message ?? 'User creation request submitted. SuperAdmin will review.',
    });
  }

  return redirect('/hr/users');
}

// ─── Component ──────────────────────────────────────────

export default function NewUserRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <Suspense fallback={<UserCreateEditLoadingShell mode="create" />}>
      <Await resolve={pageData}>
        {(data) => <UserCreatePage {...data} />}
      </Await>
    </Suspense>
  );
}
