import { Suspense } from 'react';
import { Await, Link, useLoaderData } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { cachedClientLoader } from '~/lib/loader-cache';
import { UserCreateEditLoadingShell } from '~/features/hr/HRDeferredLoadingShells';
import {
  apiRequest,
  ensureBranchScopeOrRedirect,
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
  const userId = params['id'];

  if (!userId) {
    throw new Response('User ID required', { status: 400 });
  }
  // Pre-flight branch picker safety net — see ensureBranchScopeOrRedirect docs.
  // Fall back to the user's profile so the modal opens with full context, and
  // switching branch lands the org-wide head right back on /:id/edit.
  const guard = ensureBranchScopeOrRedirect(request, viewer, `/hr/users/${userId}`);
  if (guard) return guard;
  const cookie = getSessionCookie(request);

  // App Shell pattern — fetch user + matrix sync (needed for current values +
  // auth gate). Defer all 8 picklists.
  const productsInput = encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ status: 'ACTIVE' }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));
  const userInput = encodeURIComponent(JSON.stringify({ userId }));
  const matrixInput = encodeURIComponent(JSON.stringify({ userId, intent: 'edit_matrix' }));

  // Kick off ALL fetches in parallel — sync block awaits user + matrix; the
  // rest become the deferred picklists promise.
  const userResP = apiRequest<unknown>(`/trpc/users.getById?input=${userInput}`, { method: 'GET', cookie });
  const productsResP = apiRequest<unknown>(`/trpc/products.options?input=${productsInput}`, { method: 'GET', cookie });
  const locationsResP = apiRequest<unknown>(`/trpc/logistics.locationOptions?input=${locationsInput}`, { method: 'GET', cookie });
  const plansResP = apiRequest<unknown>(`/trpc/hr.listPlans?input=${plansInput}`, { method: 'GET', cookie });
  // SuperAdmin sees all branches (all groups) so they can reassign users across companies.
  const isAdminViewer = viewer.role === 'SUPER_ADMIN' || viewer.role === 'ADMIN';
  const branchesEndpoint = isAdminViewer ? '/trpc/branches.listAll' : '/trpc/branches.list';
  const branchesResP = apiRequest<unknown>(branchesEndpoint, { method: 'GET', cookie });
  const branchGroupsResP = isAdminViewer
    ? apiRequest<unknown>('/trpc/branches.listGroups', { method: 'GET', cookie })
    : Promise.resolve({ ok: true, data: { result: { data: [] } } } as { ok: boolean; data: unknown });
  const activeHeadsResP = apiRequest<unknown>('/trpc/users.listActiveHeads', { method: 'GET', cookie });
  const templatesResP = apiRequest<unknown>('/trpc/roleTemplates.list', { method: 'GET', cookie });
  const permissionCatalogResP = apiRequest<unknown>('/trpc/permissions.listCatalog', { method: 'GET', cookie });
  const templateBaselinesResP = apiRequest<unknown>('/trpc/permissions.listTemplateBaselines', { method: 'GET', cookie });
  const matrixResP = apiRequest<unknown>(`/trpc/permissions.getUserMatrix?input=${matrixInput}`, { method: 'GET', cookie });

  // App Shell pattern — defer the editingUser fetch + auth gate too so the
  // route mounts INSTANTLY with the form chrome (page header, breadcrumb,
  // section headings, field labels). `editingUserPromise` resolves to either
  // the user record OR a tagged error so the page-level <Await> can render
  // the appropriate state without waiting at the loader.
  const editingUserPromise: Promise<
    | { kind: 'ok'; editingUser: EditingUser }
    | { kind: 'notFound' }
    | { kind: 'forbidden'; message: string }
  > = (async () => {
    const [userRes, matrixRes] = await Promise.all([userResP, matrixResP]);

    if (!userRes.ok) return { kind: 'notFound' };
    const userPayload = userRes.data as { result?: { data?: UserDetail } };
    const user = userPayload?.result?.data;
    if (!user) return { kind: 'notFound' };

    // Per-target edit-access gate — canEditUser is the single source of truth
    // for who can reach this form on which target. SuperAdmin can edit anyone
    // directly; HR_MANAGER can edit anyone but admin-class updates queue as a
    // permission_request (CEO directive 2026-05-11). Mirrors the service-layer
    // guard in users.service.ts.
    const accessLevel = canEditUser(viewer, {
      id: user.id,
      role: user.role,
      primaryBranchId: user.primaryBranchId ?? null,
    });
    if (accessLevel === 'none') {
      return {
        kind: 'forbidden',
        message:
          'You do not have permission to edit this user. Contact an administrator if this is unexpected.',
      };
    }

    const matrixExtracted = extractTrpc<{
      userOverrides?: Record<string, boolean>;
      templateCodes?: string[];
      effectiveCodes?: string[];
    }>(matrixRes, {});
    const permissionOverrides = matrixExtracted.userOverrides ?? {};

    // Build per-group primary map from membership data
    const primaryBranchByGroup: Record<string, string> = {};
    for (const m of user.branchMemberships ?? []) {
      if (m.isPrimary && m.groupId) {
        primaryBranchByGroup[m.groupId] = m.branchId;
      }
    }
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
      primaryBranchByGroup: Object.keys(primaryBranchByGroup).length > 0 ? primaryBranchByGroup : undefined,
      branchIds: (user.branchMemberships ?? []).map((m) => m.branchId),
      roleTemplateId: user.roleTemplateId ?? null,
      permissionOverrides,
    };
    return { kind: 'ok', editingUser };
  })();

  // Deferred picklists — the form chrome (current values + auth gate) renders
  // immediately above; only the dropdowns/sections driven by this data wait.
  const picklistsPromise: Promise<UserCreateLoaderData> = (async () => {
    const [productsRes, locationsRes, plansRes, branchesRes, branchGroupsRes, activeHeadsRes, templatesRes, permissionCatalogRes, templateBaselinesRes] =
      await Promise.all([
        productsResP,
        locationsResP,
        plansResP,
        branchesResP,
        branchGroupsResP,
        activeHeadsResP,
        templatesResP,
        permissionCatalogResP,
        templateBaselinesResP,
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

    const branchGroups = ((branchGroupsRes.ok
      ? (branchGroupsRes.data as { result?: { data?: unknown[] } })?.result?.data
      : []) ?? []) as Array<{ id: string; name: string; status?: string }>;

    return {
      products: extractData(productsRes, 'products') as UserCreateProduct[],
      locations: (extractData(locationsRes, 'locations') as Array<{ id: string; name: string; address: string; providerName?: string | null }>).map(
        (l) => ({ id: l.id, name: l.name, address: l.address, providerName: l.providerName ?? null }),
      ) as UserCreateLocation[],
      plans: extractData(plansRes, 'plans') as UserCreateCommissionPlan[],
      branches,
      branchGroups,
      activeHeads: ((activeHeadsRes.ok
        ? (activeHeadsRes.data as { result?: { data?: unknown[] } })?.result?.data
        : []) ?? []) as ActiveHeadUser[],
      roleTemplates,
      permissionCatalog,
      templatePermissionsById,
      // Editing — no auto-fill default needed.
      defaultMembershipBranchId: null,
      viewerRole: viewer.role,
    };
  })();

  return defer({ editingUserPromise, picklistsPromise });
}

// `clientLoader` cache — same surgery as `hr.users.new`. The form has 8
// picklist dependencies (commission plan editor, branch matrix, role-template
// baseline, permission overrides preview), so the App Shell refactor is its
// own project. The cache makes every revisit (within 5 min) instant — no
// fetch, no skeleton, all current values are pre-populated.
export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

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

  // Reset permissions to role defaults — strips ALL per-user overrides.
  if (intent === 'resetPermissionsToDefaults') {
    const res = await apiRequest<unknown>('/trpc/users.resetPermissionsToDefaults', {
      method: 'POST', cookie, body: { userId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reset permissions') },
        { status: safeStatus(res.status) },
      );
    }
    const payload = (res.data as { result?: { data?: { templateBaselineCount: number } } })?.result?.data;
    return json({
      success: true,
      message: payload
        ? `Permissions reset to role defaults (${payload.templateBaselineCount} codes from template)`
        : 'Permissions reset to role defaults',
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
  // Admin-class targets: the service layer decides. SuperAdmin applies the
  // update directly; HR_MANAGER's changes queue as a permission_request for
  // SuperAdmin approval. Everyone else is rejected by canEditUser before
  // reaching here. Don't gate at the action level — let the service speak.

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
  if (formData.has('primaryBranchByGroup')) {
    try {
      const parsed = JSON.parse(formData.get('primaryBranchByGroup')?.toString() ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        (body as Record<string, unknown>).primaryBranchByGroup = parsed;
      }
    } catch {
      // ignore malformed payload
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

  // HR edits on admin-class targets queue as a SuperAdmin approval request —
  // the service returns `{ requiresApproval: true, message }`. Surface it as
  // an info toast instead of silently redirecting back to the detail page.
  const updatePayload = (res.data as {
    result?: { data?: { requiresApproval?: boolean; message?: string } };
  })?.result?.data;
  if (updatePayload?.requiresApproval) {
    return json({
      success: true,
      message: updatePayload.message ?? 'Edit submitted for SuperAdmin approval.',
    });
  }

  return redirect(`/hr/users/${userId}`);
}

// ─── Component ──────────────────────────────────────────

export default function EditUserRoute() {
  const { editingUserPromise, picklistsPromise } = useLoaderData<typeof loader>();
  // App Shell — render the form chrome + skeleton inputs immediately while
  // editingUserPromise (user record + auth gate) and picklistsPromise (8
  // dropdown lists) resolve in parallel. Permission errors render as a
  // friendly card inside the page rather than throwing a route boundary.
  return (
    <Suspense fallback={<UserCreateEditLoadingShell mode="edit" />}>
      <Await resolve={editingUserPromise}>
        {(result) => {
          if (result.kind === 'notFound') {
            return (
              <div className="card text-center py-12">
                <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
                <h2 className="text-xl font-bold text-app-fg">User not found</h2>
                <p className="mt-2 text-sm text-app-fg-muted">
                  The user you&apos;re looking for doesn&apos;t exist or has been removed.
                </p>
                <Link to="/hr/users" className="btn-primary mt-4 inline-block">
                  Back to Users
                </Link>
              </div>
            );
          }
          if (result.kind === 'forbidden') {
            return (
              <div className="card text-center py-12">
                <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">403</p>
                <h2 className="text-xl font-bold text-app-fg">Access denied</h2>
                <p className="mt-2 text-sm text-app-fg-muted">{result.message}</p>
                <Link to="/hr/users" className="btn-primary mt-4 inline-block">
                  Back to Users
                </Link>
              </div>
            );
          }
          return (
            <UserCreatePage
              picklistsPromise={picklistsPromise}
              editingUser={result.editingUser}
            />
          );
        }}
      </Await>
    </Suspense>
  );
}
