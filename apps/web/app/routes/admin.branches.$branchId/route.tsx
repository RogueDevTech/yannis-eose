import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData, useFetcher, useRevalidator } from '@remix-run/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { Tabs } from '~/components/ui/tabs';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { FilterPills, type FilterPillOption } from '~/components/ui/filter-pills';
import { SearchInput } from '~/components/ui/search-input';
import { RoleBadge } from '~/components/ui/role-badge';
import { Checkbox } from '~/components/ui/checkbox';

// ── Remove confirmation modal ─────────────────────────────────────────────────

function RemoveModal({
  member,
  onClose,
}: {
  member: OverviewMember;
  onClose: () => void;
}) {
  const removeFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(removeFetcher.data, { successMessage: 'Member removed' });
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

      {removeFetcher.data?.error && (
        <div className="mx-5 mb-3 rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
          <p className="text-sm text-danger-700 dark:text-danger-400">{removeFetcher.data.error}</p>
        </div>
      )}

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

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const name = data?.overview?.branch?.name ?? 'Branch';
  return [{ title: `${name} — Branch — Yannis EOSE` }];
};

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

const ROLE_OPTIONS = [
  { value: 'CS_AGENT', label: 'CS Agent' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'LOGISTICS_MANAGER', label: 'Logistics Manager' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
];

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const branchId = params.branchId;
  if (!branchId) throw new Response('Missing branch', { status: 400 });

  const cookie = getSessionCookie(request);

  const [overviewRes, usersRes, teamsRes] = await Promise.all([
    apiRequest<{ result?: { data?: BranchOverview } }>(
      `/trpc/branches.overview?input=${encodeURIComponent(JSON.stringify({ branchId }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<{ result?: { data?: { users: UserOption[]; pagination: unknown } } }>(
      // Branch member picker: needs ALL active staff regardless of which branch the
      // admin is currently switched to. `allBranches: true` is honoured server-side
      // only for SUPER_ADMIN / ADMIN — the route is gated by `branches.manage` so
      // non-admins can't reach it anyway.
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc', status: 'ACTIVE', allBranches: true }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<{ result?: { data?: BranchTeamWithMembers[] } }>(
      `/trpc/branches.listTeamsWithMembers?input=${encodeURIComponent(JSON.stringify({ branchId }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  if (!overviewRes.ok) {
    const errMsg =
      extractApiErrorMessage(overviewRes.data, 'Unable to load branch');
    throw new Response(errMsg, {
      status: overviewRes.status >= 400 && overviewRes.status < 600 ? overviewRes.status : 500,
    });
  }

  const overview = overviewRes.data?.result?.data;
  if (!overview) throw new Response('Branch not found', { status: 404 });

  const allUsers: UserOption[] = (usersRes.data?.result?.data?.users ?? []).filter(
    (u) => u.role !== 'SUPER_ADMIN' && u.role !== 'ADMIN',
  );

  const teams: BranchTeamWithMembers[] = teamsRes.ok
    ? (teamsRes.data?.result?.data as BranchTeamWithMembers[] | undefined) ?? []
    : [];

  return { overview, allUsers, teams };
}

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

  return Response.json({ error: 'Unknown intent' }, { status: 400 });
}

function BranchMembersPanel({ members }: { members: OverviewMember[] }) {
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [removeTarget, setRemoveTarget] = useState<OverviewMember | null>(null);

  const pillOptions = useMemo((): FilterPillOption[] => {
    const byDept = new Map<string, number>();
    for (const m of members) {
      byDept.set(m.department, (byDept.get(m.department) ?? 0) + 1);
    }
    const order: MemberDepartment[] = ['CS', 'MARKETING', 'LOGISTICS', 'FINANCE', 'HR', 'OTHER'];
    const opts: FilterPillOption[] = [{ value: 'ALL', label: 'All', count: members.length }];
    for (const d of order) {
      const c = byDept.get(d) ?? 0;
      if (c > 0) opts.push({ value: d, label: DEPT_LABEL[d], count: c });
    }
    return opts;
  }, [members]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (deptFilter !== 'ALL' && m.department !== deptFilter) return false;
      if (q && !m.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [members, deptFilter, search]);

  if (members.length === 0) {
    return (
      <EmptyState
        title="No members yet"
        description="Add staff to this branch so they can work in this location."
        variant="card"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 overflow-x-auto pb-1 -mb-1">
          <FilterPills options={pillOptions} value={deptFilter} onChange={setDeptFilter} size="sm" />
        </div>
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

      {filtered.length === 0 ? (
        <EmptyState
          title="No matching members"
          description="Try another department filter or clear the search."
          variant="card"
        />
      ) : (
        <div className="card p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="table-header">Name</th>
                  <th className="table-header">Role</th>
                  <th className="table-header max-sm:hidden">Department</th>
                  <th className="table-header">Primary</th>
                  <th className="table-header text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.userId} className="table-row">
                    <td className="table-cell">
                      <span className="font-medium text-app-fg">{m.name}</span>
                    </td>
                    <td className="table-cell">
                      <RoleBadge role={m.effectiveRole} size="sm" />
                    </td>
                    <td className="table-cell max-sm:hidden">
                      <span className="text-sm text-app-fg-muted">{DEPT_LABEL[m.department]}</span>
                    </td>
                    <td className="table-cell">
                      {m.isPrimary ? (
                        <span className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 font-medium">
                          <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                          Yes
                        </span>
                      ) : (
                        <span className="text-app-fg-muted text-sm">—</span>
                      )}
                    </td>
                    <td className="table-cell text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-3 justify-end">
                        <Link
                          to={`/hr/users/${m.userId}`}
                          className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          Profile
                        </Link>
                        <button
                          type="button"
                          onClick={() => setRemoveTarget(m)}
                          className="text-xs font-medium text-danger-600 hover:text-danger-700 dark:text-danger-400"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {removeTarget && (
        <RemoveModal member={removeTarget} onClose={() => setRemoveTarget(null)} />
      )}
    </div>
  );
}

const DEPT_TEAM_LABEL: Record<'CS' | 'MARKETING', string> = {
  CS: 'Customer support',
  MARKETING: 'Marketing',
};

function BranchSupervisorTeamsPanel({
  teams,
  branchMembers,
}: {
  teams: BranchTeamWithMembers[];
  branchMembers: OverviewMember[];
}) {
  const squadFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidate = useRevalidator();
  useFetcherToast(squadFetcher.data, { successMessage: 'Teams updated' });

  useEffect(() => {
    if (squadFetcher.state === 'idle' && squadFetcher.data?.success) {
      revalidate.revalidate();
    }
  }, [squadFetcher.state, squadFetcher.data, revalidate]);

  const addOptions = (dept: 'CS' | 'MARKETING', team: BranchTeamWithMembers) => {
    const onTeam = new Set(team.members.map((m) => m.userId));
    return branchMembers
      .filter((m) => m.department === dept && !onTeam.has(m.userId))
      .map((m) => ({
        value: m.userId,
        label: `${m.name} · ${m.effectiveRole.replace(/_/g, ' ')}`,
      }));
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-app-border bg-app-elevated/40 p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-app-fg">Create supervisor team</p>
          <p className="text-xs text-app-fg-muted mt-0.5">
            Supervisors can mirror supervised staff, assign CS orders to in-team agents (unprocessed or CS-assigned), or send marketing funding to supervised media buyers — enforced server-side.
          </p>
        </div>
        <squadFetcher.Form method="post" className="flex flex-wrap gap-3 items-end">
          <input type="hidden" name="intent" value="createBranchTeam" />
          <div className="w-full sm:w-auto min-w-[10rem]">
            <FormSelect
              label="Department"
              id="sq-new-dept"
              name="department"
              defaultValue="CS"
              options={[
                { value: 'CS', label: DEPT_TEAM_LABEL.CS },
                { value: 'MARKETING', label: DEPT_TEAM_LABEL.MARKETING },
              ]}
            />
          </div>
          <div className="flex-1 min-w-[12rem]">
            <TextInput label="Team name (optional)" id="sq-new-name" name="name" placeholder="e.g. Squad A" />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={squadFetcher.state !== 'idle'}
            loading={squadFetcher.state !== 'idle'}
            loadingText="Creating…"
          >
            + Create team
          </Button>
        </squadFetcher.Form>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          title="No supervisor teams yet"
          description="Create a team, add branch members, and mark who is the supervisor."
        />
      ) : (
        <div className="space-y-4">
          {teams.map((team) => {
            const title = team.name?.trim() || `${DEPT_TEAM_LABEL[team.department]} team`;
            const pick = addOptions(team.department, team);
            return (
              <div key={team.id} className="card p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-app-fg">{title}</p>
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      {DEPT_TEAM_LABEL[team.department]} · {team.members.length} member
                      {team.members.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 items-end">
                    <squadFetcher.Form method="post" className="flex flex-wrap items-end gap-2">
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
                      <Button type="submit" variant="secondary" size="sm" disabled={squadFetcher.state !== 'idle'}>
                        Save name
                      </Button>
                    </squadFetcher.Form>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={squadFetcher.state !== 'idle'}
                      onClick={() => {
                        if (!confirm(`Delete team "${title}"?`)) return;
                        squadFetcher.submit({ intent: 'deleteBranchTeam', teamId: team.id }, { method: 'post' });
                      }}
                    >
                      Delete team
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr>
                        <th className="table-header">Member</th>
                        <th className="table-header">Role</th>
                        <th className="table-header">Supervisor</th>
                        <th className="table-header w-28 text-right" />
                      </tr>
                    </thead>
                    <tbody>
                      {team.members.map((m) => (
                        <tr key={m.userId} className="border-b border-app-border/80">
                          <td className="py-2 pr-4 font-medium text-app-fg">{m.name}</td>
                          <td className="py-2 pr-4">
                            <RoleBadge role={m.role} size="sm" />
                          </td>
                          <td className="py-2 pr-4">
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                key={`${team.id}-${m.userId}-${String(m.isSupervisor)}`}
                                defaultChecked={m.isSupervisor}
                                onChange={(e) => {
                                  squadFetcher.submit(
                                    {
                                      intent: 'setBranchTeamMemberSupervisor',
                                      teamId: team.id,
                                      userId: m.userId,
                                      isSupervisor: e.target.checked ? 'true' : 'false',
                                    },
                                    { method: 'post' },
                                  );
                                }}
                              />
                              <span className="text-app-fg-muted text-xs">Supervisor</span>
                            </label>
                          </td>
                          <td className="py-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-danger-600 dark:text-danger-400"
                              disabled={squadFetcher.state !== 'idle'}
                              onClick={() => {
                                if (!confirm(`Remove ${m.name} from this team?`)) return;
                                squadFetcher.submit(
                                  { intent: 'removeBranchTeamMember', teamId: team.id, userId: m.userId },
                                  { method: 'post' },
                                );
                              }}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <squadFetcher.Form method="post" className="flex flex-wrap gap-3 items-end border-t border-app-border pt-3">
                  <input type="hidden" name="intent" value="addBranchTeamMember" />
                  <input type="hidden" name="teamId" value={team.id} />
                  <div className="min-w-[12rem] flex-1">
                    {pick.length === 0 ? (
                      <p className="text-xs text-app-fg-muted">All eligible members are already on this team.</p>
                    ) : (
                      <FormSelect
                        label={`Add ${DEPT_TEAM_LABEL[team.department]} member`}
                        id={`add-${team.id}`}
                        name="userId"
                        required
                        placeholder="Choose member…"
                        options={pick}
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-app-fg-muted pb-2">
                    <Checkbox name="isSupervisor" value="true" />
                    Add as supervisor
                  </label>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={squadFetcher.state !== 'idle' || pick.length === 0}
                  >
                    Add to team
                  </Button>
                </squadFetcher.Form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type ActiveTab = 'overview' | 'team' | 'squads';

export default function BranchOverviewRoute() {
  const { overview, allUsers, teams } = useLoaderData<typeof loader>();
  const { branch, counts } = overview;

  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data, { successMessage: 'Saved' });

  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);

  const wasSubmittingRef = useRef(false);
  useEffect(() => {
    if (fetcher.state === 'submitting' || fetcher.state === 'loading') {
      wasSubmittingRef.current = true;
      return;
    }
    if (fetcher.state === 'idle' && wasSubmittingRef.current) {
      wasSubmittingRef.current = false;
      if (fetcher.data?.success) {
        setEditOpen(false);
        setAddMemberOpen(false);
        setIsPrimary(false);
      }
    }
  }, [fetcher.state, fetcher.data]);

  const isSubmitting = fetcher.state !== 'idle';

  const existingMemberIds = new Set(overview.members.map((m) => m.userId));
  const availableUsers = allUsers.filter((u) => !existingMemberIds.has(u.id));

  const deliveryRate =
    counts.totalOrders > 0
      ? Math.round((counts.deliveredOrders / counts.totalOrders) * 100)
      : null;

  const branchOverviewStatItems = useMemo(() => {
    const deliveryPct =
      counts.totalOrders > 0
        ? Math.round((counts.deliveredOrders / counts.totalOrders) * 100)
        : null;
    const rateClass =
      deliveryPct === null
        ? 'text-app-fg'
        : deliveryPct >= 70
          ? 'text-success-600 dark:text-success-400'
          : deliveryPct >= 40
            ? 'text-warning-600 dark:text-warning-400'
            : 'text-danger-600 dark:text-danger-400';

    const sub = (text: string) => (
      <span className="block text-[10px] font-medium normal-case tracking-normal text-app-fg-muted mt-0.5">{text}</span>
    );

    return [
      {
        label: 'Total orders',
        plainValue: true as const,
        value: (
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold text-app-fg tabular-nums">{counts.totalOrders}</span>
            {sub('All statuses')}
          </div>
        ),
      },
      {
        label: 'Active',
        plainValue: true as const,
        value: (
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold text-brand-600 dark:text-brand-400 tabular-nums">{counts.activeOrders}</span>
            {sub('In pipeline')}
          </div>
        ),
      },
      {
        label: 'Delivered',
        plainValue: true as const,
        value: (
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold text-success-600 dark:text-success-400 tabular-nums">{counts.deliveredOrders}</span>
            {sub('Completed')}
          </div>
        ),
      },
      {
        label: 'Delivery rate',
        plainValue: true as const,
        value: (
          <div className="flex flex-col items-center">
            <span className={`text-xl font-bold tabular-nums ${rateClass}`}>
              {deliveryPct !== null ? `${deliveryPct}%` : '—'}
            </span>
            {sub('Delivered / total')}
          </div>
        ),
      },
      {
        label: 'Campaigns',
        plainValue: true as const,
        value: (
          <div className="flex flex-col items-center">
            <span className="text-xl font-bold text-brand-600 dark:text-brand-400 tabular-nums">{counts.campaigns}</span>
            {sub('Marketing')}
          </div>
        ),
      },
    ];
  }, [counts]);

  const deptCounts = useMemo(() => {
    const out = { CS: 0, MARKETING: 0, LOGISTICS: 0, FINANCE: 0, HR: 0, OTHER: 0 };
    for (const m of overview.members) {
      out[m.department]++;
    }
    return out;
  }, [overview.members]);

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <Link
          to="/admin/branches"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All branches
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* Branch avatar */}
            <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary-700 dark:text-primary-300">
                {branch.code.slice(0, 2)}
              </span>
            </div>
            <PageHeader
              title={branch.name}
              description={`${branch.code} · Since ${new Date(branch.createdAt).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })}`}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={branch.status} />
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI strip (same OverviewStatStrip as CS queue, orders list, team pages) ── */}
      <OverviewStatStrip items={branchOverviewStatItems} />

      {/* Shared global Tabs component — matches the look used elsewhere in the app
          (HRPage, Settings, Order Detail). */}
      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as ActiveTab)}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'team', label: `Branch members (${counts.totalMembers})` },
          { value: 'squads', label: `Supervisor teams (${teams.length})` },
        ]}
      />

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">

          {/* Health summary */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

            {/* Order health */}
            <div className="card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                Order Health
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Active pipeline', value: counts.activeOrders },
                  { label: 'Delivered', value: counts.deliveredOrders },
                  { label: 'Total', value: counts.totalOrders },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-app-fg-muted">{label}</span>
                    <span className="font-semibold text-app-fg tabular-nums">{value}</span>
                  </div>
                ))}
                {deliveryRate !== null && (
                  <div className="pt-2 border-t border-app-border">
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-app-fg-muted">Delivery rate</span>
                      <span className={`font-semibold tabular-nums ${
                        deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' :
                        deliveryRate >= 40 ? 'text-warning-600 dark:text-warning-400' :
                        'text-danger-600 dark:text-danger-400'
                      }`}>{deliveryRate}%</span>
                    </div>
                    <div className="w-full bg-app-hover rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${
                          deliveryRate >= 70 ? 'bg-success-500' :
                          deliveryRate >= 40 ? 'bg-warning-500' : 'bg-danger-500'
                        }`}
                        style={{ width: `${deliveryRate}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Team composition */}
            <div className="card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                Team Composition
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Customer support', value: deptCounts.CS },
                  { label: 'Marketing', value: deptCounts.MARKETING },
                  { label: 'Logistics', value: deptCounts.LOGISTICS },
                  { label: 'Finance', value: deptCounts.FINANCE },
                  { label: 'HR', value: deptCounts.HR },
                  { label: 'Other roles', value: deptCounts.OTHER },
                  { label: 'Total members', value: counts.totalMembers },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-app-fg-muted">{label}</span>
                    <span className="font-semibold text-app-fg tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('team')}
                className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                Manage team →
              </button>
            </div>

            {/* Marketing */}
            <div className="card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                Marketing
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-app-fg-muted">Campaigns</span>
                  <span className="font-semibold text-app-fg tabular-nums">{counts.campaigns}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Empty state nudge */}
          {counts.totalMembers === 0 && counts.totalOrders === 0 && (
            <div className="rounded-xl border border-warning-300/70 dark:border-warning-700/60 bg-warning-50 dark:bg-warning-900/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-warning-900 dark:text-warning-200">
                    This branch has no data yet.
                  </p>
                  <p className="text-sm text-warning-800 dark:text-warning-300 mt-0.5">
                    Add members to activate this branch.
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => { setActiveTab('team'); setAddMemberOpen(true); }}>
                  Add first member
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Team tab ── */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-app-fg-muted">
              {counts.totalMembers} member{counts.totalMembers !== 1 ? 's' : ''} assigned to this branch.
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAddMemberOpen(true)}
            >
              + Add member
            </Button>
          </div>

          <BranchMembersPanel members={overview.members} />
        </div>
      )}

      {activeTab === 'squads' && (
        <BranchSupervisorTeamsPanel teams={teams} branchMembers={overview.members} />
      )}

      {/* ── Edit branch modal ── */}
      {editOpen && (
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
            {fetcher.data?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
              </div>
            )}
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
      {addMemberOpen && (
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
                <p className="text-sm text-app-fg-muted">All active staff are already in this branch.</p>
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
            {fetcher.data?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
              </div>
            )}
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
