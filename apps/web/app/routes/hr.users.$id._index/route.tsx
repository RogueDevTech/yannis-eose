import { useLoaderData } from '@remix-run/react';
import type { ShouldRevalidateFunction } from '@remix-run/react';
import { defer, json, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  apiRequest,
  getSessionCookie,
  HR_ONBOARDING_PAGE_PERMISSIONS,
  getCurrentUser,
  safeStatus,
  DEFERRED_LOADER_TIMEOUT_MS,
  USER_WRITE_ACTION_TIMEOUT_MS,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { canEditUser, isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { UserDetailPage } from '~/features/users/UserDetailPage';
import { UserDetailShellSkeleton } from '~/features/users/UserDetailShellSkeleton';
import type {
  UserDetail,
  UserDetailLoaderData,
  UserOnboardingSummary,
  PermissionCatalogBundle,
} from '~/features/users/types';

export const meta: MetaFunction = () => [{ title: 'User Detail — Yannis EOSE' }];

// Only revalidate after mutations on this route — tab navigation and sibling
// route changes must NOT re-fire the loader (single page-bundle API call).
export const shouldRevalidate: ShouldRevalidateFunction = ({
  defaultShouldRevalidate,
  formMethod,
}) => {
  if (formMethod && formMethod !== 'GET') return defaultShouldRevalidate;
  return false;
};

// ─── Loader ─────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);

  const cookie = getSessionCookie(request);
  const userId = params['id'];

  if (!userId) {
    throw new Response('User ID required', { status: 400 });
  }
  if (!cookie) {
    throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  }

  // Single page bundle call replaces ~20-30 HTTP round-trips. The API procedure
  // handles authorization, fetches the target user once, then fans out all
  // sub-slices (products, templates, locations, plans, permissions, onboarding,
  // marketing, mirror eligibility) in parallel via Promise.all.
  const userDetailPromise = (async (): Promise<UserDetailLoaderData | { notFound: true }> => {
    const bundleInput = encodeURIComponent(JSON.stringify({ userId }));
    const bundleRes = await apiRequest<unknown>(
      `/trpc/hr.userDetailPageBundle?input=${bundleInput}`,
      { method: 'GET', cookie, timeoutMs: 60_000 },
    );

    if (!bundleRes.ok) {
      const status = bundleRes.status;
      if (status === 404) {
        return { notFound: true as const };
      }
      if (status === 403) {
        throw new Response('Not allowed to view this user.', { status: 403 });
      }
      return { notFound: true as const };
    }

    const bundle = (bundleRes.data as { result?: { data?: Record<string, unknown> } })?.result
      ?.data;
    if (!bundle || !bundle.user) {
      return { notFound: true as const };
    }

    const user = bundle.user as UserDetail;
    const isSelfView = bundle.isSelfView as boolean;

    // ── Derive client-side flags from currentUser + profileUser ──
    const isSuperAdmin =
      currentUser?.role === 'SUPER_ADMIN' ||
      currentUser?.role === 'ADMIN' ||
      currentUser?.role === 'SUPPORT';
    const permsSetForReactivate = new Set(
      (currentUser?.permissions ?? []).map((c) => canonicalPermissionCode(c)),
    );
    const canReactivateDeactivatedStaff =
      isSuperAdmin ||
      currentUser?.role === 'HR_MANAGER' ||
      permsSetForReactivate.has(canonicalPermissionCode('users.deactivate')) ||
      permsSetForReactivate.has(canonicalPermissionCode('users.staff.deactivate'));
    const isViewerHeadOfMarketing = currentUser?.role === 'HEAD_OF_MARKETING';
    const isViewerHeadOfCS = currentUser?.role === 'HEAD_OF_CS';
    const editAccessLevel = canEditUser(currentUser, {
      id: user.id,
      role: user.role,
      primaryBranchId: user.primaryBranchId ?? null,
    });
    const canEditLimited = editAccessLevel === 'limited';

    const showOnboardingTab = !isAdminLevel({ role: user.role });
    const permsSetForOnboarding = new Set(
      (currentUser?.permissions ?? []).map((c) => canonicalPermissionCode(c)),
    );
    const viewerCanManageHrOnboarding =
      isAdminLevel(currentUser) ||
      HR_ONBOARDING_PAGE_PERMISSIONS.some((c) =>
        permsSetForOnboarding.has(canonicalPermissionCode(c)),
      );

    // ── Mirror UI flags ──
    const mirrorEligibility = bundle.mirrorEligibility as {
      allowed: boolean;
      previewEligible: boolean;
      nestedMirrorSession: boolean;
    } | null;
    const mirrorUi = {
      viewerShowsMirror:
        user.status === 'ACTIVE' &&
        !!mirrorEligibility &&
        (mirrorEligibility.allowed === true || mirrorEligibility.previewEligible === true),
      mirrorSubmitDisabled:
        user.status === 'ACTIVE' &&
        !!mirrorEligibility &&
        mirrorEligibility.allowed !== true &&
        mirrorEligibility.previewEligible === true,
    };

    // ── Onboarding slice ──
    const rawOnboarding = bundle.onboardingSummary as UserOnboardingSummary | null;
    const overviewOnboardingSlice = rawOnboarding
      ? { onboardingSummary: rawOnboarding }
      : null;

    // ── Permissions slice ──
    const permissionCatalog = bundle.permissionCatalog as PermissionCatalogBundle | undefined;
    const templatePermissionsById = bundle.templatePermissionsById as Record<string, string[]> | undefined;
    const userStampPreview = bundle.userStampPreview as {
      userOverrides: Record<string, boolean>;
      templateCodes: string[];
      effectiveCodes: string[];
    } | undefined;
    const overviewPermissionsSlice =
      permissionCatalog && templatePermissionsById && userStampPreview
        ? { permissionCatalog, templatePermissionsById, userStampPreview }
        : null;

    // ── Marketing slice ──
    const bundleMarketingMetrics = (bundle.marketingMetrics ?? null) as UserDetailLoaderData['bundleMarketingMetrics'];
    const bundleFundingBalance = (bundle.fundingBalance ?? null) as UserDetailLoaderData['bundleFundingBalance'];

    return {
      user,
      isSuperAdmin,
      canReactivateDeactivatedStaff,
      isViewerHeadOfMarketing,
      isViewerHeadOfCS,
      canEditLimited,
      mirrorUi,
      overviewOnboardingSlice,
      overviewPermissionsSlice,
      isSelfView,
      showOnboardingTab,
      viewerCanManageHrOnboarding,
      // Page bundle data — replaces client-side resource route fetchers
      bundleProducts: (bundle.products ?? []) as UserDetailLoaderData['bundleProducts'],
      bundleRoleTemplates: (bundle.roleTemplates ?? []) as UserDetailLoaderData['bundleRoleTemplates'],
      bundleLocations: (bundle.locations ?? []) as UserDetailLoaderData['bundleLocations'],
      bundlePlans: (bundle.plans ?? []) as UserDetailLoaderData['bundlePlans'],
      bundlePendingEmailChange: (bundle.pendingEmailChange ?? null) as UserDetailLoaderData['bundlePendingEmailChange'],
      bundlePushStatus: (bundle.pushStatus ?? null) as UserDetailLoaderData['bundlePushStatus'],
      bundleMarketingMetrics,
      bundleFundingBalance,
    } satisfies UserDetailLoaderData;
  })();

  return defer({ userDetail: userDetailPromise });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

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
      return json(
        {
          error:
            'SuperAdmin/Admin accounts cannot be updated from this page. Use Settings to edit your own profile.',
        },
        { status: 403 },
      );
    }

    const body: Record<string, unknown> = { userId };
    const prevAssignedKey = [...(target.assignedProductIds ?? [])].sort().join('\0');
    const prevBranchIdsKey = [
      ...(target.branchMemberships ?? []).map((membership) => membership.branchId),
    ]
      .sort()
      .join('\0');

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
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update user') },
        { status: safeStatus(res.status) },
      );
    }

    const result = res.data as {
      result?: {
        data?: {
          emailChangePending?: boolean;
          requiresApproval?: boolean;
          requestId?: string;
          message?: string;
        };
      };
    };
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
        ? 'User updated. Email change is pending approval.'
        : 'User updated successfully',
      emailChangePending,
    });
  }

  if (intent === 'deactivate') {
    const currentUser = await getCurrentUser(request);
    if (
      currentUser?.role !== 'SUPER_ADMIN' &&
      currentUser?.role !== 'ADMIN' &&
      currentUser?.role !== 'HR_MANAGER'
    ) {
      return json({ error: 'Only Super Admins, Admins, and HR Managers can deactivate users.' }, { status: 403 });
    }

    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (
      targetData?.result?.data?.role === 'SUPER_ADMIN' ||
      targetData?.result?.data?.role === 'ADMIN'
    ) {
      return json({ error: 'SuperAdmin accounts cannot be deactivated.' }, { status: 403 });
    }
    // Admins cannot deactivate another admin-level user. Only SuperAdmin can.
    if (targetData?.result?.data?.role === 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      return json({ error: 'Only the SuperAdmin can deactivate another Admin.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.deactivate', {
      method: 'POST',
      cookie,
      body: { userId },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to deactivate user') },
        { status: safeStatus(res.status) },
      );
    }

    return redirect('/hr/users');
  }

  if (intent === 'reactivate') {
    const currentUser = await getCurrentUser(request);
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    const targetRole = targetData?.result?.data?.role;
    if (targetRole === 'SUPER_ADMIN') {
      return json({ error: 'SuperAdmin accounts cannot be reactivated.' }, { status: 403 });
    }
    if (targetRole === 'ADMIN' && currentUser?.role !== 'SUPER_ADMIN') {
      return json({ error: 'Only the SuperAdmin can reactivate another Admin.' }, { status: 403 });
    }

    const res = await apiRequest<unknown>('/trpc/users.update', {
      method: 'POST',
      cookie,
      body: { userId, status: 'ACTIVE' },
      timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reactivate user') },
        { status: safeStatus(res.status) },
      );
    }

    return json({ success: true, message: 'User reactivated successfully' });
  }

  if (intent === 'processEmailChange') {
    const requestId = formData.get('requestId')?.toString();
    const action = formData.get('action')?.toString() as 'APPROVED' | 'REJECTED' | undefined;
    const reason = formData.get('reason')?.toString() ?? '';

    if (!requestId || !action || !reason || reason.length < 10) {
      return json(
        { error: 'Request ID, action (APPROVED/REJECTED), and reason (min 10 chars) are required' },
        { status: 400 },
      );
    }

    const res = await apiRequest<unknown>('/trpc/users.processEmailChange', {
      method: 'POST',
      cookie,
      body: { requestId, action, reason },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to process email change') },
        { status: safeStatus(res.status) },
      );
    }

    return json({
      success: true,
      message: action === 'APPROVED' ? 'Email updated successfully' : 'Email change rejected',
    });
  }

  if (intent === 'resetPassword') {
    const targetRes = await apiRequest<unknown>(
      `/trpc/users.getById?input=${encodeURIComponent(JSON.stringify({ userId }))}`,
      { method: 'GET', cookie, timeoutMs: DEFERRED_LOADER_TIMEOUT_MS },
    );
    const targetData = targetRes.data as { result?: { data?: { role: string } } };
    if (
      targetData?.result?.data?.role === 'SUPER_ADMIN' ||
      targetData?.result?.data?.role === 'ADMIN'
    ) {
      return json(
        { error: 'SuperAdmin/Admin must reset password from Settings.' },
        { status: 403 },
      );
    }

    const newPassword = formData.get('newPassword')?.toString() ?? '';

    if (newPassword.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const res = await apiRequest<unknown>('/trpc/users.resetPassword', {
      method: 'POST',
      cookie,
      body: { userId, newPassword },
    });

    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to reset password') },
        { status: safeStatus(res.status) },
      );
    }

    return json({ success: true, message: 'Password reset successfully' });
  }

  // Re-stamp permissions — re-applies the user's role-template baseline to
  // user_permissions, fixing users created before snapshot stamping was wired
  // up (zero rows in user_permissions → every permission check fails).
  // Idempotent: safe to call on a healthy user (delta is zero).
  if (intent === 'restampPermissions') {
    const res = await apiRequest<unknown>('/trpc/users.restampPermissions', {
      method: 'POST',
      cookie,
      body: { userId },
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to re-stamp permissions') },
        { status: safeStatus(res.status) },
      );
    }
    const payload = (
      res.data as {
        result?: {
          data?: { stampedGranted: number; stampedRevoked: number; templateBaselineCount: number };
        };
      }
    )?.result?.data;
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
      method: 'POST',
      cookie,
      body: { targetUserId: userId },
    });
    if (!res.ok) {
      const errorData = res.data as { message?: string; error?: string };
      return json(
        { error: errorData?.message ?? errorData?.error ?? 'Failed to start mirror' },
        { status: safeStatus(res.status) },
      );
    }
    // Forward API Set-Cookie (session bundle with mirrored identity + supervisor flags).
    // Without this, Remix keeps decoding the stale bundle cookie and loaders still see the admin.
    const headers = new Headers();
    for (const c of res.setCookies) {
      headers.append('Set-Cookie', c);
    }
    throw redirect('/admin?_reload=1', { headers });
  }

  return json({ error: 'Unknown action' }, { status: 400 });
}

// ─── Component ──────────────────────────────────────────

export function UserDetailPageWithMirror({
  data,
  usersBasePath,
}: {
  data: UserDetailLoaderData;
  usersBasePath?: string;
}) {
  const { mirrorUi, overviewOnboardingSlice, overviewPermissionsSlice, ...rest } = data;
  return (
    <UserDetailPage
      {...rest}
      usersBasePath={usersBasePath}
      viewerShowsMirror={mirrorUi.viewerShowsMirror}
      mirrorSubmitDisabled={mirrorUi.mirrorSubmitDisabled}
      overviewOnboardingSlice={overviewOnboardingSlice}
      overviewPermissionsSlice={overviewPermissionsSlice}
    />
  );
}

export default function UserDetailRoute() {
  const { userDetail } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={userDetail}
      fallback={<UserDetailShellSkeleton />}
      loaderShell={{}}
      deferredKey="userDetail"
    >
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
    </CachedAwait>
  );
}
