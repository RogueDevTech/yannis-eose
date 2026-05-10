import { defer, redirect } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

import { Link, useLoaderData, useFetcher, useRevalidator, Await } from '@remix-run/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { apiRequest, getCurrentUser, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { SearchInput } from '~/components/ui/search-input';
import { FilterPills, type FilterPillOption } from '~/components/ui/filter-pills';
import { RoleBadge } from '~/components/ui/role-badge';
import { Checkbox } from '~/components/ui/checkbox';
import { Pagination } from '~/components/ui/pagination';
import { CompactTable, type CompactTableColumn, CompactTableActionButton } from '~/components/ui/compact-table';
import { BranchDetailLoadingShell } from '~/features/branches/BranchesDeferredLoadingShells';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Collapsible } from '~/components/ui/collapsible';
import { Tabs } from '~/components/ui/tabs';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader, invalidateCachedLoader } from '~/lib/loader-cache';

// ── Remove confirmation modal ─────────────────────────────────────────────────

function RemoveModal({
  member,
  onClose,
}: {
  member: OverviewMember;
  onClose: () => void;
}) {
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
            <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h3 id="remove-member-title" className="text-base font-semibold text-app-fg">
              Remove from branch?
            </h3>
            <p className="text-sm text-app-fg-muted mt-1">
              <span className="font-medium text-app-fg-muted">{member.name}</span> will lose access to this branch. Their global account will not be affected.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-5 mb-3">
        <ModalFetcherInlineError message={removeSurface.errorMatchingIntent('removeUser')} />
      </div>

      <div className="border-t border-app-border px-5 py-3 flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
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
  { value: 'CS_CLOSER', label: 'CS Closer' },
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

  const pageData = (async () => {
    const [overviewRes, usersRes, orgRes] = await Promise.all([
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
      ? (orgRes.data?.result?.data as BranchOrgStructurePayload | undefined) ?? { departments: [] }
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
        return [team.id, res.ok ? res.data?.result?.data ?? null : null] as const;
      }),
    );
    const teamSettingsByTeamId: Record<string, TeamSettingsBundle | null> = Object.fromEntries(
      teamSettingsEntries,
    );

    return { overview, allUsers, teams, orgStructure, teamSettingsByTeamId };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

// ── Action ───────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermission(request, 'branches.manage');
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
    if (!teamId || !userId) return Response.json({ error: 'Team and user are required' }, { status: 400 });
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
    if (!teamId || !userId) return Response.json({ error: 'Team and user are required' }, { status: 400 });
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
    if (!teamId || !userId) return Response.json({ error: 'Team and user are required' }, { status: 400 });
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
    if (!teamId || !key) return Response.json({ error: 'Team and key are required' }, { status: 400 });
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
    if (!teamId || !key) return Response.json({ error: 'Team and key are required' }, { status: 400 });
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
  members,
  canManage,
  teamByUserId = {},
  supervisorUserIds,
  teamsForBulk = [],
  onBulkAddToTeam,
}: {
  members: OverviewMember[];
  canManage: boolean;
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
  onBulkAddToTeam?: (
    teamId: string,
    userIds: string[],
    teamLabel: string,
  ) => void;
}) {
  // The panel is rendered inside a department's detail view (already filtered
  // to that dept's members), so the dept-filter pills the panel used to show
  // were always showing a single locked option. Removed (CEO 2026-05-10).
  const [search, setSearch] = useState('');
  const [removeTarget, setRemoveTarget] = useState<OverviewMember | null>(null);
  const [page, setPage] = useState(1);
  const [selectedUserIds, setSelectedUserIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkTeamId, setBulkTeamId] = useState('');
  const bulkEnabled = canManage && !!onBulkAddToTeam && teamsForBulk.length > 0;

  // Filter state. Binary team filter (CEO 2026-05-10): the per-team pills
  // were noisy (one pill per team, most empty), so we collapsed to the only
  // distinction that matters at the Members level — is this member on a team
  // or not. Pick a specific team from the Teams tab.
  const [teamFilter, setTeamFilter] = useState<'ALL' | 'ASSIGNED' | 'UNASSIGNED'>('ALL');

  const teamPillOptions = useMemo((): FilterPillOption[] => {
    let assigned = 0;
    let unassigned = 0;
    for (const m of members) {
      if (teamByUserId[m.userId]) assigned += 1;
      else unassigned += 1;
    }
    return [
      { value: 'ALL', label: 'All', count: members.length },
      { value: 'ASSIGNED', label: 'Assigned to team', count: assigned },
      { value: 'UNASSIGNED', label: 'Unassigned', count: unassigned },
    ];
  }, [members, teamByUserId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false;
      const onTeam = !!teamByUserId[m.userId];
      if (teamFilter === 'ASSIGNED' && !onTeam) return false;
      if (teamFilter === 'UNASSIGNED' && onTeam) return false;
      return true;
    });
  }, [members, search, teamFilter, teamByUserId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / MEMBERS_PAGE_SIZE));

  // Snap back to page 1 whenever any filter changes so the user isn't stranded
  // on a page that no longer has rows.
  useEffect(() => {
    setPage(1);
  }, [search, teamFilter]);

  // Defensive: if `members` shrinks (e.g. someone is removed) and the current
  // page is now empty, step back rather than rendering nothing.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart = (page - 1) * MEMBERS_PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + MEMBERS_PAGE_SIZE);

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
    onBulkAddToTeam(
      bulkTeamId,
      Array.from(selectedUserIds),
      team?.label ?? 'this team',
    );
  };

  return (
    <div className="space-y-3">
      {/* Filters: team chips + name search. Role pills dropped — within a
          dept, every member is the same role family (Media Buyer / CS Closer
          / Head). Heads + supervisors are surfaced as inline tags on cards. */}
      <div className="space-y-2">
        {teamPillOptions.length > 1 && (
          <div className="min-w-0 overflow-x-auto pb-0.5 -mb-0.5">
            <FilterPills
              options={teamPillOptions}
              value={teamFilter}
              onChange={(v) => setTeamFilter(v as 'ALL' | 'ASSIGNED' | 'UNASSIGNED')}
              size="sm"
            />
          </div>
        )}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
          <div className="w-full min-w-0 lg:max-w-xs shrink-0">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search by name…"
              aria-label="Filter members by name"
              controlSize="sm"
              debounceMs={200}
            />
          </div>
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
            <FormSelect
              id="bulk-team-picker"
              value={bulkTeamId}
              onChange={(e) => setBulkTeamId(e.target.value)}
              placeholder="Pick a team…"
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
          {bulkEnabled && (() => {
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

          {/* CompactTable mirrors the Team-card member table shape (Member /
              Role / Supervisor / actions) but adds a Team column scoped to the
              department, plus row-selection for bulk add. */}
          <div className="card p-0">
            <div className="overflow-x-auto">
              <CompactTable
                withCard={false}
                className="min-w-[680px]"
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
                          <span className="font-medium text-app-fg truncate">{m.name}</span>
                          {isHead && <RoleBadge role={m.effectiveRole} size="sm" />}
                          {isSupervisor && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400">
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
                        {canManage ? (
                          <CompactTableActionButton tone="danger" onClick={() => setRemoveTarget(m)}>
                            Remove
                          </CompactTableActionButton>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </div>

          {totalPages > 1 && (
            <div className="card p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-app-fg-muted">
                Showing {pageStart + 1}–{Math.min(pageStart + MEMBERS_PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}

      {canManage && removeTarget && (
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
  | { kind: 'addMember'; formData: FormData; teamTitle: string; memberLabel: string; asSupervisor: boolean }
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
  | { kind: 'removeRosterMember'; branchDepartmentId: string; userId: string; memberName: string; deptLabel: string }
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
      render: (m) => <span className="font-medium text-app-fg">{m.name}</span>,
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

function sourceBadge(setting: EffectiveTeamSetting): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  if (setting.source === 'enforced-system') return { label: 'System (locked)', tone: 'danger' };
  if (setting.source === 'team') return { label: 'Team override', tone: 'success' };
  if (setting.source === 'system') return { label: 'Inherited from system', tone: 'neutral' };
  return { label: 'Unset', tone: 'warning' };
}

interface SettingEditorState {
  setting: EffectiveTeamSetting;
  catalog: { key: string; label: string; description: string };
}

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

  const [editor, setEditor] = useState<SettingEditorState | null>(null);
  const [confirmClear, setConfirmClear] = useState<EffectiveTeamSetting | null>(null);
  const isBusy = fetcher.state !== 'idle';

  // Close editor on success.
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setEditor(null);
      setConfirmClear(null);
    }
  }, [fetcher.state, fetcher.data]);

  const catalogByKey = useMemo(() => {
    const m = new Map<string, { key: string; label: string; description: string }>();
    for (const c of bundle.catalog) m.set(c.key, c);
    return m;
  }, [bundle.catalog]);

  return (
    <div className="border-t border-app-border pt-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-app-fg">Team configuration</p>
        <p className="text-xs text-app-fg-muted mt-0.5">
          Inherited from system defaults unless overridden here. An admin can <strong>lock</strong> a setting at the system level — locked settings ignore team overrides.
        </p>
      </div>
      <div className="space-y-2">
        {bundle.settings.map((setting) => {
          const cat = catalogByKey.get(setting.key);
          if (!cat) return null;
          const badge = sourceBadge(setting);
          return (
            <div
              key={setting.key}
              className="rounded-lg border border-app-border bg-app-elevated/30 p-3 flex flex-wrap items-start gap-3 justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-app-fg">{cat.label}</p>
                  <StatusBadge status={badge.label} />
                </div>
                <p className="text-xs text-app-fg-muted mt-0.5">{cat.description}</p>
                <p className="text-sm text-app-fg mt-1">
                  Effective:{' '}
                  <span className="font-semibold">{describeSettingValue(setting.key, setting.value)}</span>
                  {setting.source === 'team' && setting.systemValue !== null && (
                    <span className="text-app-fg-muted">
                      {' '}· system default: {describeSettingValue(setting.key, setting.systemValue)}
                    </span>
                  )}
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isBusy || setting.systemEnforced}
                    onClick={() => setEditor({ setting, catalog: cat })}
                  >
                    {setting.source === 'team' ? 'Edit override' : 'Override'}
                  </Button>
                  {setting.source === 'team' && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => setConfirmClear(setting)}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editor && (
        <SettingEditorModal
          team={team}
          teamTitle={teamTitle}
          editor={editor}
          fetcher={fetcher}
          isBusy={isBusy}
          error={surface.friendlyError ?? null}
          onClose={() => {
            if (isBusy) return;
            setEditor(null);
          }}
        />
      )}

      {confirmClear && (
        <ConfirmActionModal
          open
          title="Reset to system default?"
          description={
            <>
              Remove the team override on <strong>{catalogByKey.get(confirmClear.key)?.label ?? confirmClear.key}</strong>?{' '}
              <strong>{teamTitle}</strong> will fall back to the system value (
              <strong>{describeSettingValue(confirmClear.key, confirmClear.systemValue)}</strong>).
            </>
          }
          confirmLabel="Reset"
          variant="danger"
          loading={isBusy}
          error={surface.friendlyError ?? null}
          onClose={() => {
            if (isBusy) return;
            setConfirmClear(null);
          }}
          onConfirm={() => {
            fetcher.submit(
              { intent: 'clearTeamSetting', teamId: team.id, key: confirmClear.key },
              { method: 'post' },
            );
          }}
        />
      )}
    </div>
  );
}

function SettingEditorModal({
  team,
  teamTitle,
  editor,
  fetcher,
  isBusy,
  error,
  onClose,
}: {
  team: BranchTeamWithMembers;
  teamTitle: string;
  editor: SettingEditorState;
  fetcher: ReturnType<typeof useFetcher<{ success?: boolean; error?: string }>>;
  isBusy: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const initialValue = editor.setting.teamValue ?? editor.setting.systemValue ?? null;
  const [strategy, setStrategy] = useState<'manual' | 'load_balanced' | 'performance' | 'claim'>(
    editor.setting.key === 'CS_DISPATCH_STRATEGY'
      ? ((initialValue?.strategy as 'manual' | 'load_balanced' | 'performance' | 'claim' | undefined) ?? 'manual')
      : 'manual',
  );
  const [claimCap, setClaimCap] = useState<string>(
    editor.setting.key === 'CS_CLAIM_CAP'
      ? String((initialValue?.cap as number | undefined) ?? 2)
      : '',
  );

  const handleSave = () => {
    let value: Record<string, unknown> | null = null;
    if (editor.setting.key === 'CS_DISPATCH_STRATEGY') {
      value = { strategy };
    } else if (editor.setting.key === 'CS_CLAIM_CAP') {
      const n = Number(claimCap);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        return;
      }
      value = { cap: Math.floor(n) };
    }
    if (!value) return;
    fetcher.submit(
      {
        intent: 'setTeamSetting',
        teamId: team.id,
        key: editor.setting.key,
        value: JSON.stringify(value),
      },
      { method: 'post' },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-lg"
      role="dialog"
      aria-labelledby="team-setting-edit-title"
      contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
    >
      <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
        <div>
          <h3 id="team-setting-edit-title" className="text-lg font-semibold text-app-fg">
            {editor.catalog.label}
          </h3>
          <p className="text-sm text-app-fg-muted mt-0.5">{teamTitle}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={isBusy}
          className="text-app-fg-muted hover:text-app-fg shrink-0"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5">
        <p className="text-sm text-app-fg-muted">{editor.catalog.description}</p>

        {editor.setting.key === 'CS_DISPATCH_STRATEGY' && (
          <div className="space-y-2">
            {DISPATCH_STRATEGIES.map((opt) => (
              <label
                key={opt.value}
                className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${
                  strategy === opt.value
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20'
                    : 'border-app-border hover:bg-app-hover'
                }`}
              >
                <input
                  type="radio"
                  name="strategy"
                  value={opt.value}
                  checked={strategy === opt.value}
                  onChange={() => setStrategy(opt.value)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium text-app-fg">{opt.label}</p>
                  <p className="text-xs text-app-fg-muted mt-0.5">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        {editor.setting.key === 'CS_CLAIM_CAP' && (
          <TextInput
            label="Maximum unconfirmed orders per agent"
            id="claim-cap"
            type="number"
            min={1}
            max={50}
            value={claimCap}
            onChange={(e) => setClaimCap(e.target.value)}
            hint="Applies only when the team's strategy is set to claim mode."
          />
        )}

        {editor.setting.systemValue !== null && (
          <div className="rounded-lg border border-app-border bg-app-elevated/40 p-3">
            <p className="text-xs text-app-fg-muted">
              System default: <strong>{describeSettingValue(editor.setting.key, editor.setting.systemValue)}</strong>
            </p>
          </div>
        )}

        <ModalFetcherInlineError message={error} />
      </div>
      <div className="border-t border-app-border px-5 py-3 flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={isBusy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={isBusy}
          loading={isBusy}
          loadingText="Saving…"
        >
          Save override
        </Button>
      </div>
    </Modal>
  );
}

function BranchSupervisorTeamsPanel({
  orgStructure,
  branchMembers,
  canManageCSTeams,
  canManageMarketingTeams,
  canManageBranchPage,
  teamSettingsByTeamId,
}: {
  orgStructure: BranchOrgStructurePayload;
  branchMembers: OverviewMember[];
  canManageCSTeams: boolean;
  canManageMarketingTeams: boolean;
  canManageBranchPage: boolean;
  teamSettingsByTeamId: Record<string, TeamSettingsBundle | null>;
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
  const flatTeams = orgStructure.departments.flatMap((d) => d.teams);
  const canManageAny = canManageCSTeams || canManageMarketingTeams;
  const canManageForDept = (dept: 'CS' | 'MARKETING'): boolean =>
    dept === 'CS' ? canManageCSTeams : canManageMarketingTeams;
  const squadFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const squadSurface = useFetcherActionSurface(squadFetcher);
  const revalidate = useRevalidator();
  const [confirmIntent, setConfirmIntent] = useState<SquadConfirmIntent | null>(null);
  const [openTeamId, setOpenTeamId] = useState<string | null>(flatTeams[0]?.id ?? null);

  useFetcherToast(squadFetcher.data, {
    successMessage: 'Teams updated',
    skipErrorToast: !!squadSurface.friendlyError,
  });

  const isBusy = squadFetcher.state !== 'idle';

  useEffect(() => {
    if (squadFetcher.state === 'idle' && squadFetcher.data?.success) {
      // The route uses cachedClientLoader which serves stale data on the
      // post-mutation revalidate unless we drop its entry first. Without
      // this, adding a member to a team only shows up after a hard reload.
      if (typeof window !== 'undefined') {
        invalidateCachedLoader(window.location.pathname);
      }
      revalidate.revalidate();
      setConfirmIntent(null);
    }
  }, [squadFetcher.state, squadFetcher.data, revalidate]);

  // Auto-close the create-team modal once the create finishes successfully.
  useEffect(() => {
    if (createTeamOpen && squadFetcher.state === 'idle' && squadFetcher.data?.success) {
      setCreateTeamOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to fetcher transitions
  }, [squadFetcher.state, squadFetcher.data]);

  const rosterAddOptions = (deptBlock: BranchOrgDepartmentBlock) => {
    const lane = deptBlock.department.department;
    const inSquads = new Set(deptBlock.teams.flatMap((t) => t.members.map((m) => m.userId)));
    const onRoster = new Set(deptBlock.roster.map((r) => r.userId));
    return branchMembers
      .filter(
        (m) =>
          m.department === lane && !inSquads.has(m.userId) && !onRoster.has(m.userId),
      )
      .map((m) => ({
        value: m.userId,
        label: `${m.name} · ${m.effectiveRole.replace(/_/g, ' ')}`,
      }));
  };

  const addOptions = (
    dept: 'CS' | 'MARKETING',
    team: BranchTeamWithMembers,
    rosterUserIds: Set<string>,
  ) => {
    const onTeam = new Set(team.members.map((m) => m.userId));
    return branchMembers
      .filter(
        (m) =>
          m.department === dept &&
          !onTeam.has(m.userId) &&
          !rosterUserIds.has(m.userId),
      )
      .map((m) => ({
        value: m.userId,
        label: `${m.name} · ${m.effectiveRole.replace(/_/g, ' ')}`,
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
        squadFetcher.submit(payload, { method: 'post' });
        break;
      }
      case 'deleteTeam':
        squadFetcher.submit(
          { intent: 'deleteBranchTeam', teamId: confirmIntent.teamId },
          { method: 'post' },
        );
        break;
      case 'toggleSupervisor':
        squadFetcher.submit(
          {
            intent: 'setBranchTeamMemberSupervisor',
            teamId: confirmIntent.teamId,
            userId: confirmIntent.userId,
            isSupervisor: confirmIntent.nextValue ? 'true' : 'false',
          },
          { method: 'post' },
        );
        break;
      case 'removeMember':
        squadFetcher.submit(
          {
            intent: 'removeBranchTeamMember',
            teamId: confirmIntent.teamId,
            userId: confirmIntent.userId,
          },
          { method: 'post' },
        );
        break;
      case 'addRosterMember': {
        const payload: Record<string, string> = {};
        for (const [k, v] of confirmIntent.formData.entries()) {
          payload[k] = typeof v === 'string' ? v : '';
        }
        squadFetcher.submit(payload, { method: 'post' });
        break;
      }
      case 'removeRosterMember':
        squadFetcher.submit(
          {
            intent: 'removeBranchDepartmentMember',
            branchDepartmentId: confirmIntent.branchDepartmentId,
            userId: confirmIntent.userId,
          },
          { method: 'post' },
        );
        break;
      case 'bulkAddMembers': {
        const payload: Record<string, string> = {};
        for (const [k, v] of confirmIntent.formData.entries()) {
          payload[k] = typeof v === 'string' ? v : '';
        }
        squadFetcher.submit(payload, { method: 'post' });
        break;
      }
    }
  }, [confirmIntent, squadFetcher]);

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
              assign CS orders, and send marketing funding within their team.
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
              <strong>{confirmIntent.deptLabel}</strong> roster without assigning a team? They report
              to the department head until you move them into a team.
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
              <strong>{confirmIntent.teamLabel}</strong>?
              {' '}Anyone already on a different team in this department will be moved.
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

  // Resolve the selected dept block (or null = master view). Stale ids
  // (deleted/migrated) gracefully fall back to master view.
  const selectedDept = selectedDeptId
    ? orgStructure.departments.find((d) => d.department.id === selectedDeptId) ?? null
    : null;

  // Members outside the formal dept structure (Logistics / Finance / HR /
  // Other roles). Per CEO directive 2026-05-10 these should not be in branches
  // at all — surface a warning card on the master view until the cleanup
  // migration runs.
  const nonDeptMembers = branchMembers.filter(
    (m) => m.department !== 'CS' && m.department !== 'MARKETING',
  );

  return (
    <div className="space-y-6">
      {selectedDept === null ? (
        // ── Master view: department cards. Help text + Add member CTA live
        // inside each department's "Manage" detail view, not at the master level.
        <>
          {orgStructure.departments.length === 0 ? (
            <EmptyState
              title="No departments loaded"
              description="Reload the page after migrations complete, or contact support."
            />
          ) : (
            // Department cards — same shape as `/admin/branches` list cards
            // and `/admin/marketing/forms` (CEO directive 2026-05-10):
            // `bg-app-elevated rounded-xl border` shell, brand-coloured hover,
            // whole-card-clickable via an overlay button.
            <div className="grid gap-4 sm:grid-cols-2">
              {orgStructure.departments.map((deptBlock) => {
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

                    <div className="relative z-10 flex items-start justify-between gap-3 mb-3 pointer-events-none">
                      <h3 className="font-semibold text-app-fg text-base leading-snug min-w-0 flex-1 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                        {deptTitle}
                      </h3>
                      <span
                        className={`shrink-0 inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          lane === 'CS'
                            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                            : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
                        }`}
                      >
                        {lane}
                      </span>
                    </div>

                    <div className="relative z-10 grid grid-cols-3 gap-2 text-center mb-4 flex-1 pointer-events-none">
                      <div>
                        <p className="text-2xl font-semibold text-app-fg tabular-nums">{memberCount}</p>
                        <p className="text-[10px] text-app-fg-muted uppercase tracking-wide mt-0.5">Members</p>
                      </div>
                      <div>
                        <p className="text-2xl font-semibold text-app-fg tabular-nums">{deptBlock.teams.length}</p>
                        <p className="text-[10px] text-app-fg-muted uppercase tracking-wide mt-0.5">
                          Team{deptBlock.teams.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div>
                        <p className="text-2xl font-semibold text-app-fg tabular-nums">{supervisorCount}</p>
                        <p className="text-[10px] text-app-fg-muted uppercase tracking-wide mt-0.5">
                          Supervisor{supervisorCount === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>

                    <div className="relative z-10 flex items-center justify-end pt-3 border-t border-app-border pointer-events-none">
                      <span className="text-xs font-medium text-app-fg-muted group-hover:text-brand-600 dark:group-hover:text-brand-400 inline-flex items-center gap-1 transition-colors">
                        Manage {deptTitle.toLowerCase()}
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {nonDeptMembers.length > 0 && (
            <div className="rounded-lg border border-warning-300 dark:border-warning-700/50 bg-warning-50/50 dark:bg-warning-900/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-warning-900 dark:text-warning-200">
                  Non-branch members on this branch
                </h3>
                <span className="text-xs font-medium text-warning-800 dark:text-warning-300">
                  {nonDeptMembers.length} member{nonDeptMembers.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="text-xs text-warning-800 dark:text-warning-300">
                These users have non-CS/Marketing roles (Logistics, Finance, HR, Admin, etc.). Per CEO directive 2026-05-10 they shouldn't be assigned to a branch.
                Branch assignment will be removed by the next cleanup migration.
              </p>
            </div>
          )}
        </>
      ) : (
        // ── Detail view: one dept's members + roster + squads ──
        <>
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

          {/* Inner tabs — Overview / Members / Teams. The "+ Create team"
              button lives beside the tabs (CEO 2026-05-10) so it's always
              reachable regardless of which tab is active. Counts in labels. */}
          {(() => {
            const deptMemberCount = branchMembers.filter(
              (m) => m.department === selectedDept.department.department,
            ).length;
            const canCreateTeam = canManageForDept(selectedDept.department.department);
            return (
              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-app-border">
                <div className="flex-1 min-w-0 -mb-px">
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
                {canCreateTeam && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => setCreateTeamOpen(true)}
                    className="mb-2"
                  >
                    + Create team
                  </Button>
                )}
              </div>
            );
          })()}

          {deptTab === 'overview' && (() => {
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
            const unassignedCount = deptMembers.filter((m) => !inTeamUserIds.has(m.userId)).length;
            const overviewStats: Array<{ label: string; value: number; tone: string }> = [
              { label: 'Members', value: deptMembers.length, tone: 'text-app-fg' },
              { label: 'Teams', value: selectedDept.teams.length, tone: 'text-brand-600 dark:text-brand-400' },
              { label: 'Supervisors', value: supervisorCount, tone: 'text-success-600 dark:text-success-400' },
            ];
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {overviewStats.map((s) => (
                    <div key={s.label} className="card p-3">
                      <p className="text-[10px] uppercase tracking-wide text-app-fg-muted">{s.label}</p>
                      <p className={`text-2xl font-bold tabular-nums mt-1 ${s.tone}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
                {unassignedCount > 0 && (
                  <div className="rounded-md border border-warning-300 dark:border-warning-700/50 bg-warning-50/50 dark:bg-warning-900/20 px-3 py-2 text-sm text-warning-800 dark:text-warning-300">
                    {unassignedCount} member{unassignedCount === 1 ? '' : 's'} not on a team yet — assign them under <strong>Members</strong> (select + bulk add) or <strong>Teams</strong>.
                  </div>
                )}
              </div>
            );
          })()}

          {deptTab === 'members' && (() => {
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
                members={branchMembers.filter((m) => m.department === selectedDept.department.department)}
                canManage={canManageBranchPage}
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
                      No teams in this department yet. Click <strong>+ Create team</strong> in the tab bar to add one.
                    </p>
                  ) : null}
                  {deptBlock.teams.map((team) => {
            const title = team.name?.trim() || `${DEPT_TEAM_LABEL[team.department]} team`;
            const pick = addOptions(team.department, team, rosterUserIds);
            const supervisorCount = team.members.filter((m) => m.isSupervisor).length;
            const isOpen = openTeamId === team.id;
            const canManageThisTeam = canManageForDept(team.department);
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
              <div key={team.id} className="card p-0 overflow-hidden">
                <Collapsible
                  open={isOpen}
                  onOpenChange={(next) => setOpenTeamId(next ? team.id : null)}
                  triggerClassName="px-4 py-3"
                  contentClassName="border-t border-app-border"
                  trigger={
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <div
                        className={`shrink-0 inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          team.department === 'CS'
                            ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                            : 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300'
                        }`}
                      >
                        {DEPT_TEAM_LABEL[team.department]}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-app-fg truncate">{title}</p>
                        <p className="text-xs text-app-fg-muted">
                          {team.members.length} member{team.members.length === 1 ? '' : 's'}
                          {supervisorCount > 0 ? ` · ${supervisorCount} supervisor${supervisorCount === 1 ? '' : 's'}` : ''}
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
                            disabled={isBusy}
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
                          disabled={isBusy}
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
                        columns={buildBranchTeamMemberColumns(team, title, canManageThisTeam, isBusy, setConfirmIntent)}
                        rows={team.members}
                        rowKey={(m) => m.userId}
                      />
                    </div>

                    {teamSettingsByTeamId[team.id] && (teamSettingsByTeamId[team.id] as TeamSettingsBundle).catalog.length > 0 && (
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
                          <p className="text-xs text-app-fg-muted">All eligible {DEPT_TEAM_LABEL[team.department].toLowerCase()} members are already on this team.</p>
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
                            <input type="hidden" name="intent" value="addBranchTeamMember" />
                            <input type="hidden" name="teamId" value={team.id} />
                            <div className="min-w-[12rem] flex-1">
                              <FormSelect
                                id={`add-${team.id}`}
                                name="userId"
                                required
                                placeholder="Pick a member…"
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
                              title={supervisorCount > 0 ? 'This team already has a supervisor' : undefined}
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
                              disabled={isBusy || pick.length === 0}
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
                New team in <span className="font-medium">{DEPT_TEAM_LABEL[selectedDept.department.department]}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateTeamOpen(false)}
              disabled={isBusy}
              className="text-app-fg-muted hover:text-app-fg shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                  squadFetcher.submit(
                    {
                      intent: 'createBranchTeam',
                      department: selectedDept.department.department,
                      name: createTeamName.trim(),
                    },
                    { method: 'post' },
                  );
                }
              }}
              placeholder="e.g. Team A"
              required
              autoFocus
              maxLength={120}
            />
            {squadSurface.friendlyError && (
              <p className="text-sm text-danger-600 dark:text-danger-400">{squadSurface.friendlyError}</p>
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
                squadFetcher.submit(
                  {
                    intent: 'createBranchTeam',
                    department: selectedDept.department.department,
                    name: trimmed,
                  },
                  { method: 'post' },
                );
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
}: {
  overview: BranchOverview;
  allUsers: UserOption[];
  teams: BranchTeamWithMembers[];
  orgStructure: BranchOrgStructurePayload;
  teamSettingsByTeamId: Record<string, TeamSettingsBundle | null>;
}) {
  const { branch } = overview;
  const canManageBranchPage = overview.viewer?.canManageBranchPage ?? false;

  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const branchDetailSurface = useFetcherActionSurface(fetcher);
  const [editOpen, setEditOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);

  useFetcherToast(fetcher.data, {
    successMessage: 'Saved',
    skipErrorToast: editOpen || addMemberOpen,
  });

  const handleBranchDetailSuccess = useCallback(() => {
    setEditOpen(false);
    setAddMemberOpen(false);
    setIsPrimary(false);
    // The route uses cachedClientLoader — without dropping the entry, the
    // post-mutation auto-revalidate serves stale data and the new branch
    // edit / member assignment doesn't show until a hard reload.
    if (typeof window !== 'undefined') {
      invalidateCachedLoader(window.location.pathname);
    }
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
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                <span className="inline-flex items-center rounded-md border border-app-border bg-app-hover px-1.5 py-0.5 font-mono text-[11px] font-semibold text-app-fg-muted">
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

          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={branch.status} />
            {canManageBranchPage ? (
              <Button variant="primary" size="sm" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* KPI strip + Tabs both removed (CEO directive 2026-05-10) — branch
          page is now header + departments only. The HoM gets the same numbers
          via the Marketing dashboard / Ad spend listing. */}
      <BranchSupervisorTeamsPanel
        orgStructure={orgStructure}
        branchMembers={overview.members}
        canManageCSTeams={overview.viewer?.canManageCSTeams ?? canManageBranchPage}
        canManageMarketingTeams={overview.viewer?.canManageMarketingTeams ?? canManageBranchPage}
        canManageBranchPage={canManageBranchPage}
        teamSettingsByTeamId={teamSettingsByTeamId}
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
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting} loadingText="Saving...">
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
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              <label className="block text-xs font-medium text-app-fg-muted mb-1" htmlFor="add-member-user">
                Staff member
              </label>
              {availableUsers.length === 0 ? (
                <p className="text-sm text-app-fg-muted">
                  No eligible staff to add. Branches only accept Marketing, CS, and Branch Admin roles —
                  others are org-wide and don't belong to a branch.
                </p>
              ) : (
                <FormSelect
                  id="add-member-user"
                  name="userId"
                  required
                  placeholder="Select a staff member…"
                  options={availableUsers.map((u) => ({
                    value: u.id,
                    label: `${u.name} — ${u.role.replace(/_/g, ' ')}`,
                  }))}
                />
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
              <input
                id="add-member-primary"
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="rounded border-app-border text-brand-600"
              />
              <label htmlFor="add-member-primary" className="text-sm text-app-fg-muted cursor-pointer">
                Set as primary branch for this user
              </label>
            </div>
            <ModalFetcherInlineError message={branchDetailSurface.errorMatchingIntent('assignUser')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" size="sm" onClick={() => setAddMemberOpen(false)} disabled={isSubmitting}>
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
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<BranchDetailLoadingShell />}
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
          />
        )}
      </CachedAwait>
  );
}
