import { useLoaderData } from '@remix-run/react';
import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { apiRequest, getSessionCookie, requireStaffAccountsAccess, safeStatus } from '~/lib/api.server';
import { UserCreatePage } from '~/features/users/UserCreatePage';
import type {
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserCreateBranch,
  UserCreateLoaderData,
  ActiveHeadUser,
  FinanceHatHolder,
  RoleTemplateOption,
  PermissionCatalogItem,
} from '~/features/users/types';

export const meta: MetaFunction = () => [
  { title: 'Add User — Yannis EOSE' },
];

// ─── Loader ─────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  await requireStaffAccountsAccess(request);
  const cookie = getSessionCookie(request);

  const productsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20 }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));

  const [productsRes, locationsRes, plansRes, branchesRes, activeHeadsRes, financeHolderRes, templatesRes, permissionCatalogRes, templateBaselinesRes] =
    await Promise.all([
    apiRequest<unknown>(`/trpc/products.list?input=${productsInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/logistics.listLocations?input=${locationsInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/hr.listPlans?input=${plansInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/users.listActiveHeads', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/users.getCurrentFinanceOfficer', { method: 'GET', cookie }),
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

  return {
    products: extractData(productsRes, 'products') as UserCreateProduct[],
    locations: extractData(locationsRes, 'locations') as UserCreateLocation[],
    plans: extractData(plansRes, 'plans') as UserCreateCommissionPlan[],
    branches: ((branchesRes.ok
      ? (branchesRes.data as { result?: { data?: unknown[] } })?.result?.data
      : []) ?? []) as UserCreateBranch[],
    activeHeads: ((activeHeadsRes.ok
      ? (activeHeadsRes.data as { result?: { data?: unknown[] } })?.result?.data
      : []) ?? []) as ActiveHeadUser[],
    currentFinanceOfficer: (financeHolderRes.ok
      ? (financeHolderRes.data as { result?: { data?: FinanceHatHolder | null } })?.result?.data ?? null
      : null) as FinanceHatHolder | null,
    roleTemplates,
    permissionCatalog,
    templatePermissionsById,
  };
}

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

  const isFinanceOfficer = formData.get('isFinanceOfficer') === 'true';
  const permissionOverridesRaw = formData.get('permissionOverrides')?.toString();

  // Build request body (password is auto-generated on the backend)
  const body: Record<string, unknown> = {
    name, email, role, status,
    phone,
    restrictProductAccess,
    primaryBranchId,
    branchIds: [],
    isFinanceOfficer,
    roleTemplateId,
  };

  if (capacityStr) body.capacity = parseInt(capacityStr, 10) || 10;
  if (logisticsLocationId) body.logisticsLocationId = logisticsLocationId;
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
    method: 'POST', cookie, body,
  });

  if (!res.ok) {
    const errorData = res.data as Record<string, unknown>;
    const errObj = errorData?.error as Record<string, unknown> | undefined;
    return json(
      { error: (errObj?.message as string) ?? 'Failed to create user' },
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
  const data = useLoaderData<typeof loader>() as UserCreateLoaderData;
  return <UserCreatePage {...data} />;
}
