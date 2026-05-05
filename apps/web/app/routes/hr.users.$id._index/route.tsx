import { Await, useLoaderData } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import {
  apiRequest,
  getSessionCookie,
  HR_ONBOARDING_PAGE_PERMISSIONS,
  requireStaffAccountsAccess,
  getCurrentUser,
  safeStatus,
  DEFERRED_LOADER_TIMEOUT_MS,
  USER_WRITE_ACTION_TIMEOUT_MS,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { extractTrpc } from '~/lib/trpc-extract.server';
import { actorUserIdsMatch, canAccessGlobalAuditLog, canEditUser, isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Spinner } from '~/components/ui/spinner';
import { UserDetailPage } from '~/features/users/UserDetailPage';
import type {
  UserDetail,
  UserDetailLoaderData,
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserOrderSummary,
  UserPayoutRecord,
  UserAdjustment,
  UserAuditEntry,
  UserMarketingMetrics,
  PendingEmailChange,
  UserStockMovement,
  UserApprovalRecord,
  UserPushStatus,
  ActiveHeadUser,
  RoleTemplateOption,
  PermissionCatalogItem,
  UserOnboardingSummary,
  PermissionCatalogBundle,
} from '~/features/users/types';

export const meta: MetaFunction = () => [
  { title: 'User Detail — Yannis EOSE' },
];

// ─── Loader ─────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);

  const cookie = getSessionCookie(request);
  const userId = params['id'];

  if (!userId) {
    throw new Response('User ID required', { status: 400 });
  }

  // Fetch profile user first (getById is authed — any logged-in user can call)
  const userRes = await apiRequest<unknown>(
    `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  );
  if (!userRes.ok) {
    return defer({ userDetail: Promise.resolve({ notFound: true as const }) });
  }
  const trpcData = userRes.data as { result?: { data?: UserDetail } };
  const profileUser = trpcData?.result?.data;
  if (!profileUser) {
    return defer({ userDetail: Promise.resolve({ notFound: true as const }) });
  }

  // Access model for /hr/users/:id:
  //  - Self-view: any authenticated user may open their own profile (drives /admin/profile).
  //  - Head of CS  may view their CS team (CS_AGENT, HEAD_OF_CS) — nothing else.
  //  - Head of Marketing may view their Marketing team (MEDIA_BUYER, HEAD_OF_MARKETING) — nothing else.
  //  - Everyone else must hold `hr.read` (HR_MANAGER) or be admin-level.
  // HoM/HoCS still carry `users.read` globally for other features (team leaderboards, push
  // target search, etc.), so we can't just require `users.read` — we'd leak unrelated profiles.
  const isSelfView =
    actorUserIdsMatch(currentUser.id, profileUser.id) || actorUserIdsMatch(currentUser.id, userId);
  const headOfCSViewingTeam =
    currentUser.role === 'HEAD_OF_CS' && ['CS_AGENT', 'HEAD_OF_CS'].includes(profileUser.role);
  const headOfMarketingViewingTeam =
    currentUser.role === 'HEAD_OF_MARKETING' && ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(profileUser.role);
  const isHoMOrHoCS = currentUser.role === 'HEAD_OF_MARKETING' || currentUser.role === 'HEAD_OF_CS';

  if (!isSelfView && isHoMOrHoCS && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    throw new Response('This user is not on your team.', { status: 403 });
  }
  if (!isSelfView && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    await requireStaffAccountsAccess(request);
  }

  const user = profileUser;

  const userDetailPromise = (async (): Promise<UserDetailLoaderData | { notFound: true }> => {
    const perms = currentUser?.permissions ?? [];
    // Treat ADMIN the same as SUPER_ADMIN for admin-level capabilities on this page.
    const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'ADMIN';
    const isViewerHeadOfMarketing = currentUser?.role === 'HEAD_OF_MARKETING';
    const isViewerHeadOfCS = currentUser?.role === 'HEAD_OF_CS';
    // Per-target edit access — single source of truth in rbac.ts (mirrored on
    // the API in common/authz.ts and re-checked in users.service.ts:1094-1148).
    //   'full'    → admin-class or HR_MANAGER on branch — can change any field.
    //   'limited' → team-lead supervised scope (HoCS over CS_AGENT, HoM over
    //               MEDIA_BUYER, same branch) — restricted whitelist.
    //   'none'    → cannot edit. Hides the "Edit user" link below.
    const editAccessLevel = canEditUser(currentUser, {
      id: profileUser.id,
      role: profileUser.role,
      primaryBranchId: profileUser.primaryBranchId ?? null,
    });
    const canEditLimited = editAccessLevel === 'limited';
    const canEditFull = editAccessLevel === 'full';
    // Disbursements page is Finance → HoM only; HoM distributes to Media Buyers from Marketing → Funding.
    const canDisburseToThisUser =
      user.role === 'HEAD_OF_MARKETING' && (isSuperAdmin || perms.includes('finance.disburse'));

    // ── Build role-specific order filter ───────────────────
    const orderFilter: Record<string, unknown> = { limit: 10 };
  if (['CS_AGENT', 'HEAD_OF_CS'].includes(user.role)) {
    orderFilter.csAgentId = userId;
  } else if (['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(user.role)) {
    orderFilter.mediaBuyerId = userId;
  } else if (['TPL_RIDER'].includes(user.role)) {
    orderFilter.riderId = userId;
  }

  // ── Deferred: all secondary data in parallel ───────────
  const productsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20, sortBy: 'name', sortOrder: 'asc' }));
  const locationsInput = encodeURIComponent(JSON.stringify({ page: 1, limit: 20 }));
  const plansInput = encodeURIComponent(JSON.stringify({ activeOnly: true }));

  const products: Promise<UserCreateProduct[]> = apiRequest<unknown>(
    `/trpc/products.list?input=${productsInput}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: { products: UserCreateProduct[] } } };
      return d?.result?.data?.products ?? [];
    })
    .catch(() => []);

  const roleTemplates: Promise<RoleTemplateOption[]> = apiRequest<unknown>(
    '/trpc/roleTemplates.list',
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: { templates?: RoleTemplateOption[] } } };
      return d?.result?.data?.templates ?? [];
    })
    .catch(() => []);

  const locations: Promise<UserCreateLocation[]> = apiRequest<unknown>(
    `/trpc/logistics.listLocations?input=${locationsInput}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      if (!res.ok) return [] as UserCreateLocation[];
      const d = res.data as { result?: { data?: { locations: Array<{ id: string; name: string; address: string; providerName?: string | null }> } } };
      const rows = d?.result?.data?.locations ?? [];
      return rows.map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        providerName: l.providerName ?? null,
      })) as UserCreateLocation[];
    })
    .catch(() => [] as UserCreateLocation[]);

  const plans: Promise<UserCreateCommissionPlan[]> = apiRequest<unknown>(
    `/trpc/hr.listPlans?input=${plansInput}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: { plans: UserCreateCommissionPlan[] } } };
      return d?.result?.data?.plans ?? [];
    })
    .catch(() => []);

  // Recent orders (role-aware) — skip for roles without order attribution
  const needsOrders = ['CS_AGENT', 'HEAD_OF_CS', 'MEDIA_BUYER', 'HEAD_OF_MARKETING', 'TPL_RIDER', 'HEAD_OF_LOGISTICS', 'TPL_MANAGER'].includes(user.role);
  const recentOrders: Promise<{ orders: UserOrderSummary[]; total: number }> = needsOrders
    ? apiRequest<unknown>(
        `/trpc/orders.list?input=${encodeURIComponent(JSON.stringify(orderFilter))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
      if (!res.ok) return { orders: [], total: 0 };
      const d = res.data as { result?: { data?: { orders: UserOrderSummary[]; pagination: { total: number } } } };
      return {
        orders: d?.result?.data?.orders ?? [],
        total: d?.result?.data?.pagination?.total ?? 0,
      };
        })
        .catch(() => ({ orders: [], total: 0 }))
    : Promise.resolve({ orders: [], total: 0 });

  // Payout history — skip for roles without payroll
  const needsPayouts = ['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'HEAD_OF_CS', 'CS_AGENT', 'TPL_RIDER', 'HR_MANAGER'].includes(user.role);
  const payouts: Promise<UserPayoutRecord[]> = needsPayouts
    ? apiRequest<unknown>(
        `/trpc/hr.listPayouts?input=${encodeURIComponent(JSON.stringify({ staffId: userId, limit: 10 }))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          if (!res.ok) return [];
          const d = res.data as { result?: { data?: { payouts: UserPayoutRecord[] } } };
          return d?.result?.data?.payouts ?? [];
        })
        .catch(() => [])
    : Promise.resolve([]);

  // Adjustments (bonuses/deductions)
  const adjustments: Promise<UserAdjustment[]> = apiRequest<unknown>(
    `/trpc/hr.listAdjustments?input=${encodeURIComponent(JSON.stringify({ staffId: userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: UserAdjustment[] } };
      return d?.result?.data ?? [];
    })
    .catch(() => []);

  // Audit trail (actions by this user) — same gate as global audit page.
  const auditLog: Promise<UserAuditEntry[]> = canAccessGlobalAuditLog(currentUser)
    ? apiRequest<unknown>(
        `/trpc/audit.globalLog?input=${encodeURIComponent(JSON.stringify({ actorId: userId, page: 1, limit: 20 }))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          if (!res.ok) return [];
          const d = res.data as {
            result?: {
              data?: {
                rows: Array<{
                  id: string;
                  action: string;
                  tableName: string;
                  recordId: string;
                  data: Record<string, unknown>;
                  validFrom: string;
                }>;
              };
            };
          };
          const rows = d?.result?.data?.rows ?? [];
          return rows.map((r) => ({
            id: r.id,
            action: r.action,
            tableName: r.tableName,
            recordId: r.recordId,
            oldValues: null,
            newValues: r.data,
            createdAt: r.validFrom,
            data: r.data,
          })) as UserAuditEntry[];
        })
        .catch(() => [])
    : Promise.resolve([]);

  // Marketing metrics (only for MEDIA_BUYER / HEAD_OF_MARKETING)
  const isMarketingRole = ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(user.role);
  const marketingMetrics: Promise<UserMarketingMetrics | null> = isMarketingRole
    ? apiRequest<unknown>(
        `/trpc/marketing.metrics?input=${encodeURIComponent(JSON.stringify({ mediaBuyerId: userId }))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          if (!res.ok) return null;
          const d = res.data as { result?: { data?: UserMarketingMetrics } };
          return d?.result?.data ?? null;
        })
        .catch(() => null)
    : Promise.resolve(null);

  // Funding balance (only for HEAD_OF_MARKETING / MEDIA_BUYER — recipients of disbursements)
  const fundingBalance: Promise<{ totalReceived: string; totalSpend: string; balance: string } | null> = isMarketingRole
    ? apiRequest<unknown>(
        `/trpc/marketing.getFundingBalance?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          if (!res.ok) return null;
          const d = res.data as { result?: { data?: { totalReceived: string; totalSpend: string; balance: string } } };
          return d?.result?.data ?? null;
        })
        .catch(() => null)
    : Promise.resolve(null);

  const pendingEmailChange: Promise<PendingEmailChange | null> = apiRequest<unknown>(
    `/trpc/users.getPendingEmailChange?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      if (!res.ok) return null;
      const d = res.data as { result?: { data?: PendingEmailChange | null } };
      return d?.result?.data ?? null;
    })
    .catch(() => null);

  // Stock movements (for STOCK_MANAGER, TPL_MANAGER, HEAD_OF_LOGISTICS)
  const isStockRole = ['STOCK_MANAGER', 'TPL_MANAGER', 'HEAD_OF_LOGISTICS'].includes(user.role);
  const stockMovements: Promise<{ movements: UserStockMovement[]; total: number }> | null = isStockRole
    ? apiRequest<unknown>(
        `/trpc/inventory.movements?input=${encodeURIComponent(JSON.stringify({ actorId: userId, page: 1, limit: 20 }))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          if (!res.ok) return { movements: [], total: 0 };
          const d = res.data as { result?: { data?: { movements: UserStockMovement[]; pagination: { total: number } } } };
          return {
            movements: d?.result?.data?.movements ?? [],
            total: d?.result?.data?.pagination?.total ?? 0,
          };
        })
        .catch(() => ({ movements: [], total: 0 }))
    : null;

  // Finance activity (approvals processed by this user — for FINANCE_OFFICER)
  const isFinanceRole = user.role === 'FINANCE_OFFICER';
  const financeActivity: Promise<{ approvals: UserApprovalRecord[]; total: number }> | null = isFinanceRole
    ? apiRequest<unknown>(
        `/trpc/finance.listApprovalRequests?input=${encodeURIComponent(JSON.stringify({ approverId: userId, page: 1, limit: 20 }))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          if (!res.ok) return { approvals: [], total: 0 };
          const d = res.data as { result?: { data?: { requests: Array<{ id: string; type: string; amount: string; description: string; status: string; approvedAt: string | null; createdAt: string }>; pagination: { total: number } } } };
          const requests = d?.result?.data?.requests ?? [];
          return {
            approvals: requests.map((r) => ({
              id: r.id,
              type: r.type,
              amount: r.amount,
              description: r.description,
              status: r.status,
              approvedAt: r.approvedAt,
              createdAt: r.createdAt,
            })),
            total: d?.result?.data?.pagination?.total ?? 0,
          };
        })
        .catch(() => ({ approvals: [], total: 0 }))
    : null;

  // Active HEAD_OF_* users so the edit form can warn about duplicate heads in the same branch.
  const activeHeads: Promise<ActiveHeadUser[]> = apiRequest<unknown>(
    '/trpc/users.listActiveHeads',
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      if (!res.ok) return [];
      const d = res.data as { result?: { data?: ActiveHeadUser[] } };
      return d?.result?.data ?? [];
    })
    .catch(() => []);

  // Active branches for the edit form's warning (to show branch name in the message).
  const branchesList: Promise<Array<{ id: string; name: string; code: string; status: string }>> =
    apiRequest<unknown>('/trpc/branches.list', { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS })
      .then((res) => {
        if (!res.ok) return [];
        const d = res.data as { result?: { data?: Array<{ id: string; name: string; code: string; status: string }> } };
        return d?.result?.data ?? [];
      })
      .catch(() => []);

  // Push notification status (SuperAdmin only — requires users.read permission)
  const pushStatus: Promise<UserPushStatus | null> = isSuperAdmin
    ? apiRequest<unknown>(
        `/trpc/notifications.getPushStatusForUser?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          if (!res.ok) return null;
          const d = res.data as { result?: { data?: UserPushStatus } };
          return d?.result?.data ?? null;
        })
        .catch(() => null)
    : Promise.resolve(null);

  const permissionCatalog: Promise<PermissionCatalogBundle> = apiRequest<unknown>(
    '/trpc/permissions.listCatalog',
    { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
  )
    .then((res) => {
      // TEMPORARY DEBUG — Media Buyer self-view shows "catalog did not load".
      // eslint-disable-next-line no-console
      console.log('[loader/permissions.listCatalog]', {
        userId,
        viewerRole: currentUser?.role,
        viewerId: currentUser?.id,
        ok: res.ok,
        status: res.status,
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.log('  → response:', JSON.stringify(res.data).slice(0, 300));
      }
      return {
        requestFailed: !res.ok,
        items: res.ok
          ? extractTrpc(res, { permissions: [] as PermissionCatalogItem[] }).permissions ?? []
          : [],
      };
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[loader/permissions.listCatalog] THREW', err);
      return { requestFailed: true, items: [] as PermissionCatalogItem[] };
    });

  // Full template×permission map is staff-admin only. Self-profile skips it. Settings
  // PermissionMatrix uses this map; Overview uses `stamp_preview` (user_permissions only).
  const templatePermissionsById: Promise<Record<string, string[]>> = isSelfView
    ? Promise.resolve({})
    : apiRequest<unknown>(
        '/trpc/permissions.listTemplateBaselines',
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => extractTrpc(res, { byTemplateId: {} as Record<string, string[]> }).byTemplateId ?? {})
        .catch(() => ({}));

  const parseMatrix = (res: { ok: boolean; data: unknown }) => {
    const data = extractTrpc<{
      userOverrides?: Record<string, boolean>;
      templateCodes?: string[];
      effectiveCodes?: string[];
    }>(res, {});
    return {
      userOverrides: data.userOverrides ?? {},
      templateCodes: data.templateCodes ?? [],
      effectiveCodes: data.effectiveCodes ?? [],
    };
  };

  const profileShowsPermissionsCard = user.role !== 'SUPER_ADMIN';
  const restrictHeadView = isViewerHeadOfMarketing || isViewerHeadOfCS;
  // The "Edit user" header link / Settings tab opens to /hr/users/:id/edit.
  // Only show it when the viewer can actually edit this specific target —
  // `canEditUser` returns 'none' otherwise. Hides the dead-end link that
  // would 403 on click. Self-view + admin-class targets are already 'none'
  // inside the helper.
  const canOpenSettingsTab = editAccessLevel !== 'none';
  const needsEditPermissionMatrix =
    !isSelfView && user.role !== 'SUPER_ADMIN' && canEditFull;

  /** Overview — stamp_preview matrix + RBAC `effectiveCodes` for the Permissions card. */
  const userStampPreview: Promise<{
    userOverrides: Record<string, boolean>;
    templateCodes: string[];
    effectiveCodes: string[];
  }> = profileShowsPermissionsCard
    ? apiRequest<unknown>(
        `/trpc/permissions.getUserMatrix?input=${encodeURIComponent(
          JSON.stringify({ userId, intent: 'stamp_preview' }),
        )}`,
        { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
      )
        .then((res) => {
          const m = parseMatrix(res);
          return {
            userOverrides: m.userOverrides,
            templateCodes: m.templateCodes,
            effectiveCodes: m.effectiveCodes,
          };
        })
        .catch(() => ({
          userOverrides: {},
          templateCodes: [] as string[],
          effectiveCodes: [] as string[],
        }))
    : Promise.resolve({ userOverrides: {}, templateCodes: [], effectiveCodes: [] });

  /** Settings tab PermissionMatrix — template baseline + sparse deltas (HR/admin edit path only). */
  const userEditPermissionOverrides: Promise<Record<string, boolean>> | undefined =
    needsEditPermissionMatrix && profileShowsPermissionsCard
      ? apiRequest<unknown>(
          `/trpc/permissions.getUserMatrix?input=${encodeURIComponent(
            JSON.stringify({ userId, intent: 'edit_matrix' }),
          )}`,
          { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
        )
          .then((res) => parseMatrix(res).userOverrides)
          .catch(() => ({}))
      : undefined;

    const showOnboardingTab = !isAdminLevel({ role: user.role });
    const permsSetForOnboarding = new Set((currentUser?.permissions ?? []).map((c) => canonicalPermissionCode(c)));
    const viewerCanManageHrOnboarding =
      isAdminLevel(currentUser) ||
      HR_ONBOARDING_PAGE_PERMISSIONS.some((c) => permsSetForOnboarding.has(canonicalPermissionCode(c)));

    const mirrorPromise = apiRequest<unknown>(
      `/trpc/branches.canMirrorToUser?input=${encodeURIComponent(JSON.stringify({ targetUserId: profileUser.id }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );

    const mirrorUi: Promise<{ viewerShowsMirror: boolean; mirrorSubmitDisabled: boolean }> =
      mirrorPromise.then((mirrorRes) => {
        const mirrorData = mirrorRes.data as
          | {
              result?: {
                data?: {
                  allowed: boolean;
                  previewEligible: boolean;
                  nestedMirrorSession: boolean;
                };
              };
            }
          | undefined;
        const m = mirrorData?.result?.data;
        return {
          viewerShowsMirror:
            profileUser.status === 'ACTIVE' &&
            mirrorRes.ok &&
            !!m &&
            (m.allowed === true || m.previewEligible === true),
          mirrorSubmitDisabled:
            profileUser.status === 'ACTIVE' &&
            mirrorRes.ok &&
            !!m &&
            m.allowed !== true &&
            m.previewEligible === true,
        };
      });

    const onboardingSummary: Promise<UserOnboardingSummary | null> = showOnboardingTab
      ? apiRequest<unknown>(
          `/trpc/onboarding.get?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
          { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
        )
          .then((res) => {
            if (res.status === 403) {
              return { ok: false as const, reason: 'forbidden' as const };
            }
            if (!res.ok) {
              return { ok: false as const, reason: 'error' as const };
            }
            const d = res.data as {
              result?: {
                data?: {
                  status?: string;
                  submittedAt?: string | null;
                  approvedAt?: string | null;
                };
              };
            };
            const row = d?.result?.data;
            if (!row) return { ok: false as const, reason: 'error' as const };
            return {
              ok: true as const,
              status: row.status ?? 'NOT_STARTED',
              submittedAt: row.submittedAt ?? null,
              approvedAt: row.approvedAt ?? null,
            };
          })
          .catch(() => ({ ok: false as const, reason: 'error' as const }))
      : Promise.resolve(null);

    return {
      user,
      roleTemplates,
      products,
      locations,
      plans,
      recentOrders,
      payouts,
      adjustments,
      auditLog,
      marketingMetrics,
      fundingBalance,
      pendingEmailChange,
      stockMovements,
      financeActivity,
      pushStatus,
      permissionCatalog,
      templatePermissionsById,
      userStampPreview,
      userEditPermissionOverrides,
      activeHeads,
      branchesList,
      canDisburseToThisUser,
      isSuperAdmin,
      isViewerHeadOfMarketing,
      isViewerHeadOfCS,
      canEditLimited,
      mirrorUi,
      isSelfView,
      showOnboardingTab,
      viewerCanManageHrOnboarding,
      onboardingSummary,
    };
  })();

  return defer({ userDetail: userDetailPromise });
}

// ─── Action ─────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();
  const userId = params['id'];

  if (!userId) {
    return json({ error: 'User ID required' }, { status: 400 });
  }

  if (intent === 'update') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
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
    // Protect admin-level accounts from HR-side edits. Admins manage admins via their own flows.
    if (target.role === 'SUPER_ADMIN' || target.role === 'ADMIN') {
      return json({ error: 'SuperAdmin/Admin accounts cannot be updated from this page. Use Settings to edit your own profile.' }, { status: 403 });
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
      return json({ success: true, message: 'No changes to save' });
    }

    const res = await apiRequest<unknown>('/trpc/users.update', {
      method: 'POST',
      cookie,
      body,
      timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update user') }, { status: safeStatus(res.status) });
    }

    const result = res.data as { result?: { data?: { emailChangePending?: boolean; requiresApproval?: boolean; requestId?: string; message?: string } } };
    const data = result?.result?.data;
    if (data?.requiresApproval) {
      return json({
        success: true,
        requiresApproval: true,
        requestId: data.requestId,
        message: data.message ?? 'Role change request submitted. SuperAdmin will review.',
      });
    }

    const emailChangePending = data?.emailChangePending;
    return json({
      success: true,
      message: emailChangePending
        ? 'User updated. Email change is pending SuperAdmin approval.'
        : 'User updated successfully',
      emailChangePending,
    });
  }

  if (intent === 'deactivate') {
    const currentUser = await getCurrentUser(request);
    if (currentUser?.role !== 'SUPER_ADMIN' && currentUser?.role !== 'ADMIN') {
      return json({ error: 'Only Super Admins and Admins can deactivate users.' }, { status: 403 });
    }

    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN' || targetData?.result?.data?.role === 'ADMIN') {
      return json({ error: 'SuperAdmin accounts cannot be deactivated.' }, { status: 403 });
    }
    // Admins cannot deactivate another admin-level user. Only SuperAdmin can.
    if (targetData?.result?.data?.role === 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      return json({ error: 'Only the SuperAdmin can deactivate another Admin.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.deactivate', {
      method: 'POST', cookie, body: { userId },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to deactivate user') }, { status: safeStatus(res.status) });
    }

    return redirect('/hr/users');
  }

  if (intent === 'reactivate') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN' || targetData?.result?.data?.role === 'ADMIN') {
      return json({ error: 'SuperAdmin/Admin accounts cannot be reactivated from this page.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.update', {
      method: 'POST',
      cookie,
      body: { userId, status: 'ACTIVE' },
      timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reactivate user') }, { status: safeStatus(res.status) });
    }

    return json({ success: true, message: 'User reactivated successfully' });
  }

  if (intent === 'processEmailChange') {
    const requestId = formData.get('requestId')?.toString();
    const action = formData.get('action')?.toString() as 'APPROVED' | 'REJECTED' | undefined;
    const reason = formData.get('reason')?.toString() ?? '';

    if (!requestId || !action || !reason || reason.length < 10) {
      return json({ error: 'Request ID, action (APPROVED/REJECTED), and reason (min 10 chars) are required' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.processEmailChange', {
      method: 'POST', cookie, body: { requestId, action, reason },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to process email change') }, { status: safeStatus(res.status) });
    }

    return json({ success: true, message: action === 'APPROVED' ? 'Email updated successfully' : 'Email change rejected' });
  }

  if (intent === 'resetPassword') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (targetData?.result?.data?.role === 'SUPER_ADMIN' || targetData?.result?.data?.role === 'ADMIN') {
      return json({ error: 'SuperAdmin/Admin must reset password from Settings.' }, { status: 403 });
    }

    const newPassword = formData.get('newPassword')?.toString() ?? '';

    if (newPassword.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.resetPassword', {
      method: 'POST', cookie, body: { userId, newPassword },
    });

    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to reset password') }, { status: safeStatus(res.status) });
    }

    return json({ success: true, message: 'Password reset successfully' });
  }

  // Re-stamp permissions — re-applies the user's role-template baseline to
  // user_permissions, fixing users created before snapshot stamping was wired
  // up (zero rows in user_permissions → every permission check fails).
  // Idempotent: safe to call on a healthy user (delta is zero).
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

  // Mirror Mode — view the app as this user (read-only). Permission gate is enforced
  // server-side in AuthService.startMirror; this just forwards the cookie + target id and
  // bounces to /admin so the freshly-mirrored session takes effect immediately.
  if (intent === 'mirror') {
    const res = await apiRequest<unknown>('/auth/mirror/start', {
      method: 'POST', cookie, body: { targetUserId: userId },
    });
    if (!res.ok) {
      const errorData = res.data as { message?: string; error?: string };
      return json({ error: errorData?.message ?? errorData?.error ?? 'Failed to start mirror' }, { status: safeStatus(res.status) });
    }
    throw redirect('/admin');
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

// ─── Component ──────────────────────────────────────────

function UserDetailDeferredFallback() {
  return (
    <div
      className="flex min-h-[min(60vh,560px)] flex-col items-center justify-center gap-3 rounded-xl border border-app-border bg-app-surface/40 px-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Spinner size="lg" className="text-brand-500 dark:text-brand-400" />
      <p className="text-sm text-app-fg-muted">Loading user…</p>
    </div>
  );
}

export function UserDetailPageWithMirror({
  data,
  usersBasePath,
}: {
  data: UserDetailLoaderData;
  usersBasePath?: string;
}) {
  const { mirrorUi, ...rest } = data;
  return (
    <Await
      resolve={mirrorUi}
      errorElement={
        <UserDetailPage {...rest} usersBasePath={usersBasePath} viewerShowsMirror={false} mirrorSubmitDisabled={false} />
      }
    >
      {(mirror) => (
        <UserDetailPage
          {...rest}
          usersBasePath={usersBasePath}
          viewerShowsMirror={mirror.viewerShowsMirror}
          mirrorSubmitDisabled={mirror.mirrorSubmitDisabled}
        />
      )}
    </Await>
  );
}

export default function UserDetailRoute() {
  const { userDetail } = useLoaderData<typeof loader>();
  return (
    <DeferredSection resolve={userDetail} fallback={<UserDetailDeferredFallback />}>
      {(data) =>
        'notFound' in data && data.notFound ? (
          <div className="card text-center py-12">
            <p className="text-6xl font-bold text-surface-200 dark:text-app-fg-muted mb-4">404</p>
            <h2 className="text-xl font-bold text-app-fg">User not found</h2>
            <p className="mt-2 text-sm text-app-fg-muted">
              The user you're looking for doesn't exist or has been removed.
            </p>
            <a href="/hr/users" className="btn-primary mt-4 inline-block">
              Back to Users
            </a>
          </div>
        ) : (
          <UserDetailPageWithMirror data={data as UserDetailLoaderData} />
        )
      }
    </DeferredSection>
  );
}
