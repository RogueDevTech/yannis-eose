import { Suspense } from 'react';
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
import { actorUserIdsMatch, canEditUser, isAdminLevel } from '~/lib/rbac';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { UserDetailPage } from '~/features/users/UserDetailPage';
import { UserDetailShellSkeleton } from '~/features/users/UserDetailShellSkeleton';
import type { UserDetail, UserDetailLoaderData } from '~/features/users/types';

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
    // Disbursements page is Finance → HoM only; HoM distributes to Media Buyers from Marketing → Funding.
    const canDisburseToThisUser =
      user.role === 'HEAD_OF_MARKETING' && (isSuperAdmin || perms.includes('finance.disburse'));

    // Post-mount slices: `/api/hr-user-detail-overview-core|onboarding|permissions|marketing/:userId`
    // plus `/api/hr-user-detail-activity-bundle/:userId` (orders / payroll / activity tab).
    const permsSetForOnboarding = new Set(
      (currentUser?.permissions ?? []).map((c) => canonicalPermissionCode(c)),
    );
    const showOnboardingTab = !isAdminLevel({ role: user.role });
    const viewerCanManageHrOnboarding =
      isAdminLevel(currentUser) ||
      HR_ONBOARDING_PAGE_PERMISSIONS.some((c) =>
        permsSetForOnboarding.has(canonicalPermissionCode(c)),
      );

    const mirrorPromise = apiRequest<unknown>(
      `/trpc/branches.canMirrorToUser?input=${encodeURIComponent(JSON.stringify({ targetUserId: user.id }))}`,
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
            user.status === 'ACTIVE' &&
            mirrorRes.ok &&
            !!m &&
            (m.allowed === true || m.previewEligible === true),
          mirrorSubmitDisabled:
            user.status === 'ACTIVE' &&
            mirrorRes.ok &&
            !!m &&
            m.allowed !== true &&
            m.previewEligible === true,
        };
      });

    // Probation management is HR_MANAGER + SUPER_ADMIN only (CEO directive 2026-05-08).
    // ADMIN intentionally cannot manage probation. Target must also be probation-eligible
    // (admin-tier users are excluded — see PROBATION_INELIGIBLE_ROLES).
    const targetEligibleForProbation = !['SUPER_ADMIN', 'ADMIN'].includes(user.role);
    const viewerCanManageProbationRole =
      currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'HR_MANAGER';
    const canManageProbation = !isSelfView && targetEligibleForProbation && viewerCanManageProbationRole;

    return {
      user,
      canDisburseToThisUser,
      isSuperAdmin,
      isViewerHeadOfMarketing,
      isViewerHeadOfCS,
      canEditLimited,
      mirrorUi,
      isSelfView,
      showOnboardingTab,
      viewerCanManageHrOnboarding,
      canManageProbation,
    } satisfies UserDetailLoaderData;
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

  // ─── Probation intents ────────────────────────────────────
  // Authority is enforced server-side (HR_MANAGER + SUPER_ADMIN only). The route
  // forwards what HR types and trusts the API to reject unauthorized callers.

  if (intent === 'setProbation') {
    const probationUntilStr = formData.get('probationUntil')?.toString().trim() ?? '';
    const body: Record<string, unknown> = { userId };
    if (probationUntilStr) body.probationUntil = probationUntilStr;
    const res = await apiRequest<unknown>('/trpc/users.setProbation', {
      method: 'POST',
      cookie,
      body,
      timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to place user on probation') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'User placed on probation.' });
  }

  if (intent === 'extendProbation') {
    const probationUntil = formData.get('probationUntil')?.toString().trim() ?? '';
    if (!probationUntil) {
      return json({ error: 'Pick a new probation review date.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/users.extendProbation', {
      method: 'POST',
      cookie,
      body: { userId, probationUntil },
      timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to update probation date') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Probation review date updated.' });
  }

  if (intent === 'markProbationPermanent') {
    const res = await apiRequest<unknown>('/trpc/users.markProbationPermanent', {
      method: 'POST',
      cookie,
      body: { userId },
      timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to mark user permanent') },
        { status: safeStatus(res.status) },
      );
    }
    return json({ success: true, message: 'Probation cleared. User is now permanent.' });
  }

  if (intent === 'terminateProbation') {
    const reason = formData.get('reason')?.toString().trim() ?? '';
    const confirmName = formData.get('confirmName')?.toString().trim() ?? '';
    if (reason.length < 10) {
      return json({ error: 'Termination reason must be at least 10 characters.' }, { status: 400 });
    }
    if (!confirmName) {
      return json({ error: 'Type the user name to confirm termination.' }, { status: 400 });
    }
    const res = await apiRequest<unknown>('/trpc/users.terminateProbation', {
      method: 'POST',
      cookie,
      body: { userId, reason, confirmName },
      timeoutMs: USER_WRITE_ACTION_TIMEOUT_MS,
    });
    if (!res.ok) {
      return json(
        { error: extractApiErrorMessage(res.data, 'Failed to terminate probation user') },
        { status: safeStatus(res.status) },
      );
    }
    return redirect('/hr/users');
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
    <Suspense fallback={<UserDetailShellSkeleton />}>
      <Await resolve={userDetail}>
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
      </Await>
    </Suspense>
  );
}
