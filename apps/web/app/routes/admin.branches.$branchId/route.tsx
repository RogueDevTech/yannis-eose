import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData, useFetcher } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';

// ── Remove confirmation modal ─────────────────────────────────────────────────

function RemoveModal({
  member,
  branchId,
  onClose,
}: {
  member: OverviewMember;
  branchId: string;
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

interface OverviewMember {
  userId: string;
  name: string;
  effectiveRole: string;
  isPrimary: boolean;
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
    messageTemplates: number;
  };
  csTeam: OverviewMember[];
  marketingTeam: OverviewMember[];
  otherMembers: OverviewMember[];
}

interface UserOption {
  id: string;
  name: string;
  role: string;
  email: string;
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
  { value: 'WAREHOUSE_MANAGER', label: 'Warehouse Manager' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
];

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const branchId = params.branchId;
  if (!branchId) throw new Response('Missing branch', { status: 400 });

  const cookie = getSessionCookie(request);

  const [overviewRes, usersRes] = await Promise.all([
    apiRequest<{ result?: { data?: BranchOverview } }>(
      `/trpc/branches.overview?input=${encodeURIComponent(JSON.stringify({ branchId }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<{ result?: { data?: { users: UserOption[]; pagination: unknown } } }>(
      `/trpc/users.list?input=${encodeURIComponent(JSON.stringify({ page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc', status: 'ACTIVE' }))}`,
      { method: 'GET', cookie },
    ),
  ]);

  if (!overviewRes.ok) {
    const errMsg =
      (overviewRes.data as { error?: { message?: string } } | undefined)?.error?.message ??
      'Unable to load branch';
    throw new Response(errMsg, {
      status: overviewRes.status >= 400 && overviewRes.status < 600 ? overviewRes.status : 500,
    });
  }

  const overview = overviewRes.data?.result?.data;
  if (!overview) throw new Response('Branch not found', { status: 404 });

  const allUsers: UserOption[] = (usersRes.data?.result?.data?.users ?? []).filter(
    (u) => u.role !== 'SUPER_ADMIN' && u.role !== 'ADMIN',
  );

  return { overview, allUsers };
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
      const err = res.data as { error?: { message?: string } };
      return Response.json(
        { error: err?.error?.message ?? 'Failed to update branch' },
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
      const err = res.data as { error?: { message?: string } };
      return Response.json(
        { error: err?.error?.message ?? 'Failed to add member' },
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
      const err = res.data as { error?: { message?: string } };
      return Response.json(
        { error: err?.error?.message ?? 'Failed to remove member' },
        { status: safeStatus(res.status) },
      );
    }
    return Response.json({ success: true });
  }

  return Response.json({ error: 'Unknown intent' }, { status: 400 });
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: 'green' | 'blue' | 'yellow';
}) {
  const valueClass =
    accent === 'green'
      ? 'text-success-600 dark:text-success-400'
      : accent === 'blue'
      ? 'text-primary-600 dark:text-primary-400'
      : accent === 'yellow'
      ? 'text-warning-600 dark:text-warning-400'
      : 'text-app-fg';

  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-app-fg-muted">
        {label}
      </p>
      <p className={`text-2xl font-semibold mt-1 ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-app-fg-muted mt-1">{sub}</p>}
    </div>
  );
}

// ── Member table ─────────────────────────────────────────────────────────────

function MemberTable({
  title,
  members,
  branchId,
}: {
  title: string;
  members: OverviewMember[];
  branchId: string;
}) {
  const [removeTarget, setRemoveTarget] = useState<OverviewMember | null>(null);

  if (members.length === 0) {
    return (
      <div className="card p-4">
        <p className="text-sm font-semibold text-app-fg mb-3">{title}</p>
        <EmptyState
          title="No members yet"
          variant="inline"
        />
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-app-border">
          <p className="text-sm font-semibold text-app-fg">{title}</p>
          <p className="text-xs text-app-fg-muted mt-0.5">
            {members.length} {members.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-app-border">
              <th className="px-4 py-2 text-left font-medium text-app-fg-muted">Name</th>
              <th className="px-4 py-2 text-left font-medium text-app-fg-muted">Role</th>
              <th className="px-4 py-2 text-left font-medium text-app-fg-muted">Primary</th>
              <th className="px-4 py-2 text-right font-medium text-app-fg-muted" />
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {members.map((m) => (
              <tr key={m.userId} className="hover:bg-app-hover/50">
                <td className="px-4 py-2 font-medium text-app-fg">
                  {m.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-app-fg-muted">
                  {m.effectiveRole.replace(/_/g, ' ')}
                </td>
                <td className="px-4 py-2 text-xs text-app-fg-muted">
                  {m.isPrimary ? (
                    <span className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 font-medium">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Yes
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
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

      {removeTarget && (
        <RemoveModal
          member={removeTarget}
          branchId={branchId}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type ActiveTab = 'overview' | 'team';

export default function BranchOverviewRoute() {
  const { overview, allUsers } = useLoaderData<typeof loader>();
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

  const existingMemberIds = new Set([
    ...overview.csTeam.map((m) => m.userId),
    ...overview.marketingTeam.map((m) => m.userId),
    ...overview.otherMembers.map((m) => m.userId),
  ]);
  const availableUsers = allUsers.filter((u) => !existingMemberIds.has(u.id));

  const deliveryRate =
    counts.totalOrders > 0
      ? Math.round((counts.deliveredOrders / counts.totalOrders) * 100)
      : null;

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

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Orders" value={counts.totalOrders} sub="All statuses" />
        <StatCard label="Active" value={counts.activeOrders} sub="In pipeline" accent="blue" />
        <StatCard label="Delivered" value={counts.deliveredOrders} sub="Completed" accent="green" />
        <StatCard
          label="Delivery Rate"
          value={deliveryRate !== null ? `${deliveryRate}%` : '—'}
          sub="Delivered / total"
          accent={deliveryRate !== null && deliveryRate >= 70 ? 'green' : deliveryRate !== null && deliveryRate >= 40 ? 'yellow' : undefined}
        />
        <StatCard label="Campaigns" value={counts.campaigns} sub="Marketing" />
        <StatCard label="CS Templates" value={counts.messageTemplates} sub="SMS / WhatsApp" />
      </div>

      {/* ── Tab bar ── */}
      <div className="border-b border-app-border">
        <div className="flex items-center gap-1">
          {(['overview', 'team'] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                  : 'border-transparent text-app-fg-muted hover:text-app-fg'
              }`}
            >
              {tab === 'overview' ? 'Overview' : `Team (${counts.totalMembers})`}
            </button>
          ))}
        </div>
      </div>

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
                  { label: 'CS agents', value: overview.csTeam.length },
                  { label: 'Marketing', value: overview.marketingTeam.length },
                  { label: 'Other roles', value: overview.otherMembers.length },
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

            {/* Marketing & comms */}
            <div className="card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                Marketing & Comms
              </p>
              <div className="space-y-2">
                {[
                  { label: 'Campaigns', value: counts.campaigns },
                  { label: 'Message templates', value: counts.messageTemplates },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-app-fg-muted">{label}</span>
                    <span className="font-semibold text-app-fg tabular-nums">{value}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-app-border flex flex-col gap-1.5">
                <Link
                  to={`/admin/cs/message-templates?branchId=${branch.id}`}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                >
                  View CS templates →
                </Link>
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

          <div className="grid gap-4 lg:grid-cols-2">
            <MemberTable title="Customer Support" members={overview.csTeam} branchId={branch.id} />
            <MemberTable title="Marketing" members={overview.marketingTeam} branchId={branch.id} />
          </div>

          {overview.otherMembers.length > 0 && (
            <MemberTable
              title="Other Roles"
              members={overview.otherMembers}
              branchId={branch.id}
            />
          )}
        </div>
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
