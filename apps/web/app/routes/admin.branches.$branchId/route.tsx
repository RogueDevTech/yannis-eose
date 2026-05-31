import { defer, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

import { Link, useLoaderData, useFetcher, useRevalidator } from '@remix-run/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import {
  ModalFetcherInlineError,
  useFetcherActionSurface,
} from '~/hooks/use-fetcher-action-surface';
import {
  apiRequest,
  defaultThisMonthRange,
  getCurrentUser,
  getSessionCookie,
  requirePermission,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { SearchInput } from '~/components/ui/search-input';
import { RoleBadge, formatRoleLabel } from '~/components/ui/role-badge';
import { Checkbox } from '~/components/ui/checkbox';
import { Pagination } from '~/components/ui/pagination';
import {
  CompactTable,
  type CompactTableColumn,
  CompactTableActionButton,
} from '~/components/ui/compact-table';
import { BranchDetailLoadingShell } from '~/features/branches/BranchesDeferredLoadingShells';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Collapsible } from '~/components/ui/collapsible';
import { Tabs } from '~/components/ui/tabs';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader, invalidateCachedLoader } from '~/lib/loader-cache';

// ── Remove confirmation modal ─────────────────────────────────────────────────

function RemoveModal({ member, onClose }: { member: OverviewMember; onClose: () => void }) {
  const removeFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const removeSurface = useFetcherActionSurface(removeFetcher);
  useFetcherToast(removeFetcher.data, {
    successMessage: 'Member removed',
    skipErrorToast: true,
  });
  const isSubmitting = removeFetcher.state !== 'idle';

  useEffect(() => {
    if (removeFetcher.state === 'idle' && removeFetcher.data?.success) {
      onClose();
    }
  }, [removeFetcher.state, removeFetcher.data, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-sm"
      role="dialog"
      aria-labelledby="remove-member-title"
      contentClassName="p-0 flex flex-col overflow-hidden"
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-danger-600 dark:text-danger-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>
          <div>
            <h3 id="remove-member-title" className="text-base font-semibold text-app-fg">
              Remove from branch?
            </h3>
            <p className="text-sm text-app-fg-muted mt-1">
              <span className="font-medium text-app-fg-muted">{member.name}</span> will lose access
              to this branch. Their global account will not be affected.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-5 mb-3">
        <ModalFetcherInlineError message={removeSurface.errorMatchingIntent('removeUser')} />
      </div>

      <div className="border-t border-app-border px-5 py-3 flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <removeFetcher.Form method="post">
          <input type="hidden" name="intent" value="removeUser" />
          <input type="hidden" name="userId" value={member.userId} />
          <Button
            type="submit"
            variant="danger"
            size="sm"
            disabled={isSubmitting}
            loading={isSubmitting}
            loadingText="Removing…"
          >
            Remove
          </Button>
        </removeFetcher.Form>
      </div>
    </Modal>
  );
}

export const meta: MetaFunction = () => [{ title: 'Branch — Yannis EOSE' }];

type MemberDepartment = 'CS' | 'MARKETING' | 'LOGISTICS' | 'FINANCE' | 'HR' | 'OTHER';

interface OverviewMember {
  userId: string;
  name: string;
  effectiveRole: string;
  isPrimary: boolean;
  department: MemberDepartment;
}

interface BranchOverview {
  branch: {
    id: string;
    name: string;
    code: string;
    status: string;
    createdAt: string;
  };
  counts: {
    totalMembers: number;
    totalOrders: number;
    deliveredOrders: number;
    activeOrders: number;
    campaigns: number;
  };
  members: OverviewMember[];
  viewer?: {
    canManageBranchPage?: boolean;
    isSupervisor?: boolean;
    canManageCSTeams?: boolean;
    canManageMarketingTeams?: boolean;
  };
}

const DEPT_LABEL: Record<MemberDepartment, string> = {
  CS: 'Customer support',
  MARKETING: 'Marketing',
  LOGISTICS: 'Logistics',
  FINANCE: 'Finance',
  HR: 'HR',
  OTHER: 'Other',
};

interface UserOption {
  id: string;
  name: string;
  role: string;
  email: string;
}

interface BranchTeamWithMembers {
  id: string;
  branchId: string;
  branchDepartmentId: string;
  department: 'CS' | 'MARKETING';
  name: string | null;
  createdAt: string;
  updatedAt: string | null;
  members: Array<{
    teamId: string;
    userId: string;
    isSupervisor: boolean;
    name: string;
    role: string;
  }>;
}

/** `listBranchOrgStructure` — department bucket + teamless roster + squads per branch. */
interface BranchOrgDepartmentBlock {
  department: {
    id: string;
    branchId: string;
    department: 'CS' | 'MARKETING';
    createdAt: string;
    updatedAt: string | null;
  };
  roster: Array<{ userId: string; name: string; role: string }>;
  teams: BranchTeamWithMembers[];
}

interface BranchOrgStructurePayload {
  departments: BranchOrgDepartmentBlock[];
}

type BranchDetailLoadingVisibility = {
  canManageCSTeams: boolean;
  canManageMarketingTeams: boolean;
};

function getBranchDetailLoadingVisibility(viewer: Awaited<ReturnType<typeof getCurrentUser>>): BranchDetailLoadingVisibility {
  if (!viewer) {
    return {
      canManageCSTeams: true,
      canManageMarketingTeams: true,
    };
  }

  const perms = new Set(viewer.permissions ?? []);
  const isSuperAdmin = viewer.role === 'SUPER_ADMIN';
  const hasBranchManagePermission = perms.has('branches.manage');
  const hasBranchManageUsersPermission = perms.has('branches.manage_users');
  const hasCSTeamsPermission = perms.has('branches.teams.cs');
  const hasMarketingTeamsPermission = perms.has('branches.teams.marketing');
  const isHeadOfCsRole = viewer.role === 'HEAD_OF_CS';
  const canManageBranchPage =
    isSuperAdmin || hasBranchManagePermission || hasBranchManageUsersPermission;

  return {
    canManageCSTeams:
      canManageBranchPage || hasCSTeamsPermission || isHeadOfCsRole,
    canManageMarketingTeams:
      canManageBranchPage || hasMarketingTeamsPermission,
  };
}

/**
 * Pending team-mutation payload extracted from `squadFetcher`'s in-flight
 * submission. While the post-action loader revalidates, we overlay this onto
 * `orgStructure` so the panel reflects the change on the same React tick the
 * server confirms — instead of waiting for the network round-trip refresh.
 *
 * Lifecycle (matches `useOptimisticListMerge`, CEO directive 2026-05):
 *   - Returns null while `fetcher.state === 'submitting'` — no overlay until
 *     the server confirms.
 *   - Returns the payload from success → idle, including the
 *     loader-revalidation window. The overlay drops cleanly when the
 *     canonical orgStructure lands.
 *
 * Covered intents:
 *   - `addBranchTeamMember` / `addBranchTeamMembersBulk` → MOVE: add to target
 *     team, remove from any sibling team in the same dept (move semantics
 *     mirroring the API's `addTeamMember` behaviour).
 *   - `removeBranchTeamMember` → REMOVE: drop the member row from the team.
 *   - `setBranchTeamMemberSupervisor` → SUPERVISOR_TOGGLE: patch isSupervisor
 *     on the existing member row.
 *   - `createBranchTeam` → CREATE_TEAM: append a synthetic team row to the
 *     matching dept block so the new team appears immediately (was previously
 *     invisible until the loader revalidation completed — CEO 2026-05-11).
 *   - `deleteBranchTeam` → DELETE_TEAM: drop the team row from its dept block
 *     so it disappears immediately on confirm.
 *   - `updateBranchTeam` (rename) → RENAME_TEAM: patch the team's `name` so
 *     the renamed title shows up immediately.
 */
type PendingTeamMutation =
  | {
      kind: 'move';
      userIds: string[];
      targetTeamId: string;
      isSupervisor: boolean;
    }
  | {
      kind: 'remove';
      userId: string;
      teamId: string;
    }
  | {
      kind: 'setSupervisor';
      userId: string;
      teamId: string;
      isSupervisor: boolean;
    }
  | {
      kind: 'createTeam';
      department: 'CS' | 'MARKETING';
      name: string;
      optimisticTeamId: string;
    }
  | {
      kind: 'deleteTeam';
      teamId: string;
    }
  | {
      kind: 'renameTeam';
      teamId: string;
      name: string;
    };

function usePendingTeamMutation(
  fetcher: ReturnType<typeof useFetcher<{ success?: boolean; error?: string }>>,
): PendingTeamMutation | null {
  const { state: revalidatorState } = useRevalidator();
  return useMemo<PendingTeamMutation | null>(() => {
    const isMutating = fetcher.state !== 'idle' || revalidatorState !== 'idle';
    if (!isMutating) return null;
    if (fetcher.state === 'submitting') return null;
    const data = fetcher.data;
    const succeeded = !!data && (data as { success?: boolean }).success === true;
    if (!succeeded) return null;

    const fd = fetcher.formData;
    if (!fd) return null;
    const intent = fd.get('intent')?.toString() ?? '';

    // createBranchTeam has no teamId (the row doesn't exist yet on the
    // server) — handle it before the teamId guard so the synthetic row can
    // appear in the dept's team list immediately.
    if (intent === 'createBranchTeam') {
      const department = fd.get('department')?.toString();
      const name = fd.get('name')?.toString().trim();
      if ((department !== 'CS' && department !== 'MARKETING') || !name) return null;
      // Stable optimistic id keyed on the form payload so the same in-flight
      // submission produces the same synthetic row across renders.
      return {
        kind: 'createTeam',
        department,
        name,
        optimisticTeamId: optimisticId(`${department}:${name}`),
      };
    }

    const teamId = fd.get('teamId')?.toString();
    if (!teamId) return null;
    const isSupervisor = fd.get('isSupervisor') === 'true';

    if (intent === 'addBranchTeamMember') {
      const userId = fd.get('userId')?.toString();
      if (!userId) return null;
      return { kind: 'move', userIds: [userId], targetTeamId: teamId, isSupervisor };
    }
    if (intent === 'addBranchTeamMembersBulk') {
      const userIdsRaw = fd.get('userIds')?.toString() ?? '[]';
      try {
        const parsed = JSON.parse(userIdsRaw);
        if (!Array.isArray(parsed)) return null;
        const userIds = parsed.filter((v): v is string => typeof v === 'string');
        if (userIds.length === 0) return null;
        return { kind: 'move', userIds, targetTeamId: teamId, isSupervisor };
      } catch {
        return null;
      }
    }
    if (intent === 'removeBranchTeamMember') {
      const userId = fd.get('userId')?.toString();
      if (!userId) return null;
      return { kind: 'remove', userId, teamId };
    }
    if (intent === 'setBranchTeamMemberSupervisor') {
      const userId = fd.get('userId')?.toString();
      if (!userId) return null;
      return { kind: 'setSupervisor', userId, teamId, isSupervisor };
    }
    if (intent === 'deleteBranchTeam') {
      return { kind: 'deleteTeam', teamId };
    }
    if (intent === 'updateBranchTeam') {
      const name = fd.get('name')?.toString().trim() ?? '';
      return { kind: 'renameTeam', teamId, name };
    }
    return null;
  }, [fetcher.formData, fetcher.state, fetcher.data, revalidatorState]);
}

/**
 * Pure overlay: applies a pending team mutation on top of the server
 * orgStructure. Each branch of the dept tree that's untouched passes through
 * by reference so React only reconciles the changed subtree.
 */
function applyPendingTeamMutation(
  orgStructure: BranchOrgStructurePayload,
  pending: PendingTeamMutation | null,
  branchMembers: OverviewMember[],
): BranchOrgStructurePayload {
  if (!pending) return orgStructure;

  // ── MOVE (add or bulk-add) ────────────────────────────────────────
  if (pending.kind === 'move') {
    if (pending.userIds.length === 0) return orgStructure;

    let owningDeptId: string | null = null;
    for (const d of orgStructure.departments) {
      if (d.teams.some((t) => t.id === pending.targetTeamId)) {
        owningDeptId = d.department.id;
        break;
      }
    }
    if (!owningDeptId) return orgStructure;

    const memberById = new Map(branchMembers.map((m) => [m.userId, m]));
    const userIdSet = new Set(pending.userIds);

    return {
      departments: orgStructure.departments.map((d) => {
        if (d.department.id !== owningDeptId) return d;
        const newRoster = d.roster.filter((r) => !userIdSet.has(r.userId));
        const newTeams = d.teams.map((t) => {
          if (t.id === pending.targetTeamId) {
            // Add pending users (dedupe — handles idempotent re-add).
            const existingIds = new Set(t.members.map((m) => m.userId));
            const additions = pending.userIds
              .filter((uid) => !existingIds.has(uid))
              .map((uid) => {
                const bm = memberById.get(uid);
                return {
                  teamId: t.id,
                  userId: uid,
                  isSupervisor: pending.isSupervisor,
                  name: bm?.name ?? 'Member',
                  role: bm?.effectiveRole ?? '',
                };
              });
            return additions.length === 0 ? t : { ...t, members: [...t.members, ...additions] };
          }
          // Move semantics: drop the user from any sibling team they were on.
          const filtered = t.members.filter((m) => !userIdSet.has(m.userId));
          return filtered.length === t.members.length ? t : { ...t, members: filtered };
        });
        return { ...d, roster: newRoster, teams: newTeams };
      }),
    };
  }

  // ── REMOVE ───────────────────────────────────────────────────────
  if (pending.kind === 'remove') {
    return {
      departments: orgStructure.departments.map((d) => {
        const ownsTeam = d.teams.some((t) => t.id === pending.teamId);
        if (!ownsTeam) return d;
        const newTeams = d.teams.map((t) => {
          if (t.id !== pending.teamId) return t;
          const filtered = t.members.filter((m) => m.userId !== pending.userId);
          return filtered.length === t.members.length ? t : { ...t, members: filtered };
        });
        return { ...d, teams: newTeams };
      }),
    };
  }

  // ── CREATE_TEAM ──────────────────────────────────────────────────
  // Append a synthetic team row to the dept block matching the pending
  // department lane. The id is from `optimisticId()`, so any code that needs
  // to short-circuit actions on in-flight rows can detect it via
  // `isOptimisticId(team.id)`.
  if (pending.kind === 'createTeam') {
    return {
      departments: orgStructure.departments.map((d) => {
        if (d.department.department !== pending.department) return d;
        // Idempotency: don't double-append if this synthetic row is already
        // there (revalidator + fetcher state can re-fire the memo).
        if (d.teams.some((t) => t.id === pending.optimisticTeamId)) return d;
        const synthetic: BranchTeamWithMembers = {
          id: pending.optimisticTeamId,
          branchId: d.department.branchId,
          branchDepartmentId: d.department.id,
          department: pending.department,
          name: pending.name,
          createdAt: new Date().toISOString(),
          updatedAt: null,
          members: [],
        };
        return { ...d, teams: [...d.teams, synthetic] };
      }),
    };
  }

  // ── DELETE_TEAM ──────────────────────────────────────────────────
  // Drop the team from its dept block immediately so it disappears from the
  // UI on confirm. The loader-revalidation that follows will land the same
  // shape (team gone) so there's no flicker on swap-back.
  if (pending.kind === 'deleteTeam') {
    return {
      departments: orgStructure.departments.map((d) => {
        const next = d.teams.filter((t) => t.id !== pending.teamId);
        return next.length === d.teams.length ? d : { ...d, teams: next };
      }),
    };
  }

  // ── RENAME_TEAM ──────────────────────────────────────────────────
  if (pending.kind === 'renameTeam') {
    return {
      departments: orgStructure.departments.map((d) => {
        const ownsTeam = d.teams.some((t) => t.id === pending.teamId);
        if (!ownsTeam) return d;
        const newTeams = d.teams.map((t) =>
          t.id === pending.teamId
            ? { ...t, name: pending.name.length > 0 ? pending.name : null }
            : t,
        );
        return { ...d, teams: newTeams };
      }),
    };
  }

  // ── SUPERVISOR_TOGGLE ────────────────────────────────────────────
  if (pending.kind === 'setSupervisor') {
    return {
      departments: orgStructure.departments.map((d) => {
        const ownsTeam = d.teams.some((t) => t.id === pending.teamId);
        if (!ownsTeam) return d;
        const newTeams = d.teams.map((t) => {
          if (t.id !== pending.teamId) return t;
          let touched = false;
          const newMembers = t.members.map((m) => {
            if (m.userId !== pending.userId) return m;
            if (m.isSupervisor === pending.isSupervisor) return m;
            touched = true;
            return { ...m, isSupervisor: pending.isSupervisor };
          });
          return touched ? { ...t, members: newMembers } : t;
        });
        return { ...d, teams: newTeams };
      }),
    };
  }

  return orgStructure;
}

type SettingSource = 'enforced-system' | 'team' | 'system' | 'unset';

interface EffectiveTeamSetting {
  key: string;
  value: Record<string, unknown> | null;
  source: SettingSource;
  systemEnforced: boolean;
  systemValue: Record<string, unknown> | null;
  teamValue: Record<string, unknown> | null;
}

interface TeamSettingsBundle {
  department: 'CS' | 'MARKETING';
  catalog: Array<{ key: string; label: string; description: string }>;
  settings: EffectiveTeamSetting[];
}

/**
 * CEO directive 2026-05-10: only Marketing, CS, and the branch-management
 * role belong in the branching system. Org-wide roles (SuperAdmin, Admin,
 * Finance, HR, Logistics, Stock, 3PL) are not assignable to a branch.
 * Mirrored by migration 0136 which cleans up legacy assignments.
 */
const BRANCH_ELIGIBLE_ROLES = new Set([
  'MEDIA_BUYER',
  'HEAD_OF_MARKETING',
  'CS_CLOSER',
  'HEAD_OF_CS',
  'BRANCH_ADMIN',
]);

const ROLE_OPTIONS = [
  { value: 'CS_CLOSER', label: 'Sales Closer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
];

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await getCurrentUser(request);
  if (!viewer) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  const branchId = params.branchId;
  if (!branchId) throw new Response('Missing branch', { status: 400 });

  const cookie = getSessionCookie(request);
  const loadingVisibility = getBranchDetailLoadingVisibility(viewer);

  const url = new URL(request.url);
  const periodAllTime = url.searchParams.get('period') === 'all_time';
  const startDateParam = url.searchParams.get('startDate') ?? undefined;
  const endDateParam = url.searchParams.get('endDate') ?? undefined;
  const thisMonth = defaultThisMonthRange();
  const dateRange = periodAllTime
    ? {}
    : { startDate: startDateParam ?? thisMonth.startDate, endDate: endDateParam ?? thisMonth.endDate };
  const dateFilters = {
    startDate: periodAllTime ? '' : (dateRange.startDate ?? ''),
    endDate: periodAllTime ? '' : (dateRange.endDate ?? ''),
    periodAllTime,
  };

  const pageData = (async () => {
    const [overviewRes, usersRes, orgRes, statusCountsRes] = await Promise.all([
      apiRequest<{ result?: { data?: BranchOverview } }>(
        `/trpc/branches.overview?input=${encodeURIComponent(JSON.stringify({ branchId }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<{ result?: { data?: { users: UserOption[]; pagination: unknown } } }>(
        `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc', status: 'ACTIVE', allBranches: true }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<{ result?: { data?: BranchOrgStructurePayload } }>(
        `/trpc/branches.listBranchOrgStructure?input=${encodeURIComponent(JSON.stringify({ branchId }))}`,
        { method: 'GET', cookie },
      ),
      apiRequest<{ result?: { data?: Record<string, number> } }>(
        `/trpc/orders.statusCounts?input=${encodeURIComponent(JSON.stringify({ branchId, ...dateRange }))}`,
        { method: 'GET', cookie },
      ),
    ]);

    if (!overviewRes.ok) {
      if (overviewRes.status === 403) {
        throw redirect('/admin/unauthorized');
      }
      const errMsg = extractApiErrorMessage(overviewRes.data, 'Unable to load branch');
      throw new Response(errMsg, {
        status: overviewRes.status >= 400 && overviewRes.status < 600 ? overviewRes.status : 500,
      });
    }

    const overview = overviewRes.data?.result?.data;
    if (!overview) throw new Response('Branch not found', { status: 404 });

    const allUsers: UserOption[] = (usersRes.data?.result?.data?.users ?? []).filter(
      (u) => u.role !== 'SUPER_ADMIN' && u.role !== 'ADMIN',
    );

    const orgStructure: BranchOrgStructurePayload = orgRes.ok
      ? ((orgRes.data?.result?.data as BranchOrgStructurePayload | undefined) ?? {
          departments: [],
        })
      : { departments: [] };
    const teams: BranchTeamWithMembers[] = orgStructure.departments.flatMap((d) => d.teams);

    // Phase C — fetch overridable team settings for every team in parallel.
    // Each call returns { department, catalog, settings } where `settings` is
    // an array of EffectiveTeamSetting objects with the resolved value + source.
    const teamSettingsEntries = await Promise.all(
      teams.map(async (team) => {
        const res = await apiRequest<{ result?: { data?: TeamSettingsBundle } }>(
          `/trpc/branches.listTeamSettings?input=${encodeURIComponent(JSON.stringify({ teamId: team.id }))}`,
          { method: 'GET', cookie },
        );
        return [team.id, res.ok ? (res.data?.result?.data ?? null) : null] as const;
      }),
    );
    const teamSettingsByTeamId: Record<string, TeamSettingsBundle | null> =
      Object.fromEntries(teamSettingsEntries);

    const statusCounts: Record<string, number> = statusCountsRes.ok
      ? (statusCountsRes.data?.result?.data ?? {})
      : {};

    return { overview, allUsers, teams, orgStructure, teamSettingsByTeamId, statusCounts, dateFilters };
  })();

  return defer({ pageData, loadingVisibility });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

// ── Action ───────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  // Page-level gate is permissive: branches.manage (admin / Branch Admin) OR
  // any org-wide department head. Per-intent enforcement is done by the tRPC
  // procedures themselves: branch-CRUD intents (update / assignUser /
  // removeUser) call `permissionProcedure('branches.manage')` and team
  // intents call `assertCanManageTeamDept` / `assertCanManageTeamOrSupervisor`
  // (which check `branches.teams.cs` / `branches.teams.marketing`). So a HoM
  // can hit this action handler for createBranchTeam(MARKETING) but a CS
  // intent or a branch-update intent will be rejected by the API.
  await requirePermissionOrRoles(request, {
    roles: ['HEAD_OF_MARKETING', 'HEAD_OF_CS', 'HEAD_OF_LOGISTICS'],
    permission: 'branches.manage',
  });
  const cookie = getSessionCookie(request);
  const branchId = params.branchId ?? '';
  const form = await request.formData();
  const intent = form.get('intent') as string;

  if (intent === 'update') {
    const name = form.get('name')?.toString()?.trim();
    const status = form.get('status')?.toString();
    const res = await apiRequest('/trpc/branches.update', {
      method: 'POST',
      cookie,
      body: { branchId, name, status },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to update branch') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'assignUser') {
    const userId = form.get('userId')?.toString() ?? '';
    const roleInBranch = form.get('roleInBranch')?.toString() || undefined;
    const isPrimary = form.get('isPrimary') === 'true';
    if (!userId) return Response.json({ error: 'User is required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.assignUser', {
      method: 'POST',
      cookie,
      body: { branchId, userId, roleInBranch, isPrimary },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to add member') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'removeUser') {
    const userId = form.get('userId')?.toString() ?? '';
    if (!userId) return Response.json({ error: 'User is required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.removeUser', {
      method: 'POST',
      cookie,
      body: { branchId, userId },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to remove member') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'createBranchTeam') {
    const department = form.get('department')?.toString();
    if (department !== 'CS' && department !== 'MARKETING') {
      return Response.json({ error: 'Invalid department' }, { status: 400 });
    }
    const name = form.get('name')?.toString()?.trim() || undefined;
    const res = await apiRequest('/trpc/branches.createBranchTeam', {
      method: 'POST',
      cookie,
      body: { branchId, department, name },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to create team') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'updateBranchTeam') {
    const teamId = form.get('teamId')?.toString() ?? '';
    const name = form.get('name')?.toString()?.trim();
    if (!teamId) return Response.json({ error: 'Team is required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.updateBranchTeam', {
      method: 'POST',
      cookie,
      body: { teamId, name: name ?? null },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to update team') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'deleteBranchTeam') {
    const teamId = form.get('teamId')?.toString() ?? '';
    if (!teamId) return Response.json({ error: 'Team is required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.deleteBranchTeam', {
      method: 'POST',
      cookie,
      body: { teamId },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to delete team') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'addBranchTeamMember') {
    const teamId = form.get('teamId')?.toString() ?? '';
    const userId = form.get('userId')?.toString() ?? '';
    const isSupervisor = form.get('isSupervisor') === 'true';
    if (!teamId || !userId)
      return Response.json({ error: 'Team and user are required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.addBranchTeamMember', {
      method: 'POST',
      cookie,
      body: { teamId, userId, isSupervisor },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to add team member') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'addBranchTeamMembersBulk') {
    const teamId = form.get('teamId')?.toString() ?? '';
    const userIdsRaw = form.get('userIds')?.toString() ?? '[]';
    const isSupervisor = form.get('isSupervisor') === 'true';
    let userIds: string[] = [];
    try {
      const parsed = JSON.parse(userIdsRaw);
      if (Array.isArray(parsed)) userIds = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      return Response.json({ error: 'Invalid userIds payload' }, { status: 400 });
    }
    if (!teamId || userIds.length === 0) {
      return Response.json({ error: 'Team and at least one user are required' }, { status: 400 });
    }
    const res = await apiRequest('/trpc/branches.addBranchTeamMembersBulk', {
      method: 'POST',
      cookie,
      body: { teamId, userIds, isSupervisor },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to add team members') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'removeBranchTeamMember') {
    const teamId = form.get('teamId')?.toString() ?? '';
    const userId = form.get('userId')?.toString() ?? '';
    if (!teamId || !userId)
      return Response.json({ error: 'Team and user are required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.removeBranchTeamMember', {
      method: 'POST',
      cookie,
      body: { teamId, userId },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to remove team member') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'setBranchTeamMemberSupervisor') {
    const teamId = form.get('teamId')?.toString() ?? '';
    const userId = form.get('userId')?.toString() ?? '';
    const isSupervisor = form.get('isSupervisor') === 'true';
    if (!teamId || !userId)
      return Response.json({ error: 'Team and user are required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.setBranchTeamMemberSupervisor', {
      method: 'POST',
      cookie,
      body: { teamId, userId, isSupervisor },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to update supervisor flag') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'addBranchDepartmentMember') {
    const branchDepartmentId = form.get('branchDepartmentId')?.toString() ?? '';
    const userId = form.get('userId')?.toString() ?? '';
    if (!branchDepartmentId || !userId) {
      return Response.json({ error: 'Department and user are required' }, { status: 400 });
    }
    const res = await apiRequest('/trpc/branches.addBranchDepartmentMember', {
      method: 'POST',
      cookie,
      body: { branchDepartmentId, userId },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to add to department roster') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'removeBranchDepartmentMember') {
    const branchDepartmentId = form.get('branchDepartmentId')?.toString() ?? '';
    const userId = form.get('userId')?.toString() ?? '';
    if (!branchDepartmentId || !userId) {
      return Response.json({ error: 'Department and user are required' }, { status: 400 });
    }
    const res = await apiRequest('/trpc/branches.removeBranchDepartmentMember', {
      method: 'POST',
      cookie,
      body: { branchDepartmentId, userId },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to remove from department roster') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'setTeamSetting') {
    const teamId = form.get('teamId')?.toString() ?? '';
    const key = form.get('key')?.toString() ?? '';
    const valueJson = form.get('value')?.toString() ?? '';
    if (!teamId || !key)
      return Response.json({ error: 'Team and key are required' }, { status: 400 });
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(valueJson) as Record<string, unknown>;
    } catch {
      return Response.json({ error: 'Invalid value JSON' }, { status: 400 });
    }
    const res = await apiRequest('/trpc/branches.setTeamSetting', {
      method: 'POST',
      cookie,
      body: { teamId, key, value },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to update team setting') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  if (intent === 'clearTeamSetting') {
    const teamId = form.get('teamId')?.toString() ?? '';
    const key = form.get('key')?.toString() ?? '';
    if (!teamId || !key)
      return Response.json({ error: 'Team and key are required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.clearTeamSetting', {
      method: 'POST',
      cookie,
      body: { teamId, key },
    });
    if (!res.ok) {
      return Response.json(
        { error: extractApiErrorMessage(res.data, 'Failed to clear team override') },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Unknown intent' }, { status: 400 });
}

/** Page size for the Branch members table. Tuned to fit a viewport without scrolling. */
const MEMBERS_PAGE_SIZE = 20;

function BranchMembersPanel({
  branchId,
  department,
  members,
  canManageBranchMembership,
  canManageTeamAssignments,
  teamByUserId = {},
  supervisorUserIds,
  teamsForBulk = [],
  onBulkAddToTeam,
}: {
  /** Branch context for the backend search call. */
  branchId: string;
  /** Department this panel is scoped to — passed to the search API so a
   *  search inside the Marketing tab doesn't return CS matches. */
  department?: 'MARKETING' | 'CS' | 'OTHER';
  members: OverviewMember[];
  /** Branch membership changes (remove from branch) stay branch-manage only. */
  canManageBranchMembership: boolean;
  /** Team assignment changes follow per-department team-management access. */
  canManageTeamAssignments: boolean;
  /** userId → team name. When set, the table shows a Team column instead of
   *  Department; "—" if the member isn't on any team yet. */
  teamByUserId?: Record<string, string>;
  /** Set of userIds who are a supervisor on their team. Used to render a
   *  "Supervisor" pill alongside the (Head-only) role badge. */
  supervisorUserIds?: ReadonlySet<string>;
  /** Teams in this department — used to populate the bulk-add picker. */
  teamsForBulk?: Array<{ id: string; label: string }>;
  /** Bulk add/move handler. When provided alongside ≥1 team, the panel
   *  enables row selection + a bulk action bar above the table. Supervisor
   *  promotion is intentionally not part of this flow — promote a single
   *  member from the Teams tab instead. */
  onBulkAddToTeam?: (teamId: string, userIds: string[], teamLabel: string) => void;
}) {
  // The panel is rendered inside a department's detail view (already filtered
  // to that dept's members), so the dept-filter pills the panel used to show
  // were always showing a single locked option. Removed (CEO 2026-05-10).
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  // Backend-search fetcher — fires when the applied query is non-empty. Falls back to
  // the in-memory `members` prop when search is cleared so the initial paint
  // never has to wait for a network roundtrip. The user commits text with Search / Enter.
  const searchFetcher = useFetcher<{
    data?: {
      members: OverviewMember[];
      pagination: { total: number; page: number; pageSize: number; totalPages: number };
    };
    error?: string;
  }>();
  useEffect(() => {
    const q = appliedSearch.trim();
    if (q.length === 0) return; // empty search → use prop members; no fetch
    const params = new URLSearchParams({ branchId, q });
    if (department) params.set('department', department);
    searchFetcher.load(`/api/branch-members-search?${params.toString()}`);
    // We intentionally do NOT include searchFetcher in deps — fetcher refs
    // change identity every render which would cause a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSearch, branchId, department]);
  const isSearching = appliedSearch.trim().length > 0;
  const isFetcherBusy = searchFetcher.state !== 'idle';
  const fetcherError = searchFetcher.data?.error ?? null;
  const fetchedMembers = searchFetcher.data?.data?.members ?? null;
  const [removeTarget, setRemoveTarget] = useState<OverviewMember | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MEMBERS_PAGE_SIZE);
  const [selectedUserIds, setSelectedUserIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkTeamId, setBulkTeamId] = useState('');
  const bulkEnabled = canManageTeamAssignments && !!onBulkAddToTeam && teamsForBulk.length > 0;

  // Filter state. Binary team filter (CEO 2026-05-10): the per-team pills
  // were noisy (one pill per team, most empty), so we collapsed to the only
  // distinction that matters at the Members level — is this member on a team
  // or not. Pick a specific team from the Teams tab.
  const [teamFilter, setTeamFilter] = useState<'ALL' | 'ASSIGNED' | 'UNASSIGNED'>('ALL');

  const teamFilterOptions = useMemo(() => {
    let assigned = 0;
    let unassigned = 0;
    for (const m of members) {
      if (teamByUserId[m.userId]) assigned += 1;
      else unassigned += 1;
    }
    return [
      { value: 'ALL', label: `All (${members.length})` },
      { value: 'ASSIGNED', label: `Assigned to team (${assigned})` },
      { value: 'UNASSIGNED', label: `Unassigned (${unassigned})` },
    ];
  }, [members, teamByUserId]);

  // Source of truth swap: when the user has typed a search query, we render
  // the server-side matches from `searchFetcher`; otherwise we render the
  // panel's `members` prop (already dept-scoped). Either source still goes
  // through the team-filter pass below.
  const sourceMembers = isSearching
    ? // While the very first response is in flight, fall back to a
      //   client-side `name.includes(q)` against the prop list so the panel
      //   doesn't blank out for ~200ms; once the fetcher returns we switch
      //   to the authoritative server result.
      (fetchedMembers ?? members.filter((m) => m.name.toLowerCase().includes(appliedSearch.trim().toLowerCase())))
    : members;
  const filtered = useMemo(() => {
    return sourceMembers.filter((m) => {
      const onTeam = !!teamByUserId[m.userId];
      if (teamFilter === 'ASSIGNED' && !onTeam) return false;
      if (teamFilter === 'UNASSIGNED' && onTeam) return false;
      return true;
    });
  }, [sourceMembers, teamFilter, teamByUserId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Snap back to page 1 whenever any filter changes so the user isn't stranded
  // on a page that no longer has rows.
  useEffect(() => {
    setPage(1);
  }, [appliedSearch, teamFilter]);

  // Defensive: if `members` shrinks (e.g. someone is removed) and the current
  // page is now empty, step back rather than rendering nothing.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart = (page - 1) * pageSize;
  const pageRows = filtered.slice(pageStart, pageStart + pageSize);

  if (members.length === 0) {
    return (
      <EmptyState
        title="No members yet"
        description="Add staff to this branch so they can work in this location."
        variant="card"
      />
    );
  }

  const selectedCount = selectedUserIds.size;
  const submitBulk = () => {
    if (!onBulkAddToTeam || selectedCount === 0 || !bulkTeamId) return;
    const team = teamsForBulk.find((t) => t.id === bulkTeamId);
    onBulkAddToTeam(bulkTeamId, Array.from(selectedUserIds), team?.label ?? 'this team');
  };

  return (
    <div className="space-y-3">
      {/* Filters: compact dropdown + name search. Role pills dropped — within
          a dept, every member is the same role family (Media Buyer / CS
          Closer / Head). Heads + supervisors are surfaced as inline tags. */}
      <div className="space-y-2">
        <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:flex-nowrap md:items-start md:gap-3">
          <div className="min-w-0 w-full md:flex-1">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setAppliedSearch(searchDraft.trim());
              }}
            >
              <SearchInput
                value={searchDraft}
                onChange={(v) => {
                  setSearchDraft(v);
                  if (v.trim() === '') setAppliedSearch('');
                }}
                placeholder="Search by name or email…"
                aria-label="Search members by name or email"
                controlSize="sm"
                withSubmitButton
                wrapperClassName="w-full"
              />
            </form>
            {isSearching && isFetcherBusy ? (
              <p className="mt-1 text-mini text-app-fg-muted">Searching…</p>
            ) : isSearching && fetcherError ? (
              <p className="mt-1 text-mini text-danger-600 dark:text-danger-400">{fetcherError}</p>
            ) : null}
          </div>
          {teamFilterOptions.length > 1 ? (
            <div className="min-w-0 w-full md:flex-1">
              <FormSelect
                aria-label="Filter members by team assignment"
                value={teamFilter}
                onChange={(e) =>
                  setTeamFilter(e.target.value as 'ALL' | 'ASSIGNED' | 'UNASSIGNED')
                }
                options={teamFilterOptions}
                controlSize="sm"
                wrapperClassName="w-full"
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Bulk action bar — appears when any rows are selected. Add/move
          multiple members to the same team in one shot. Supervisor promotion
          is intentionally NOT here — that's done per-member from the Teams
          tab so the single-supervisor-per-team invariant stays obvious. */}
      {bulkEnabled && selectedCount > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-brand-300 dark:border-brand-700/50 bg-brand-50/50 dark:bg-brand-900/20 px-3 py-2">
          <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">
            {selectedCount} selected
          </p>
          <div className="flex-1 min-w-[12rem] max-w-xs">
            <SearchableSelect
              id="bulk-team-picker"
              value={bulkTeamId}
              onChange={setBulkTeamId}
              placeholder="Pick a team…"
              searchPlaceholder="Search teams..."
              options={teamsForBulk.map((t) => ({ value: t.id, label: t.label }))}
            />
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!bulkTeamId}
            onClick={submitBulk}
          >
            Add to team
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelectedUserIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          title="No matching members"
          description="Clear the search or try a different name."
          variant="card"
        />
      ) : (
        <>
          {/* Bulk select-all helper for the current page (mirrors the table
              header checkbox we removed when switching to cards). */}
          {bulkEnabled &&
            (() => {
              const visibleIds = pageRows.map((m) => m.userId);
              const allOnPageSelected =
                visibleIds.length > 0 && visibleIds.every((id) => selectedUserIds.has(id));
              return (
                <label className="flex items-center gap-2 text-xs text-app-fg-muted cursor-pointer select-none">
                  <Checkbox
                    checked={allOnPageSelected}
                    onChange={(e) =>
                      setSelectedUserIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) for (const id of visibleIds) next.add(id);
                        else for (const id of visibleIds) next.delete(id);
                        return next;
                      })
                    }
                  />
                  Select all on this page ({visibleIds.length})
                </label>
              );
            })()}

          {/* Members table — responsive cards on mobile, table on desktop */}
          <CompactTable
            rows={pageRows}
            rowKey={(m) => m.userId}
            selection={
              bulkEnabled
                ? {
                    selectedIds: selectedUserIds,
                    getRowId: (m) => m.userId,
                    onToggle: (rowId, selected) =>
                      setSelectedUserIds((prev) => {
                        const next = new Set(prev);
                        if (selected) next.add(rowId);
                        else next.delete(rowId);
                        return next;
                      }),
                    onToggleAll: (selectAll) =>
                      setSelectedUserIds((prev) => {
                        const next = new Set(prev);
                        if (selectAll) for (const m of pageRows) next.add(m.userId);
                        else for (const m of pageRows) next.delete(m.userId);
                        return next;
                      }),
                  }
                : undefined
            }
            columns={[
              {
                key: 'member',
                header: 'Member',
                render: (m) => {
                  const isHead = m.effectiveRole.startsWith('HEAD_OF_');
                  const isSupervisor = supervisorUserIds?.has(m.userId) ?? false;
                  return (
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <Link to={`/hr/users/${m.userId}`} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 truncate">{m.name}</Link>
                      {isHead && <RoleBadge role={m.effectiveRole} size="sm" />}
                      {isSupervisor && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-micro font-bold uppercase tracking-wide bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
                          Supervisor
                        </span>
                      )}
                    </div>
                  );
                },
              },
              {
                key: 'team',
                header: 'Team',
                hideOnMobile: true,
                render: (m) => {
                  const teamName = teamByUserId[m.userId];
                  return teamName ? (
                    <span className="text-sm text-app-fg">{teamName}</span>
                  ) : (
                    <span className="text-app-fg-muted text-sm">—</span>
                  );
                },
              },
              {
                key: 'actions',
                header: '',
                mobileLabel: 'Actions',
                align: 'right',
                tight: true,
                nowrap: true,
                mobileShowLabel: false,
                render: (m) => (
                  <div className="inline-flex flex-nowrap items-center justify-end gap-3 shrink-0">
                    <CompactTableActionButton to={`/hr/users/${m.userId}`}>
                      Profile
                    </CompactTableActionButton>
                    {canManageBranchMembership ? (
                      <CompactTableActionButton
                        tone="danger"
                        onClick={() => setRemoveTarget(m)}
                      >
                        Remove
                      </CompactTableActionButton>
                    ) : null}
                  </div>
                ),
              },
            ]}
            renderMobileCard={(m, _i, { rowSelection }) => {
              const isHead = m.effectiveRole.startsWith('HEAD_OF_');
              const isSupervisor = supervisorUserIds?.has(m.userId) ?? false;
              const teamName = teamByUserId[m.userId];
              return (
                <div className="card !p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {rowSelection}
                    <div className="flex-1 min-w-0">
                      <Link to={`/hr/users/${m.userId}`} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 truncate block">{m.name}</Link>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {isHead && <RoleBadge role={m.effectiveRole} size="sm" />}
                        {isSupervisor && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-micro font-bold uppercase tracking-wide bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
                            Supervisor
                          </span>
                        )}
                        {teamName && (
                          <span className="text-xs text-app-fg-muted">{teamName}</span>
                        )}
                        {!teamName && (
                          <span className="text-xs text-warning-600 dark:text-warning-400">Unassigned</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1 border-t border-app-border">
                    <CompactTableActionButton to={`/hr/users/${m.userId}`}>
                      Profile
                    </CompactTableActionButton>
                    {canManageBranchMembership && (
                      <CompactTableActionButton
                        tone="danger"
                        onClick={() => setRemoveTarget(m)}
                      >
                        Remove
                      </CompactTableActionButton>
                    )}
                  </div>
                </div>
              );
            }}
          />

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-sm text-app-fg-muted">
              Showing {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)}{' '}
              of {filtered.length}
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </div>
        </>
      )}

      {canManageBranchMembership && removeTarget && (
        <RemoveModal member={removeTarget} onClose={() => setRemoveTarget(null)} />
      )}
    </div>
  );
}

const DEPT_TEAM_LABEL: Record<'CS' | 'MARKETING', string> = {
  CS: 'Customer support',
  MARKETING: 'Marketing',
};

type BranchTeamMemberRow = BranchTeamWithMembers['members'][number];

type SquadConfirmIntent =
  | { kind: 'createTeam'; formData: FormData; deptLabel: string; teamLabel: string }
  | { kind: 'renameTeam'; formData: FormData; teamId: string; oldName: string; newName: string }
  | { kind: 'deleteTeam'; teamId: string; teamTitle: string }
  | {
      kind: 'addMember';
      formData: FormData;
      teamTitle: string;
      memberLabel: string;
      asSupervisor: boolean;
    }
  | {
      kind: 'toggleSupervisor';
      teamId: string;
      userId: string;
      memberName: string;
      teamTitle: string;
      nextValue: boolean;
    }
  | { kind: 'removeMember'; teamId: string; userId: string; memberName: string; teamTitle: string }
  | { kind: 'addRosterMember'; formData: FormData; memberLabel: string; deptLabel: string }
  | {
      kind: 'removeRosterMember';
      branchDepartmentId: string;
      userId: string;
      memberName: string;
      deptLabel: string;
    }
  | {
      kind: 'bulkAddMembers';
      formData: FormData;
      teamLabel: string;
      memberCount: number;
    };

function buildBranchTeamMemberColumns(
  team: BranchTeamWithMembers,
  teamTitle: string,
  canManage: boolean,
  isBusy: boolean,
  setConfirmIntent: (intent: SquadConfirmIntent) => void,
): CompactTableColumn<BranchTeamMemberRow>[] {
  return [
    {
      key: 'member',
      header: 'Member',
      render: (m) => <Link to={`/hr/users/${m.userId}`} className="font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300">{m.name}</Link>,
    },
    {
      key: 'role',
      header: 'Role',
      render: (m) => <RoleBadge role={m.role} size="sm" />,
    },
    {
      key: 'supervisor',
      header: 'Supervisor',
      render: (m) =>
        canManage ? (
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={m.isSupervisor}
              disabled={isBusy}
              onChange={() => {
                setConfirmIntent({
                  kind: 'toggleSupervisor',
                  teamId: team.id,
                  userId: m.userId,
                  memberName: m.name,
                  teamTitle,
                  nextValue: !m.isSupervisor,
                });
              }}
            />
            <span className="text-app-fg-muted text-xs">Supervisor</span>
          </label>
        ) : (
          <span className="text-app-fg-muted text-xs">{m.isSupervisor ? 'Yes' : 'No'}</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      mobileShowLabel: false,
      render: (m) =>
        canManage ? (
          <CompactTableActionButton
            tone="danger"
            disabled={isBusy}
            onClick={() =>
              setConfirmIntent({
                kind: 'removeMember',
                teamId: team.id,
                userId: m.userId,
                memberName: m.name,
                teamTitle,
              })
            }
          >
            Remove
          </CompactTableActionButton>
        ) : null,
    },
  ];
}

// ── Per-team settings (Phase C) ──────────────────────────────────────────────

// Mirror the four CS distribution options from the System page (Settings →
// CS distribution). Descriptions kept in lockstep so a team admin sees the
// same context the system admin sees when picking a strategy.
const DISPATCH_STRATEGIES: Array<{
  value: 'manual' | 'load_balanced' | 'performance' | 'claim';
  label: string;
  description: string;
}> = [
  {
    value: 'manual',
    label: 'Manual assignment',
    description:
      'No auto-assignment. New orders sit in the Unassigned queue until Head of CS assigns them. Agents cannot claim or pull orders themselves.',
  },
  {
    value: 'load_balanced',
    label: 'Load balanced',
    description:
      'Distribute by current workload: agents with fewer pending orders get new orders first. Tie-break: most idle.',
  },
  {
    value: 'performance',
    label: 'Performance',
    description:
      'Prioritise higher performers: agents with better delivery rate and confirmation rate get more orders, even if they already have more pending. Capacity limit still applies.',
  },
  {
    value: 'claim',
    label: 'Claim mode',
    description:
      'Orders are not auto-assigned. They appear in a shared Claim Queue visible to all available agents. First agent to click "Claim" takes the order. Atomic lock prevents double-claiming.',
  },
];

function describeSettingValue(key: string, value: Record<string, unknown> | null): string {
  if (value === null) return 'Not set';
  if (key === 'CS_DISPATCH_STRATEGY') {
    const s = String((value as { strategy?: unknown }).strategy ?? '');
    const found = DISPATCH_STRATEGIES.find((d) => d.value === s);
    return found ? found.label : s || 'Unknown strategy';
  }
  if (key === 'CS_CLAIM_CAP') {
    const c = (value as { cap?: unknown }).cap;
    return typeof c === 'number' ? `${c} order${c === 1 ? '' : 's'}` : 'Unknown cap';
  }
  return JSON.stringify(value);
}

function sourceBadge(setting: EffectiveTeamSetting): {
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
} {
  if (setting.source === 'enforced-system') return { label: 'System (locked)', tone: 'danger' };
  if (setting.source === 'team') return { label: 'Team override', tone: 'success' };
  if (setting.source === 'system') return { label: 'Inherited from system', tone: 'neutral' };
  return { label: 'Unset', tone: 'warning' };
}

// (SettingEditorModal removed — settings are now inline radio cards + number input.)

function TeamSettingsSection({
  team,
  teamTitle,
  bundle,
  canManage,
}: {
  team: BranchTeamWithMembers;
  teamTitle: string;
  bundle: TeamSettingsBundle;
  canManage: boolean;
}) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  useFetcherToast(fetcher.data, {
    successMessage: 'Team setting updated',
    skipErrorToast: !!surface.friendlyError,
  });
  const isBusy = fetcher.state !== 'idle';

  // Resolve each setting into its effective value — team override > system default.
  const dispatchSetting = bundle.settings.find((s) => s.key === 'CS_DISPATCH_STRATEGY');
  const claimCapSetting = bundle.settings.find((s) => s.key === 'CS_CLAIM_CAP');

  const effectiveStrategy =
    ((dispatchSetting?.value as { strategy?: string } | null)?.strategy as
      | 'manual' | 'load_balanced' | 'performance' | 'claim'
      | undefined) ?? 'manual';
  const effectiveCap =
    (claimCapSetting?.value as { cap?: number } | null)?.cap ?? 2;

  const [strategy, setStrategy] = useState(effectiveStrategy);
  const [claimCap, setClaimCap] = useState(String(effectiveCap));

  // Track whether the user changed anything from the effective value.
  const strategyChanged = strategy !== effectiveStrategy;
  const capChanged = Number(claimCap) !== effectiveCap;
  const hasChanges = strategyChanged || capChanged;

  // Sync drafts when server data reloads (after save).
  useEffect(() => { setStrategy(effectiveStrategy); }, [effectiveStrategy]);
  useEffect(() => { setClaimCap(String(effectiveCap)); }, [effectiveCap]);

  const handleSave = () => {
    // Save dispatch strategy if changed.
    if (strategyChanged && dispatchSetting) {
      fetcher.submit(
        {
          intent: 'setTeamSetting',
          teamId: team.id,
          key: 'CS_DISPATCH_STRATEGY',
          value: JSON.stringify({ strategy }),
        },
        { method: 'post' },
      );
    }
    // Save claim cap if changed.
    if (capChanged && claimCapSetting) {
      const n = Number(claimCap);
      if (Number.isFinite(n) && n >= 1 && n <= 50) {
        fetcher.submit(
          {
            intent: 'setTeamSetting',
            teamId: team.id,
            key: 'CS_CLAIM_CAP',
            value: JSON.stringify({ cap: Math.floor(n) }),
          },
          { method: 'post' },
        );
      }
    }
  };

  const systemStrategyLabel = describeSettingValue(
    'CS_DISPATCH_STRATEGY',
    dispatchSetting?.systemValue ?? null,
  );

  return (
    <div className="border-t border-app-border pt-4 space-y-4">
      <div>
        <p className="text-sm font-semibold text-app-fg">Team configuration</p>
        <p className="text-xs text-app-fg-muted mt-0.5">
          Select how orders are distributed to agents on this team.
          {dispatchSetting?.systemValue && (
            <> System default: <strong>{systemStrategyLabel}</strong>.</>
          )}
        </p>
      </div>

      <ModalFetcherInlineError message={surface.friendlyError ?? null} />

      {/* CS order distribution — radio cards */}
      {dispatchSetting && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-app-fg-muted uppercase tracking-wide">
            CS order distribution
          </p>
          <div className="space-y-2">
            {DISPATCH_STRATEGIES.map((opt) => {
              const isSelected = strategy === opt.value;
              const isLocked = dispatchSetting.systemEnforced;
              return (
                <label
                  key={opt.value}
                  className={[
                    'flex gap-3 rounded-lg border p-3 transition-colors',
                    isLocked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
                    isSelected
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                      : 'border-app-border hover:bg-app-hover',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name={`strategy-${team.id}`}
                    value={opt.value}
                    checked={isSelected}
                    onChange={() => !isLocked && setStrategy(opt.value)}
                    disabled={isLocked || !canManage}
                    className="mt-1 accent-brand-600"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-app-fg">{opt.label}</p>
                    <p className="text-xs text-app-fg-muted mt-0.5">{opt.description}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* CS claim cap — inline number input (only relevant for claim mode) */}
      {claimCapSetting && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-app-fg-muted uppercase tracking-wide">
            CS claim cap
          </p>
          <div className="flex items-center gap-3">
            <TextInput
              id={`claim-cap-${team.id}`}
              type="number"
              min={1}
              max={50}
              value={claimCap}
              onChange={(e) => setClaimCap(e.target.value)}
              disabled={claimCapSetting.systemEnforced || !canManage}
              wrapperClassName="w-24"
            />
            <span className="text-xs text-app-fg-muted">
              Max unconfirmed orders per agent in claim mode.
            </span>
          </div>
        </div>
      )}

      {/* Save */}
      {canManage && (
        <div className="flex items-center gap-3 pt-1">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!hasChanges || isBusy}
            loading={isBusy}
            loadingText="Saving…"
            onClick={handleSave}
          >
            Save changes
          </Button>
          {hasChanges && (
            <span className="text-xs text-app-fg-muted">Unsaved changes</span>
          )}
        </div>
      )}
    </div>
  );
}

function BranchSupervisorTeamsPanel({
  orgStructure: serverOrgStructure,
  branchMembers,
  canManageCSTeams,
  canManageMarketingTeams,
  canManageBranchPage,
  teamSettingsByTeamId,
  statusCounts,
  dateFilters,
}: {
  orgStructure: BranchOrgStructurePayload;
  branchMembers: OverviewMember[];
  canManageCSTeams: boolean;
  canManageMarketingTeams: boolean;
  canManageBranchPage: boolean;
  teamSettingsByTeamId: Record<string, TeamSettingsBundle | null>;
  statusCounts: Record<string, number>;
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  // Master/detail navigation: null = master (department list), string = drilled
  // into that BranchDepartment id (manage members + roster + squads).
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  // Inside the detail view, switch between Overview / Members / Teams.
  // Default 'overview' so the drill-in opens with a summary.
  const [deptTab, setDeptTab] = useState<'overview' | 'members' | 'teams'>('overview');
  useEffect(() => {
    if (selectedDeptId) setDeptTab('overview');
  }, [selectedDeptId]);
  // Create-team modal — collects a team name before dispatching the create.
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [createTeamName, setCreateTeamName] = useState('');
  // Reset the input whenever the modal toggles.
  useEffect(() => {
    if (!createTeamOpen) setCreateTeamName('');
  }, [createTeamOpen]);
  const squadFetcher = useFetcher<{ success?: boolean; error?: string }>();
  // Optimistic overlay for assign / remove / supervisor-toggle so the panel
  // reflects the change on the same React tick the server confirms — instead
  // of waiting for the loader's network revalidation. The overlay drops
  // cleanly when the canonical orgStructure lands.
  const pendingTeamMutation = usePendingTeamMutation(squadFetcher);
  // Sticky create-team rows — see the useEffect block below for capture +
  // self-clear logic. Declared up here so the orgStructure memo can fold
  // them into the rendered list alongside `applyPendingTeamMutation`.
  const [stickyCreates, setStickyCreates] = useState<
    Array<{
      optimisticTeamId: string;
      branchDepartmentId: string;
      department: 'CS' | 'MARKETING';
      name: string;
      addedAt: number;
    }>
  >([]);
  // Sticky delete-team ids — keep deleted teams hidden locally even after
  // the optimistic overlay drops, until the canonical data also stops
  // returning them. Without this the row briefly reappears between the
  // pendingTeamMutation overlay dropping and the canonical refresh.
  const [stickyDeletes, setStickyDeletes] = useState<
    Array<{ teamId: string; addedAt: number }>
  >([]);
  const orgStructure = useMemo(() => {
    const withPending = applyPendingTeamMutation(
      serverOrgStructure,
      pendingTeamMutation,
      branchMembers,
    );
    const deletedIds = new Set(stickyDeletes.map((sd) => sd.teamId));
    const baseDepartments = withPending.departments.map((d) => {
      // First pass: hide any team that was just deleted (sticky filter).
      if (deletedIds.size === 0) return d;
      const filtered = d.teams.filter((t) => !deletedIds.has(t.id));
      return filtered.length === d.teams.length ? d : { ...d, teams: filtered };
    });
    if (stickyCreates.length === 0) {
      return deletedIds.size === 0 ? withPending : { departments: baseDepartments };
    }
    // Second pass: append each sticky create to its dept block, but only if
    // the same dept doesn't already contain a real team with the same name
    // (the canonical row landed) AND the pending overlay didn't already
    // inject a synthetic with the same id.
    return {
      departments: baseDepartments.map((d) => {
        const adds = stickyCreates.filter(
          (sc) =>
            sc.branchDepartmentId === d.department.id &&
            !d.teams.some((t) => t.id === sc.optimisticTeamId) &&
            !d.teams.some(
              (t) => !isOptimisticId(t.id) && (t.name?.trim() ?? '') === sc.name,
            ),
        );
        if (adds.length === 0) return d;
        const synthetic: BranchTeamWithMembers[] = adds.map((sc) => ({
          id: sc.optimisticTeamId,
          branchId: d.department.branchId,
          branchDepartmentId: d.department.id,
          department: sc.department,
          name: sc.name,
          createdAt: new Date(sc.addedAt).toISOString(),
          updatedAt: null,
          members: [],
        }));
        return { ...d, teams: [...d.teams, ...synthetic] };
      }),
    };
  }, [serverOrgStructure, pendingTeamMutation, branchMembers, stickyCreates, stickyDeletes]);
  const flatTeams = orgStructure.departments.flatMap((d) => d.teams);
  const canManageAny = canManageCSTeams || canManageMarketingTeams;
  const canManageForDept = (dept: 'CS' | 'MARKETING'): boolean =>
    dept === 'CS' ? canManageCSTeams : canManageMarketingTeams;
  const squadSurface = useFetcherActionSurface(squadFetcher);
  const [confirmIntent, setConfirmIntent] = useState<SquadConfirmIntent | null>(null);
  const [openTeamId, setOpenTeamId] = useState<string | null>(flatTeams[0]?.id ?? null);
  // Controlled state for the per-team add-member SearchableSelect.
  const [addMemberByTeam, setAddMemberByTeam] = useState<Record<string, string>>({});

  useFetcherToast(squadFetcher.data, {
    successMessage: 'Teams updated',
    skipErrorToast: !!squadSurface.friendlyError,
  });

  const isBusy = squadFetcher.state !== 'idle';

  useEffect(() => {
    if (squadFetcher.state === 'idle' && squadFetcher.data?.success) {
      setConfirmIntent(null);
    }
  }, [squadFetcher.state, squadFetcher.data]);

  /**
   * The route is served by `cachedClientLoader`. Remix's automatic post-action
   * revalidation runs `clientLoader` first — if we let it hit a warm cache it
   * returns the pre-mutation snapshot and the panel keeps showing the deleted
   * team / removed member until the user hits refresh. Drop the cache BEFORE
   * the submit so that auto-revalidation falls through to the server on the
   * very first round-trip.
   */
  const submitSquadMutation = useCallback(
    (payload: Record<string, string>) => {
      if (typeof window !== 'undefined') {
        invalidateCachedLoader(window.location.pathname);
      }
      squadFetcher.submit(payload, { method: 'post' });
    },
    [squadFetcher],
  );

  // Auto-close the create-team modal once the create finishes successfully.
  // Brief delay (700 ms) so the success toast pops + the optimistic row
  // appears in the list BEFORE the modal vanishes — gives the operator
  // visible confirmation that their team was created.
  const lastClosedSuccessRef = useRef<unknown>(null);
  useEffect(() => {
    if (!createTeamOpen) return;
    if (squadFetcher.state !== 'idle') return;
    if (!squadFetcher.data?.success) return;
    if (lastClosedSuccessRef.current === squadFetcher.data) return;
    lastClosedSuccessRef.current = squadFetcher.data;
    const t = setTimeout(() => setCreateTeamOpen(false), 700);
    return () => clearTimeout(t);
  }, [createTeamOpen, squadFetcher.state, squadFetcher.data]);

  // Belt-and-braces revalidation: Remix's auto-revalidation after a fetcher
  // action SHOULD pick up the new team, but the canonical data was sometimes
  // not landing in time for the optimistic overlay to drop cleanly (the team
  // would "come and leave" instead of swapping to the real row). Firing an
  // explicit revalidate() guarantees we see the fresh org structure.
  const teamsRevalidator = useRevalidator();
  const lastRevalidatedRef = useRef<unknown>(null);
  useEffect(() => {
    if (
      squadFetcher.state === 'idle' &&
      squadFetcher.data?.success &&
      // Only fire once per success transition — guard with a ref so a
      // re-render with the same fetcher.data doesn't re-trigger.
      lastRevalidatedRef.current !== squadFetcher.data
    ) {
      lastRevalidatedRef.current = squadFetcher.data;
      if (typeof window !== 'undefined') {
        invalidateCachedLoader(window.location.pathname);
      }
      teamsRevalidator.revalidate();
    }
  }, [squadFetcher.state, squadFetcher.data, teamsRevalidator]);

  // ── Sticky create-team overlay ────────────────────────────────────────
  // Belt-and-braces: even if the loader revalidation misses the new team
  // (deferred-stream race, weird cache, action posted under a parent route,
  // etc.), keep showing the synthetic row until the canonical orgStructure
  // proves it landed. State is declared above (alongside the orgStructure
  // memo); the effects below capture and self-clear entries.
  const recordedFormRef = useRef<unknown>(null);

  // Capture an entry whenever a createBranchTeam succeeds. We watch the
  // 'loading' window (between submitting and idle) — at that point
  // `fetcher.data.success` is set AND `fetcher.formData` is still present.
  // Once state goes 'idle', Remix nulls formData, so capturing later isn't
  // possible. Dedupe via the formData reference so a re-render with the same
  // fetcher state doesn't re-record.
  useEffect(() => {
    if (squadFetcher.state === 'submitting') return;
    if (!squadFetcher.data?.success) return;
    const fd = squadFetcher.formData;
    if (!fd) return;
    if (recordedFormRef.current === fd) return;
    recordedFormRef.current = fd;
    const intent = fd.get('intent')?.toString();
    if (intent !== 'createBranchTeam') return;
    const department = fd.get('department')?.toString();
    if (department !== 'CS' && department !== 'MARKETING') return;
    const name = fd.get('name')?.toString().trim();
    if (!name) return;
    const dept = serverOrgStructure.departments.find(
      (d) => d.department.department === department,
    );
    if (!dept) return;
    setStickyCreates((prev) => [
      ...prev,
      {
        optimisticTeamId: optimisticId(`${department}:${name}:${Date.now()}`),
        branchDepartmentId: dept.department.id,
        department,
        name,
        addedAt: Date.now(),
      },
    ]);
  }, [squadFetcher.state, squadFetcher.data, squadFetcher.formData, serverOrgStructure]);

  // Drop entries the moment the canonical data shows a matching real team —
  // or 15 s after they were added (safety so a permanently failed
  // revalidation doesn't leave a stale ghost row forever).
  useEffect(() => {
    if (stickyCreates.length === 0) return;
    const now = Date.now();
    const next = stickyCreates.filter((sc) => {
      if (now - sc.addedAt > 15_000) return false;
      const dept = serverOrgStructure.departments.find(
        (d) => d.department.id === sc.branchDepartmentId,
      );
      if (!dept) return true; // dept missing — keep the sticky entry
      const matched = dept.teams.some(
        (t) => !isOptimisticId(t.id) && (t.name?.trim() ?? '') === sc.name,
      );
      return !matched;
    });
    if (next.length !== stickyCreates.length) {
      setStickyCreates(next);
    }
  }, [serverOrgStructure, stickyCreates]);

  // Schedule a re-evaluation at the 15 s mark so the safety-hatch drop fires
  // even when nothing else triggers a render.
  useEffect(() => {
    if (stickyCreates.length === 0) return;
    const oldest = stickyCreates.reduce((min, sc) => Math.min(min, sc.addedAt), Date.now());
    const remaining = Math.max(0, 15_000 - (Date.now() - oldest));
    const t = setTimeout(() => setStickyCreates((p) => [...p]), remaining + 50);
    return () => clearTimeout(t);
  }, [stickyCreates]);

  // ── Sticky delete capture ─────────────────────────────────────────────
  // Same lifecycle pattern as stickyCreates above, but inverted: hold onto
  // the deleted teamId so the row stays hidden even after the optimistic
  // overlay drops. Self-clears when the canonical data also stops returning
  // the team, or after the 15 s safety hatch.
  const recordedDeleteFormRef = useRef<unknown>(null);
  useEffect(() => {
    if (squadFetcher.state === 'submitting') return;
    if (!squadFetcher.data?.success) return;
    const fd = squadFetcher.formData;
    if (!fd) return;
    if (recordedDeleteFormRef.current === fd) return;
    recordedDeleteFormRef.current = fd;
    const intent = fd.get('intent')?.toString();
    if (intent !== 'deleteBranchTeam') return;
    const teamId = fd.get('teamId')?.toString();
    if (!teamId) return;
    setStickyDeletes((prev) =>
      prev.some((sd) => sd.teamId === teamId) ? prev : [...prev, { teamId, addedAt: Date.now() }],
    );
  }, [squadFetcher.state, squadFetcher.data, squadFetcher.formData]);

  // Drop sticky-delete entries once the canonical data confirms the team is
  // really gone, or after 15 s safety hatch.
  useEffect(() => {
    if (stickyDeletes.length === 0) return;
    const now = Date.now();
    const liveIds = new Set(
      serverOrgStructure.departments.flatMap((d) => d.teams.map((t) => t.id)),
    );
    const next = stickyDeletes.filter((sd) => {
      if (now - sd.addedAt > 15_000) return false;
      // Keep filtering as long as the canonical still has the row.
      return liveIds.has(sd.teamId);
    });
    if (next.length !== stickyDeletes.length) {
      setStickyDeletes(next);
    }
  }, [serverOrgStructure, stickyDeletes]);

  // Safety-hatch timer for stickyDeletes — same trick as stickyCreates.
  useEffect(() => {
    if (stickyDeletes.length === 0) return;
    const oldest = stickyDeletes.reduce((min, sd) => Math.min(min, sd.addedAt), Date.now());
    const remaining = Math.max(0, 15_000 - (Date.now() - oldest));
    const t = setTimeout(() => setStickyDeletes((p) => [...p]), remaining + 50);
    return () => clearTimeout(t);
  }, [stickyDeletes]);

  const rosterAddOptions = (deptBlock: BranchOrgDepartmentBlock) => {
    const lane = deptBlock.department.department;
    const inSquads = new Set(deptBlock.teams.flatMap((t) => t.members.map((m) => m.userId)));
    const onRoster = new Set(deptBlock.roster.map((r) => r.userId));
    return branchMembers
      .filter((m) => m.department === lane && !inSquads.has(m.userId) && !onRoster.has(m.userId))
      .map((m) => ({
        value: m.userId,
        label: `${m.name} · ${formatRoleLabel(m.effectiveRole)}`,
      }));
  };

  const addOptions = (
    dept: 'CS' | 'MARKETING',
    team: BranchTeamWithMembers,
    rosterUserIds: Set<string>,
  ) => {
    const onTeam = new Set(team.members.map((m) => m.userId));
    return branchMembers
      .filter((m) => m.department === dept && !onTeam.has(m.userId) && !rosterUserIds.has(m.userId))
      .map((m) => ({
        value: m.userId,
        label: `${m.name} · ${formatRoleLabel(m.effectiveRole)}`,
      }));
  };

  const submitConfirmed = useCallback(() => {
    if (!confirmIntent) return;
    switch (confirmIntent.kind) {
      case 'createTeam':
      case 'renameTeam':
      case 'addMember': {
        // Convert FormData → plain Record so the submit goes through Remix's
        // urlencoded path (matches deleteTeam / removeMember etc.). Sending
        // raw FormData was inconsistent with the other intents and caused
        // the create-team click to no-op for some browsers.
        const payload: Record<string, string> = {};
        for (const [k, v] of confirmIntent.formData.entries()) {
          payload[k] = typeof v === 'string' ? v : '';
        }
        submitSquadMutation(payload);
        break;
      }
      case 'deleteTeam':
        submitSquadMutation({ intent: 'deleteBranchTeam', teamId: confirmIntent.teamId });
        break;
      case 'toggleSupervisor':
        submitSquadMutation({
          intent: 'setBranchTeamMemberSupervisor',
          teamId: confirmIntent.teamId,
          userId: confirmIntent.userId,
          isSupervisor: confirmIntent.nextValue ? 'true' : 'false',
        });
        break;
      case 'removeMember':
        submitSquadMutation({
          intent: 'removeBranchTeamMember',
          teamId: confirmIntent.teamId,
          userId: confirmIntent.userId,
        });
        break;
      case 'addRosterMember': {
        const payload: Record<string, string> = {};
        for (const [k, v] of confirmIntent.formData.entries()) {
          payload[k] = typeof v === 'string' ? v : '';
        }
        submitSquadMutation(payload);
        break;
      }
      case 'removeRosterMember':
        submitSquadMutation({
          intent: 'removeBranchDepartmentMember',
          branchDepartmentId: confirmIntent.branchDepartmentId,
          userId: confirmIntent.userId,
        });
        break;
      case 'bulkAddMembers': {
        const payload: Record<string, string> = {};
        for (const [k, v] of confirmIntent.formData.entries()) {
          payload[k] = typeof v === 'string' ? v : '';
        }
        submitSquadMutation(payload);
        break;
      }
    }
  }, [confirmIntent, submitSquadMutation]);

  const confirmModalProps = useMemo(() => {
    if (!confirmIntent) return null;
    switch (confirmIntent.kind) {
      case 'createTeam':
        return {
          title: 'Create team?',
          description: (
            <>
              Create <strong>{confirmIntent.teamLabel}</strong> in {confirmIntent.deptLabel}?
            </>
          ),
          confirmLabel: 'Create team',
          variant: 'warning' as const,
        };
      case 'renameTeam':
        return {
          title: 'Rename team?',
          description: (
            <>
              Rename <strong>{confirmIntent.oldName || '(unnamed team)'}</strong> to{' '}
              <strong>{confirmIntent.newName || '(unnamed team)'}</strong>?
            </>
          ),
          confirmLabel: 'Save name',
          variant: 'warning' as const,
        };
      case 'deleteTeam':
        return {
          title: 'Delete team?',
          description: (
            <>
              Delete <strong>{confirmIntent.teamTitle}</strong>? Members stay on the branch but lose
              their team supervisor / membership. This cannot be undone.
            </>
          ),
          confirmLabel: 'Delete team',
          variant: 'danger' as const,
        };
      case 'addMember':
        return {
          title: 'Add to team?',
          description: (
            <>
              Add <strong>{confirmIntent.memberLabel}</strong> to{' '}
              <strong>{confirmIntent.teamTitle}</strong>
              {confirmIntent.asSupervisor ? ' as a supervisor' : ''}?
            </>
          ),
          confirmLabel: 'Add to team',
          variant: 'warning' as const,
        };
      case 'toggleSupervisor':
        return {
          title: confirmIntent.nextValue ? 'Promote to supervisor?' : 'Remove supervisor?',
          description: confirmIntent.nextValue ? (
            <>
              Make <strong>{confirmIntent.memberName}</strong> a supervisor on{' '}
              <strong>{confirmIntent.teamTitle}</strong>? Supervisors can mirror supervised staff,
              assign Sales orders, and send marketing funding within their team.
            </>
          ) : (
            <>
              Remove supervisor privileges from <strong>{confirmIntent.memberName}</strong> on{' '}
              <strong>{confirmIntent.teamTitle}</strong>? They remain on the team as a regular
              member.
            </>
          ),
          confirmLabel: confirmIntent.nextValue ? 'Promote' : 'Remove supervisor',
          variant: 'warning' as const,
        };
      case 'removeMember':
        return {
          title: 'Remove from team?',
          description: (
            <>
              Remove <strong>{confirmIntent.memberName}</strong> from{' '}
              <strong>{confirmIntent.teamTitle}</strong>? They remain on the branch but lose this
              team membership.
            </>
          ),
          confirmLabel: 'Remove',
          variant: 'danger' as const,
        };
      case 'addRosterMember':
        return {
          title: 'Add to department roster?',
          description: (
            <>
              Place <strong>{confirmIntent.memberLabel}</strong> on the{' '}
              <strong>{confirmIntent.deptLabel}</strong> roster without assigning a team? They
              report to the department head until you move them into a team.
            </>
          ),
          confirmLabel: 'Add to roster',
          variant: 'warning' as const,
        };
      case 'removeRosterMember':
        return {
          title: 'Remove from department roster?',
          description: (
            <>
              Remove <strong>{confirmIntent.memberName}</strong> from the{' '}
              <strong>{confirmIntent.deptLabel}</strong> roster? They remain on the branch.
            </>
          ),
          confirmLabel: 'Remove',
          variant: 'danger' as const,
        };
      case 'bulkAddMembers':
        return {
          title: 'Add members to team?',
          description: (
            <>
              Add <strong>{confirmIntent.memberCount}</strong> selected member
              {confirmIntent.memberCount === 1 ? '' : 's'} to{' '}
              <strong>{confirmIntent.teamLabel}</strong>? Anyone already on a different team in this
              department will be moved.
            </>
          ),
          confirmLabel: 'Add to team',
          variant: 'warning' as const,
        };
    }
  }, [confirmIntent]);

  const createTeamDeptOptions = [
    canManageCSTeams ? { value: 'CS', label: DEPT_TEAM_LABEL.CS } : null,
    canManageMarketingTeams ? { value: 'MARKETING', label: DEPT_TEAM_LABEL.MARKETING } : null,
  ].filter((o): o is { value: string; label: string } => o !== null);
  const defaultCreateDept = canManageCSTeams ? 'CS' : 'MARKETING';

  // Per-viewer dept visibility (CEO directive 2026-05-10): Head of Marketing
  // shouldn't see the Sales department, Head of CS shouldn't see Marketing —
  // they only manage one of the two. SuperAdmin / Admin / Branch Admin /
  // HR Manager keep `canManageCSTeams && canManageMarketingTeams` so they
  // see both. The same `canManage*` flags drive both visibility AND
  // management since "view-only on a foreign dept" isn't a CEO-supported
  // role on this page.
  const visibleDepartments = useMemo(
    () =>
      orgStructure.departments.filter((d) =>
        d.department.department === 'CS' ? canManageCSTeams : canManageMarketingTeams,
      ),
    [orgStructure.departments, canManageCSTeams, canManageMarketingTeams],
  );

  // Resolve the selected dept block (or null = master view). Stale ids
  // (deleted/migrated) gracefully fall back to master view. Defensive: if
  // the URL/state points to a dept the viewer can't see, treat it as null
  // so the master view shows the cards they're allowed to see.
  const selectedDept = selectedDeptId
    ? (visibleDepartments.find((d) => d.department.id === selectedDeptId) ?? null)
    : null;

  return (
    <div className="space-y-6">
      {selectedDept === null ? (
        // ── Master view: department cards. Help text + Add member CTA live
        // inside each department's "Manage" detail view, not at the master level.
        <>
          {visibleDepartments.length === 0 ? (
            <EmptyState
              title="No departments to manage"
              description="You don't have permission to manage any department on this branch."
            />
          ) : (
            // Department cards — same shape as `/admin/branches` list cards
            // and `/admin/marketing/forms` (CEO directive 2026-05-10):
            // `bg-app-elevated rounded-xl border` shell, brand-coloured hover,
            // whole-card-clickable via an overlay button.
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleDepartments.map((deptBlock) => {
                const lane = deptBlock.department.department;
                const deptTitle = DEPT_TEAM_LABEL[lane];
                const memberCount = branchMembers.filter((m) => m.department === lane).length;
                const supervisorCount = deptBlock.teams.reduce(
                  (acc, t) => acc + t.members.filter((m) => m.isSupervisor).length,
                  0,
                );
                return (
                  <article
                    key={deptBlock.department.id}
                    className="group relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200 flex flex-col min-h-[180px] focus-within:ring-2 focus-within:ring-brand-500"
                  >
                    {/* Overlay button covers the whole card so the entire
                        surface opens the dept detail view. Inner content
                        sits above with `relative z-10 pointer-events-none`. */}
                    <button
                      type="button"
                      onClick={() => setSelectedDeptId(deptBlock.department.id)}
                      aria-label={`Manage ${deptTitle.toLowerCase()}`}
                      className="absolute inset-0 z-0 rounded-xl focus:outline-none"
                    />

                    <div className="relative z-10 flex items-start justify-between gap-3 mb-2 pointer-events-none">
                      <h3 className="font-semibold text-app-fg text-base leading-snug min-w-0 flex-1 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                        {deptTitle}
                      </h3>
                      <span
                        className={`shrink-0 inline-flex items-center rounded-md px-2 py-0.5 text-micro font-semibold uppercase tracking-wide ${
                          lane === 'CS'
                            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                            : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
                        }`}
                      >
                        {lane}
                      </span>
                    </div>

                    <div className="relative z-10 text-sm text-app-fg-muted mb-4 flex-1 pointer-events-none">
                      <span className="inline-flex items-center rounded-md border border-app-border bg-app-hover px-1.5 py-0.5 font-mono text-mini font-semibold text-app-fg-muted">
                        {lane}
                      </span>
                      <span className="mx-1.5">·</span>
                      <span>
                        {memberCount} member{memberCount === 1 ? '' : 's'}
                      </span>
                      <p className="mt-2 text-sm text-app-fg-muted">
                        {lane === 'CS'
                          ? 'Manage customer support'
                          : 'Manage marketing'}
                      </p>
                    </div>

                    <div className="relative z-10 grid grid-cols-3 gap-2 mb-4 pointer-events-none">
                      <div className="rounded-lg border border-app-border bg-app-hover/40 px-3 py-2">
                        <p className="text-micro uppercase tracking-wide text-app-fg-muted">
                          Members
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-app-fg">
                          {memberCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-app-border bg-app-hover/40 px-3 py-2">
                        <p className="text-micro uppercase tracking-wide text-app-fg-muted">
                          Teams
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-400">
                          {deptBlock.teams.length}
                        </p>
                      </div>
                      <div className="rounded-lg border border-app-border bg-app-hover/40 px-3 py-2">
                        <p className="text-micro uppercase tracking-wide text-app-fg-muted">
                          Supervisors
                        </p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-success-600 dark:text-success-400">
                          {supervisorCount}
                        </p>
                      </div>
                    </div>

                    <div className="relative z-10 flex items-center gap-2 pt-3 border-t border-app-border pointer-events-none">
                      <span className="ml-auto text-xs font-medium text-app-fg-muted group-hover:text-brand-600 dark:group-hover:text-brand-400 inline-flex items-center gap-1 transition-colors">
                        View details
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

        </>
      ) : (
        // ── Detail view: one dept's members + roster + squads ──
        <>
          {(() => {
            const deptMemberCount = branchMembers.filter(
              (m) => m.department === selectedDept.department.department,
            ).length;
            const canCreateTeam = canManageForDept(selectedDept.department.department);
            return (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedDeptId(null)}
                      className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline mb-1 inline-flex items-center gap-1"
                    >
                      ← Back to departments
                    </button>
                    <h2 className="text-lg font-semibold text-app-fg">
                      {DEPT_TEAM_LABEL[selectedDept.department.department]} department
                    </h2>
                  </div>
                  {canCreateTeam && (
                    <PageHeaderMobileTools
                      sheetTitle="Department tools"
                      triggerAriaLabel="Department actions"
                      showMobileRefresh={false}
                      desktop={
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => setCreateTeamOpen(true)}
                        >
                          + Create team
                        </Button>
                      }
                      sheet={({ closeSheet }) => (
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          className="h-12 w-full justify-center"
                          onClick={() => {
                            closeSheet();
                            setCreateTeamOpen(true);
                          }}
                        >
                          + Create team
                        </Button>
                      )}
                    />
                  )}
                </div>

                {/* Inner tabs — Overview / Members / Teams */}
                <div className="border-b border-app-border -mb-px">
                  <Tabs
                    value={deptTab}
                    onChange={(v) => setDeptTab(v as 'overview' | 'members' | 'teams')}
                    size="sm"
                    tabs={[
                      { value: 'overview', label: 'Overview' },
                      { value: 'members', label: `Members (${deptMemberCount})` },
                      { value: 'teams', label: `Teams (${selectedDept.teams.length})` },
                    ]}
                  />
                </div>
              </>
            );
          })()}

          {deptTab === 'overview' &&
            (() => {
              const lane = selectedDept.department.department;
              const deptMembers = branchMembers.filter((m) => m.department === lane);
              const supervisorCount = selectedDept.teams.reduce(
                (acc, t) => acc + t.members.filter((m) => m.isSupervisor).length,
                0,
              );
              const inTeamUserIds = new Set(
                selectedDept.teams.flatMap((t) => t.members.map((m) => m.userId)),
              );
              // Roster removed (CEO 2026-05-10) — every dept member is either on
              // a team or unassigned. The "On roster" tile went with it.
              const unassignedCount = deptMembers.filter(
                (m) => !inTeamUserIds.has(m.userId),
              ).length;

              const totalOrders = Object.values(statusCounts).reduce((a, b) => a + b, 0);
              const confirmed = (statusCounts['CONFIRMED'] ?? 0) + (statusCounts['AGENT_ASSIGNED'] ?? 0) + (statusCounts['DISPATCHED'] ?? 0) + (statusCounts['IN_TRANSIT'] ?? 0);
              const delivered = statusCounts['DELIVERED'] ?? 0;
              const remitted = statusCounts['REMITTED'] ?? 0;
              const deliveryRate = totalOrders > 0 ? Math.round(((delivered + remitted) / totalOrders) * 100) : 0;

              return (
                <div className="space-y-4">
                  <OverviewStatStrip
                    mobileGrid
                    items={[
                      {
                        label: 'Members',
                        value: deptMembers.length,
                        valueClassName: 'text-app-fg',
                      },
                      {
                        label: 'Teams',
                        value: selectedDept.teams.length,
                        valueClassName: 'text-brand-600 dark:text-brand-400',
                      },
                      {
                        label: 'Supervisors',
                        value: supervisorCount,
                        valueClassName: 'text-success-600 dark:text-success-400',
                      },
                    ]}
                  />

                  {/* Performance for the period */}
                  <div className="card !p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <h3 className="text-sm font-semibold text-app-fg">Performance</h3>
                      <div className="hidden md:block">
                        <DateFilterBar
                          startDate={dateFilters.startDate}
                          endDate={dateFilters.endDate}
                          periodAllTime={dateFilters.periodAllTime}
                          chrome="pill"
                        />
                      </div>
                    </div>
                    <MobileDateFilterRow
                      startDate={dateFilters.startDate}
                      endDate={dateFilters.endDate}
                      periodAllTime={dateFilters.periodAllTime}
                    />
                    <OverviewStatStrip
                      mobileGrid
                      items={[
                        { label: 'Orders', value: totalOrders, valueClassName: 'text-app-fg' },
                        { label: 'Confirmed', value: confirmed, valueClassName: 'text-brand-600 dark:text-brand-400' },
                        { label: 'Delivered', value: delivered + remitted, valueClassName: 'text-success-600 dark:text-success-400' },
                        { label: 'Delivery rate', value: `${deliveryRate}%`, valueClassName: deliveryRate >= 50 ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400' },
                      ]}
                    />
                  </div>

                  {unassignedCount > 0 && (
                    <div className="rounded-md border border-warning-300 dark:border-warning-700/50 bg-warning-50/50 dark:bg-warning-900/20 px-3 py-2 text-sm text-warning-800 dark:text-warning-300">
                      {unassignedCount} member{unassignedCount === 1 ? '' : 's'} not on a team yet —
                      assign them under <strong>Members</strong> (select + bulk add) or{' '}
                      <strong>Teams</strong>.
                    </div>
                  )}
                </div>
              );
            })()}

          {deptTab === 'members' &&
            (() => {
              // Build userId → team-name map so the Members table can show the
              // member's team membership in place of the (now-redundant) Department.
              const teamByUserId: Record<string, string> = {};
              const supervisorUserIds = new Set<string>();
              const teamsForBulk: Array<{ id: string; label: string }> = [];
              for (const team of selectedDept.teams) {
                const teamName = team.name?.trim() || `${DEPT_TEAM_LABEL[team.department]} team`;
                teamsForBulk.push({ id: team.id, label: teamName });
                for (const m of team.members) {
                  teamByUserId[m.userId] = teamName;
                  if (m.isSupervisor) supervisorUserIds.add(m.userId);
                }
              }
              return (
                <BranchMembersPanel
                  branchId={selectedDept.department.branchId}
                  department={selectedDept.department.department}
                  members={branchMembers.filter(
                    (m) => m.department === selectedDept.department.department,
                  )}
                  canManageBranchMembership={canManageBranchPage}
                  canManageTeamAssignments={canManageForDept(selectedDept.department.department)}
                  teamByUserId={teamByUserId}
                  supervisorUserIds={supervisorUserIds}
                  teamsForBulk={teamsForBulk}
                  onBulkAddToTeam={(teamId, userIds, teamLabel) => {
                    // Always send isSupervisor=false from bulk — supervisor
                    // promotion happens per-member from the Teams tab.
                    const fd = new FormData();
                    fd.set('intent', 'addBranchTeamMembersBulk');
                    fd.set('teamId', teamId);
                    fd.set('userIds', JSON.stringify(userIds));
                    fd.set('isSupervisor', 'false');
                    setConfirmIntent({
                      kind: 'bulkAddMembers',
                      formData: fd,
                      teamLabel,
                      memberCount: userIds.length,
                    });
                  }}
                />
              );
            })()}

          {deptTab === 'teams' && (
            <div className="space-y-4">
              <ModalFetcherInlineError message={squadSurface.friendlyError || null} />

              {/* Teams list — collapsible cards. The Create team button lives
                  alongside the tabs (always visible, not duplicated here). */}
              {[selectedDept].map((deptBlock) => {
                const rosterUserIds = new Set(deptBlock.roster.map((r) => r.userId));
                return (
                  <div key={deptBlock.department.id} className="space-y-3">
                    {deptBlock.teams.length === 0 ? (
                      <p className="text-xs text-app-fg-muted text-center py-6">
                        No teams in this department yet. Click <strong>+ Create team</strong> in the
                        tab bar to add one.
                      </p>
                    ) : null}
                    {deptBlock.teams.map((team) => {
                      const title = team.name?.trim() || `${DEPT_TEAM_LABEL[team.department]} team`;
                      const pick = addOptions(team.department, team, rosterUserIds);
                      const supervisorCount = team.members.filter((m) => m.isSupervisor).length;
                      const isOpen = openTeamId === team.id;
                      const canManageThisTeam = canManageForDept(team.department);
                      // Synthetic row from `applyPendingTeamMutation`'s
                      // createTeam overlay — dim it and disable per-row actions
                      // until the loader revalidates with the canonical row.
                      const isOptimistic = isOptimisticId(team.id);
                      const isRenameBusy =
                        isBusy &&
                        confirmIntent?.kind === 'renameTeam' &&
                        confirmIntent.teamId === team.id;
                      const isDeleteBusy =
                        isBusy &&
                        confirmIntent?.kind === 'deleteTeam' &&
                        confirmIntent.teamId === team.id;
                      const isAddMemberBusy =
                        isBusy &&
                        confirmIntent?.kind === 'addMember' &&
                        confirmIntent.teamTitle === title;

                      return (
                        <div
                          key={team.id}
                          className={`card p-0 overflow-hidden ${isOptimistic ? 'opacity-60' : ''}`}
                          aria-busy={isOptimistic || undefined}
                        >
                          <Collapsible
                            open={isOpen}
                            onOpenChange={(next) => setOpenTeamId(next ? team.id : null)}
                            triggerClassName="px-4 py-3"
                            contentClassName="border-t border-app-border"
                            trigger={
                              <div className="flex flex-wrap items-center gap-3 min-w-0">
                                <div
                                  className={`shrink-0 inline-flex items-center justify-center rounded-md px-2 py-0.5 text-micro font-semibold uppercase tracking-wide ${
                                    team.department === 'CS'
                                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                                      : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
                                  }`}
                                >
                                  {DEPT_TEAM_LABEL[team.department]}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-app-fg truncate">
                                    {title}
                                    {isOptimistic ? (
                                      <span className="ml-2 text-micro uppercase tracking-wider rounded bg-app-hover text-app-fg-muted px-1.5 py-0.5 font-semibold align-middle">
                                        Creating…
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="text-xs text-app-fg-muted">
                                    {team.members.length} member
                                    {team.members.length === 1 ? '' : 's'}
                                    {supervisorCount > 0
                                      ? ` · ${supervisorCount} supervisor${supervisorCount === 1 ? '' : 's'}`
                                      : ''}
                                  </p>
                                </div>
                              </div>
                            }
                          >
                            <div className="p-4 space-y-4">
                              {canManageThisTeam ? (
                                <div className="flex flex-wrap items-end gap-2 justify-between">
                                  <squadFetcher.Form
                                    method="post"
                                    className="flex flex-wrap items-end gap-2"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      const fd = new FormData(e.currentTarget);
                                      const newName = fd.get('name')?.toString().trim() ?? '';
                                      const oldName = team.name?.trim() ?? '';
                                      if (newName === oldName) return;
                                      setConfirmIntent({
                                        kind: 'renameTeam',
                                        formData: fd,
                                        teamId: team.id,
                                        oldName: oldName || title,
                                        newName,
                                      });
                                    }}
                                  >
                                    <input type="hidden" name="intent" value="updateBranchTeam" />
                                    <input type="hidden" name="teamId" value={team.id} />
                                    <TextInput
                                      label="Rename"
                                      id={`rn-${team.id}`}
                                      name="name"
                                      defaultValue={team.name ?? ''}
                                      placeholder="Team name"
                                      controlSize="sm"
                                    />
                                    <Button
                                      type="submit"
                                      variant="secondary"
                                      size="sm"
                                      disabled={isBusy || isOptimistic}
                                      loading={isRenameBusy}
                                      loadingText="Saving…"
                                    >
                                      Save name
                                    </Button>
                                  </squadFetcher.Form>
                                  <Button
                                    type="button"
                                    variant="danger"
                                    size="sm"
                                    disabled={isBusy || isOptimistic}
                                    loading={isDeleteBusy}
                                    loadingText="Deleting…"
                                    onClick={() =>
                                      setConfirmIntent({
                                        kind: 'deleteTeam',
                                        teamId: team.id,
                                        teamTitle: title,
                                      })
                                    }
                                  >
                                    Delete team
                                  </Button>
                                </div>
                              ) : null}

                              <div className="overflow-x-auto">
                                <CompactTable
                                  withCard={false}
                                  className="min-w-full text-sm"
                                  columns={buildBranchTeamMemberColumns(
                                    team,
                                    title,
                                    canManageThisTeam,
                                    isBusy,
                                    setConfirmIntent,
                                  )}
                                  rows={team.members}
                                  rowKey={(m) => m.userId}
                                />
                              </div>

                              {teamSettingsByTeamId[team.id] &&
                                (teamSettingsByTeamId[team.id] as TeamSettingsBundle).catalog
                                  .length > 0 && (
                                  <TeamSettingsSection
                                    team={team}
                                    teamTitle={title}
                                    bundle={teamSettingsByTeamId[team.id] as TeamSettingsBundle}
                                    canManage={canManageThisTeam}
                                  />
                                )}

                              {canManageThisTeam ? (
                                <div className="border-t border-app-border pt-3 space-y-2">
                                  <p className="text-sm font-semibold text-app-fg">+ Add member</p>
                                  {pick.length === 0 ? (
                                    <p className="text-xs text-app-fg-muted">
                                      All eligible {DEPT_TEAM_LABEL[team.department].toLowerCase()}{' '}
                                      members are already on this team.
                                    </p>
                                  ) : (
                                    <squadFetcher.Form
                                      method="post"
                                      className="flex flex-wrap gap-3 items-end"
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        const fd = new FormData(e.currentTarget);
                                        const userId = fd.get('userId')?.toString() ?? '';
                                        if (!userId) return;
                                        const asSupervisor = fd.get('isSupervisor') === 'true';
                                        const memberOption = pick.find((p) => p.value === userId);
                                        setConfirmIntent({
                                          kind: 'addMember',
                                          formData: fd,
                                          teamTitle: title,
                                          memberLabel: memberOption?.label ?? 'this member',
                                          asSupervisor,
                                        });
                                      }}
                                    >
                                      <input
                                        type="hidden"
                                        name="intent"
                                        value="addBranchTeamMember"
                                      />
                                      <input type="hidden" name="teamId" value={team.id} />
                                      <div className="min-w-[12rem] flex-1">
                                        <input type="hidden" name="userId" value={addMemberByTeam[team.id] ?? ''} />
                                        <SearchableSelect
                                          id={`add-${team.id}`}
                                          value={addMemberByTeam[team.id] ?? ''}
                                          onChange={(v) => setAddMemberByTeam((prev) => ({ ...prev, [team.id]: v }))}
                                          required
                                          placeholder="Pick a member…"
                                          searchPlaceholder="Search members..."
                                          options={pick}
                                        />
                                      </div>
                                      <label
                                        className={[
                                          'flex items-center gap-2 text-xs pb-2',
                                          supervisorCount > 0
                                            ? 'text-app-fg-muted/60 cursor-not-allowed'
                                            : 'text-app-fg-muted',
                                        ].join(' ')}
                                        title={
                                          supervisorCount > 0
                                            ? 'This team already has a supervisor'
                                            : undefined
                                        }
                                      >
                                        <Checkbox
                                          name="isSupervisor"
                                          value="true"
                                          disabled={supervisorCount > 0}
                                        />
                                        Add as supervisor
                                      </label>
                                      <Button
                                        type="submit"
                                        variant="primary"
                                        size="sm"
                                        disabled={isBusy || isOptimistic || pick.length === 0}
                                        loading={isAddMemberBusy}
                                        loadingText="Adding…"
                                      >
                                        Add member
                                      </Button>
                                    </squadFetcher.Form>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </Collapsible>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {confirmIntent && confirmModalProps && (
        <ConfirmActionModal
          open
          onClose={() => {
            if (isBusy) return;
            setConfirmIntent(null);
          }}
          title={confirmModalProps.title}
          description={confirmModalProps.description}
          confirmLabel={confirmModalProps.confirmLabel}
          variant={confirmModalProps.variant}
          loading={isBusy}
          error={squadSurface.friendlyError ?? null}
          onConfirm={submitConfirmed}
        />
      )}

      {/* Create-team modal — captures the team name up-front (CEO 2026-05-10),
          then dispatches createBranchTeam directly via squadFetcher.submit. */}
      {createTeamOpen && selectedDept && (
        <Modal
          open
          onClose={() => {
            if (isBusy) return;
            setCreateTeamOpen(false);
          }}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="create-team-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="create-team-title" className="text-lg font-semibold text-app-fg">
                Create team
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5">
                New team in{' '}
                <span className="font-medium">
                  {DEPT_TEAM_LABEL[selectedDept.department.department]}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateTeamOpen(false)}
              disabled={isBusy}
              className="text-app-fg-muted hover:text-app-fg shrink-0"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto py-4 px-4 sm:px-5 space-y-3">
            <TextInput
              label="Team name"
              id="create-team-name"
              value={createTeamName}
              onChange={(e) => setCreateTeamName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && createTeamName.trim() && !isBusy) {
                  e.preventDefault();
                  // submitSquadMutation invalidates the cachedClientLoader
                  // BEFORE the submit so the post-action revalidation reads
                  // fresh data instead of the stale pre-mutation snapshot —
                  // which is what kept the new team invisible until refresh.
                  submitSquadMutation({
                    intent: 'createBranchTeam',
                    department: selectedDept.department.department,
                    name: createTeamName.trim(),
                  });
                }
              }}
              placeholder="e.g. Team A"
              required
              autoFocus
              maxLength={120}
            />
            {squadSurface.friendlyError && (
              <p className="text-sm text-danger-600 dark:text-danger-400">
                {squadSurface.friendlyError}
              </p>
            )}
            <p className="text-xs text-app-fg-muted">
              You can rename or delete the team later from the Teams tab.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-app-border shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCreateTeamOpen(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isBusy || !createTeamName.trim()}
              loading={isBusy}
              loadingText="Creating…"
              onClick={() => {
                const trimmed = createTeamName.trim();
                if (!trimmed) return;
                // Cache-invalidating wrapper — see Enter-key handler above
                // for why a bare squadFetcher.submit() leaks stale data into
                // the post-action revalidation.
                submitSquadMutation({
                  intent: 'createBranchTeam',
                  department: selectedDept.department.department,
                  name: trimmed,
                });
              }}
            >
              Create team
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function BranchOverviewPage({
  overview,
  allUsers,
  teams,
  orgStructure,
  teamSettingsByTeamId,
  statusCounts,
  dateFilters,
}: {
  overview: BranchOverview;
  allUsers: UserOption[];
  teams: BranchTeamWithMembers[];
  orgStructure: BranchOrgStructurePayload;
  teamSettingsByTeamId: Record<string, TeamSettingsBundle | null>;
  statusCounts: Record<string, number>;
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const { branch } = overview;
  const canManageBranchPage = overview.viewer?.canManageBranchPage ?? false;

  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const branchDetailSurface = useFetcherActionSurface(fetcher);
  const [editOpen, setEditOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);
  const [addMemberUserId, setAddMemberUserId] = useState('');

  useFetcherToast(fetcher.data, {
    successMessage: 'Saved',
    skipErrorToast: editOpen || addMemberOpen,
  });

  // Drop the cachedClientLoader entry the moment a submit starts so Remix's
  // auto-revalidation (which fires after the action completes) falls through
  // to the server on its FIRST round-trip. Doing this on success was too late
  // — the auto-revalidate had already returned the pre-mutation snapshot.
  useEffect(() => {
    if (fetcher.state === 'submitting' && typeof window !== 'undefined') {
      invalidateCachedLoader(window.location.pathname);
    }
  }, [fetcher.state]);

  const handleBranchDetailSuccess = useCallback(() => {
    setEditOpen(false);
    setAddMemberOpen(false);
    setIsPrimary(false);
    setAddMemberUserId('');
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleBranchDetailSuccess);

  const isSubmitting = fetcher.state !== 'idle';

  const existingMemberIds = new Set(overview.members.map((m) => m.userId));
  // Per CEO directive 2026-05-10: only branch-eligible roles (Marketing, CS,
  // Branch Admin) can be assigned to a branch. Org-wide roles are filtered
  // out at the picker so the bad assignment can't be made in the first place.
  const availableUsers = allUsers.filter(
    (u) => !existingMemberIds.has(u.id) && BRANCH_ELIGIBLE_ROLES.has(u.role),
  );

  return (
    <div className="space-y-6">
      {/* ── Header — card-styled hero matching `/admin/branches` list cards
          (CEO directive 2026-05-10). Visual continuity between list and
          detail surfaces; the card surface also tones down the dense
          BranchSupervisorTeamsPanel content that follows. ── */}
      <div className="bg-app-elevated rounded-xl border border-app-border shadow-sm p-5">
        <Link
          to="/admin/branches"
          prefetch="intent"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All branches
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Branch avatar — same treatment as the list-card chip but
                bumped to 12 to read as a hero element. */}
            <div className="w-12 h-12 rounded-xl bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
              <span className="text-base font-bold text-brand-700 dark:text-brand-300">
                {branch.code.slice(0, 2)}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-app-fg leading-tight truncate">
                {branch.name}
              </h1>
              <div className="text-sm text-app-fg-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center rounded-md border border-app-border bg-app-hover px-1.5 py-0.5 font-mono text-mini font-semibold text-app-fg-muted">
                  {branch.code}
                </span>
                <span aria-hidden>·</span>
                <span>
                  Since{' '}
                  <time dateTime={branch.createdAt}>
                    {new Date(branch.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </time>
                </span>
              </div>
            </div>
          </div>

          <PageHeaderMobileTools
            sheetTitle="Branch tools"
            sheetSubtitle={<span>Status and actions</span>}
            triggerAriaLabel="Branch toolbar"
            showMobileRefresh={false}
            mobileLeading={<StatusBadge status={branch.status} />}
            desktop={
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={branch.status} />
                {canManageBranchPage ? (
                  <Button variant="primary" size="sm" onClick={() => setEditOpen(true)}>
                    Edit
                  </Button>
                ) : null}
              </div>
            }
            sheet={({ closeSheet }) => (
              <>
                {canManageBranchPage && (
                  <Button variant="primary" size="sm" className="h-12 w-full justify-center" onClick={() => { closeSheet(); setEditOpen(true); }}>
                    Edit branch
                  </Button>
                )}
                {canManageBranchPage && (
                  <Button variant="secondary" size="sm" className="h-12 w-full justify-center" onClick={() => { closeSheet(); setAddMemberOpen(true); }}>
                    Add member
                  </Button>
                )}
              </>
            )}
          />
        </div>
      </div>


      <BranchSupervisorTeamsPanel
        orgStructure={orgStructure}
        branchMembers={overview.members}
        canManageCSTeams={overview.viewer?.canManageCSTeams ?? canManageBranchPage}
        canManageMarketingTeams={overview.viewer?.canManageMarketingTeams ?? canManageBranchPage}
        canManageBranchPage={canManageBranchPage}
        teamSettingsByTeamId={teamSettingsByTeamId}
        statusCounts={statusCounts}
        dateFilters={dateFilters}
      />

      {/* ── Edit branch modal ── */}
      {canManageBranchPage && editOpen && (
        <Modal
          open
          onClose={() => setEditOpen(false)}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="branch-edit-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="branch-edit-title" className="text-lg font-semibold text-app-fg">
                Edit branch
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5">
                <span className="font-mono text-xs">{branch.code}</span> · {branch.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={isSubmitting}
              className="text-app-fg-muted hover:text-app-fg shrink-0"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <fetcher.Form
            method="post"
            className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <input type="hidden" name="intent" value="update" />
            <TextInput
              label="Name"
              id="edit-branch-name"
              name="name"
              type="text"
              required
              defaultValue={branch.name}
            />
            <FormSelect
              label="Status"
              id="edit-branch-status"
              name="status"
              defaultValue={branch.status}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
            <ModalFetcherInlineError message={branchDetailSurface.errorMatchingIntent('update')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setEditOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSubmitting}
                loading={isSubmitting}
                loadingText="Saving..."
              >
                Save
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* ── Add member modal ── */}
      {canManageBranchPage && addMemberOpen && (
        <Modal
          open
          onClose={() => setAddMemberOpen(false)}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="add-member-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="add-member-title" className="text-lg font-semibold text-app-fg">
                Add member
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5">
                Assign staff to <span className="font-medium">{branch.name}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddMemberOpen(false)}
              disabled={isSubmitting}
              className="text-app-fg-muted hover:text-app-fg shrink-0"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <fetcher.Form
            method="post"
            className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <input type="hidden" name="intent" value="assignUser" />
            <input type="hidden" name="isPrimary" value={String(isPrimary)} />
            <div>
              <label
                className="block text-xs font-medium text-app-fg-muted mb-1"
                htmlFor="add-member-user"
              >
                Staff member
              </label>
              {availableUsers.length === 0 ? (
                <p className="text-sm text-app-fg-muted">
                  No eligible staff to add. Branches only accept Marketing, CS, and Branch Admin
                  roles — others are org-wide and don't belong to a branch.
                </p>
              ) : (
                <>
                  <input type="hidden" name="userId" value={addMemberUserId} />
                  <SearchableSelect
                    id="add-member-user"
                    value={addMemberUserId}
                    onChange={setAddMemberUserId}
                    required
                    placeholder="Select a staff member…"
                    searchPlaceholder="Search staff..."
                    options={availableUsers.map((u) => ({
                      value: u.id,
                      label: `${u.name} — ${formatRoleLabel(u.role)}`,
                    }))}
                  />
                </>
              )}
            </div>
            <FormSelect
              label="Role override"
              id="add-member-role"
              name="roleInBranch"
              placeholder="Use global role"
              options={ROLE_OPTIONS}
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="add-member-primary"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
              />
              <label
                htmlFor="add-member-primary"
                className="text-sm text-app-fg-muted cursor-pointer"
              >
                Set as primary branch for this user
              </label>
            </div>
            <ModalFetcherInlineError
              message={branchDetailSurface.errorMatchingIntent('assignUser')}
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAddMemberOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSubmitting || availableUsers.length === 0}
                loading={isSubmitting}
                loadingText="Adding..."
              >
                Add member
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}
    </div>
  );
}

export default function BranchDetailRoute() {
  const { pageData, loadingVisibility } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<BranchDetailLoadingShell {...loadingVisibility} />}
      loaderShell={{}}
      deferredKey="pageData"
    >
      {(data) => (
        <BranchOverviewPage
          overview={data.overview}
          allUsers={data.allUsers}
          teams={data.teams}
          orgStructure={data.orgStructure}
          teamSettingsByTeamId={data.teamSettingsByTeamId}
          statusCounts={data.statusCounts}
          dateFilters={data.dateFilters}
        />
      )}
    </CachedAwait>
  );
}
