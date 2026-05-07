import { useLoaderData } from '@remix-run/react';
import { json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import {
  apiRequest,
  getSessionCookie,
  requireStaffAccountsAccess,
  safeStatus,
  USER_WRITE_ACTION_TIMEOUT_MS,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { extractTrpc } from '~/lib/trpc-extract.server';
import { canEditUser } from '~/lib/rbac';
import { UserCreatePage, type EditingUser } from '~/features/users/UserCreatePage';
import type {
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserCreateBranch,
  UserCreateLoaderData,
  ActiveHeadUser,
  RoleTemplateOption,
  PermissionCatalogItem,
  UserDetail,
} from '~/features/users/types';

export const meta: MetaFunction = () => [{ title: 'Edit User — Yannis EOSE' }];

// ─── Loader ─────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireStaffAccountsAccess(request);
  const cookie = getSessionCookie(request);
  const userId = params['id'];

  if (!userId) {
    throw new Response('User ID required', { status: 400 });
  }

  const productsInput = encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));
  const userInput = encodeURIComponent(JSON.stringify({ userId }));
  const matrixInput = encodeURIComponent(JSON.stringify({ userId, intent: 'edit_matrix' }));

  const [
    userRes,
    productsRes,
    locationsRes,
    plansRes,
    branchesRes,
    activeHeadsRes,
    templatesRes,
    permissionCatalogRes,
    templateBaselinesRes,
    matrixRes,
  ] = await Promise.all([
    apiRequest<unknown>(`/trpc/users.getById?input=${userInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/products.options?input=${productsInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/logistics.locationOptions?input=${locationsInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/hr.listPlans?input=${plansInput}`, { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/users.listActiveHeads', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/roleTemplates.list', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/permissions.listCatalog', { method: 'GET', cookie }),
    apiRequest<unknown>('/trpc/permissions.listTemplateBaselines', { method: 'GET', cookie }),
    apiRequest<unknown>(`/trpc/permissions.getUserMatrix?input=${matrixInput}`, { method: 'GET', cookie }),
  ]);

  if (!userRes.ok) {
    throw new Response('User not found', { status: 404 });
  }
  const userPayload = userRes.data as { result?: { data?: UserDetail } };
  const user = userPayload?.result?.data;
  if (!user) {
    throw new Response('User not found', { status: 404 });
  }

  // Admin-level accounts can't be edited from this page (mirrors `intent === 'update'` gate
  // on the detail-route action). 403 — same surface as the action would return.
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    throw new Response('SuperAdmin/Admin accounts cannot be updated from this page.', { status: 403 });
  }

  // Per-target edit-access gate. `requireStaffAccountsAccess` only checks
  // "can the viewer manage staff at all" — it admits a HoCS even when the
  // target is a Media Buyer (out of their scope). `canEditUser` is the
  // canonical "can THIS viewer edit THIS target" check; mirrors the
  // service-layer guard in users.service.ts so the 403 fires up-front
  // instead of after the user fills the form. See CLAUDE.md / RBAC.
  const accessLevel = canEditUser(viewer, {
    id: user.id,
    role: user.role,
    primaryBranchId: user.primaryBranchId ?? null,
  });
  if (accessLevel === 'none') {
    throw new Response(
      'You do not have permission to edit this user. Contact an administrator if this is unexpected.',
      { status: 403 },
    );
  }

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

  // Use the shared `extractTrpc` helper (same one the detail-page loader uses
  // via `parseMatrix`) so we handle both tRPC response shapes — direct
  // `result.data.userOverrides` AND the `result.data.json.userOverrides`
  // variant. Manual indexing missed the wrapped shape and produced an empty
  // override map, which is why saved permission edits weren't pre-checking
  // when the user came back to the edit page.
  // TEMPORARY: log the resolved overrides count so we can confirm the fix
  // landed in production. Drop after a few good cycles.
  const matrixExtracted = extractTrpc<{
    userOverrides?: Record<string, boolean>;
    templateCodes?: string[];
    effectiveCodes?: string[];
  }>(matrixRes, {});
  const permissionOverrides = matrixExtracted.userOverrides ?? {};
  // eslint-disable-next-line no-console
  console.log('[loader/hr.users.$id.edit] getUserMatrix → overrides count:', Object.keys(permissionOverrides).length, 'matrixOk:', matrixRes.ok);

  const editingUser: EditingUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    status: user.status,
    capacity: user.capacity ?? null,
    logisticsLocationId: user.logisticsLocationId ?? null,
    productIds: user.assignedProductIds ?? [],
    restrictProductAccess: user.restrictProductAccess ?? false,
    primaryBranchId: user.primaryBranchId ?? null,
    branchIds: (user.branchMemberships ?? []).map((m) => m.branchId),
    roleTemplateId: user.roleTemplateId ?? null,
    permissionOverrides,
  };

  const formData: UserCreateLoaderData = {
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
    // Editing — no auto-fill default needed.
    defaultMembershipBranchId: null,
  };

  return { formData, editingUser };
}

// ─── Action ─────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const userId = params['id'];
  const intent = formData.get('intent')?.toString();

  if (!userId) {
    return json({ error: 'User ID required' }, { status: 400 });
  }

  // Re-stamp permissions — mirrors the same intent on the user-detail route so
  // operators can fix a stale snapshot without leaving the edit page. Idempotent:
  // safe to click on a healthy user (delta is zero).
  if (intent === 'restampPermissions') {
    const res = await apiRequest<unknown>('/trpc/users.restampPermissions', {
      method: 'POST', cookie, body: { userId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to re-stamp permissions') },
        { status: safeStatus(res.status) },
      );
    }
    const payload = (res.data as { result?: { data?: { stampedGranted: number; stampedRevoked: number; templateBaselineCount: number } } })?.result?.data;
    return json({
      success: true,
      message: payload
        ? `Re-stamped: ${payload.stampedGranted} granted, ${payload.stampedRevoked} revoked (template baseline ${payload.templateBaselineCount} codes)`
        : 'Permissions re-stamped',
    });
  }

  // Fetch the current target so we only send fields that actually changed
  // (mirrors the diff logic in the detail-route `intent === 'update'` branch).
  const targetRes = await apiRequest<unknown>(
    `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie },
  );
  if (!targetRes.ok) {
    return json({ error: 'User not found' }, { status: 404 });
  }
  const targetPayload = targetRes.data as {
    result?: {
      data?: {
        role: string;
        name: string;
        email: string;
        status: string;
        capacity: number;
        logisticsLocationId: string | null;
        restrictProductAccess: boolean;
        assignedProductIds?: string[];
        branchMemberships?: Array<{ branchId: string }>;
        primaryBranchId?: string | null;
        roleTemplateId?: string | null;
      };
    };
  };
  const target = targetPayload?.result?.data;
  if (!target) {
    return json({ error: 'User not found' }, { status: 404 });
  }
  if (target.role === 'SUPER_ADMIN' || target.role === 'ADMIN') {
    return json(
      { error: 'SuperAdmin/Admin accounts cannot be updated from this page. Use Settings to edit your own profile.' },
      { status: 403 },
    );
  }

  const body: Record<string, unknown> = { userId };
  const prevAssignedKey = [...(target.assignedProductIds ?? [])].sort().join('\0');
  const prevBranchIdsKey = [...(target.branchMemberships ?? []).map((membership) => membership.branchId)].sort().join('\0');

  const name = formData.get('name')?.toString().trim() ?? '';
  if (name.length >= 2 && name !== target.name) {
    body.name = name;
  }

  const email = formData.get('email')?.toString().trim() ?? '';
  if (email.length > 0 && email.toLowerCase() !== target.email.toLowerCase()) {
    body.email = email;
  }

  const role = formData.get('role')?.toString();
  if (role && role !== target.role) {
    body.role = role;
  }

  const roleTemplateId = formData.get('roleTemplateId')?.toString() ?? '';
  const nextTemplate = roleTemplateId || null;
  if (nextTemplate !== (target.roleTemplateId ?? null)) {
    body.roleTemplateId = nextTemplate;
  }

  const status = formData.get('status')?.toString();
  if (status && status !== target.status) {
    body.status = status;
  }

  const capacityStr = formData.get('capacity')?.toString();
  if (capacityStr !== undefined && capacityStr !== '') {
    const capacity = parseInt(capacityStr, 10);
    if (!Number.isNaN(capacity) && capacity !== target.capacity) {
      body.capacity = capacity;
    }
  }

  if (formData.has('logisticsLocationId')) {
    const raw = formData.get('logisticsLocationId')?.toString() ?? '';
    const next = raw || null;
    const prev = target.logisticsLocationId ?? null;
    if (next !== prev) {
      body.logisticsLocationId = next;
    }
  }

  const phone = formData.get('phone')?.toString().trim() ?? '';
  if (phone.length > 0) {
    body.phone = phone;
  }

  const productIdsStr = formData.get('productIds')?.toString();
  if (productIdsStr) {
    try {
      const ids = JSON.parse(productIdsStr) as unknown;
      if (Array.isArray(ids) && ids.every((id): id is string => typeof id === 'string')) {
        const nextAssignedKey = [...ids].sort().join('\0');
        if (nextAssignedKey !== prevAssignedKey) {
          body.productIds = ids;
        }
        const submittedRestrict =
          formData.get('restrictProductAccess') === 'true' ||
          formData.get('restrictProductAccess') === 'on';
        if (submittedRestrict !== target.restrictProductAccess) {
          body.restrictProductAccess = submittedRestrict;
        }
      }
    } catch {
      /* invalid productIds JSON */
    }
  }

  if (formData.has('branchIds')) {
    const branchIdsRaw = formData.get('branchIds')?.toString() ?? '';
    try {
      const parsed = JSON.parse(branchIdsRaw) as unknown;
      if (Array.isArray(parsed) && parsed.every((id): id is string => typeof id === 'string')) {
        const nextBranchIds = [...new Set(parsed)];
        const nextBranchIdsKey = [...nextBranchIds].sort().join('\0');
        if (nextBranchIdsKey !== prevBranchIdsKey) {
          body.branchIds = nextBranchIds;
        }
      }
    } catch {
      // ignore malformed branchIds payload
    }
  }
  if (formData.has('primaryBranchId')) {
    const primaryBranchId = formData.get('primaryBranchId')?.toString() ?? '';
    const nextPrimary = primaryBranchId || null;
    const prevPrimary = target.primaryBranchId ?? null;
    if (nextPrimary !== prevPrimary && nextPrimary) {
      body.primaryBranchId = nextPrimary;
    }
  }

  if (formData.has('permissionOverrides')) {
    const raw = formData.get('permissionOverrides')?.toString() ?? '';
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body.permissionOverrides = parsed;
        }
      } catch {
        // ignore malformed overrides payload
      }
    }
  }

  const changedKeys = Object.keys(body).filter((k) => k !== 'userId');
  if (changedKeys.length === 0) {
    return redirect(`/hr/users/${userId}`);
  }

  const res = await apiRequest<unknown>('/trpc/users.update', {
    method: 'POST',
    cookie,
    body,
    timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
  });

  if (!res.ok) {
    return json(
      { error: extractApiErrorMessage(res.data, 'Failed to update user') },
      { status: safeStatus(res.status) },
    );
  }

  return redirect(`/hr/users/${userId}`);
}

// ─── Component ──────────────────────────────────────────

export default function EditUserRoute() {
  const { formData, editingUser } = useLoaderData<typeof loader>();
  return <UserCreatePage {...formData} editingUser={editingUser} />;
}
