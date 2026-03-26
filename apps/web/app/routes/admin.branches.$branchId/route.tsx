import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData, useFetcher } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';

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

// ── Loader ──────────────────────────────────────────────────────────────────

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
    (u) => u.role !== 'SUPER_ADMIN',
  );

  return { overview, allUsers };
}

// ── Action ──────────────────────────────────────────────────────────────────

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
  const removeFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(removeFetcher.data, { successMessage: 'Member removed' });

  const [confirmUserId, setConfirmUserId] = useState<string | null>(null);

  const removingUserId =
    removeFetcher.state !== 'idle'
      ? (removeFetcher.formData?.get('userId') as string | null)
      : null;

  if (members.length === 0) {
    return (
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-1">{title}</h2>
        <p className="text-sm text-surface-500 dark:text-surface-400">
          No members in this branch with matching roles yet.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-0">
      <div className="px-4 py-3 border-b border-surface-200 dark:border-surface-700">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white">{title}</h2>
        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
          {members.length} in branch
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-200 dark:border-surface-700">
            <th className="px-4 py-2 text-left font-medium text-surface-600 dark:text-surface-400">
              Name
            </th>
            <th className="px-4 py-2 text-left font-medium text-surface-600 dark:text-surface-400">
              Role
            </th>
            <th className="px-4 py-2 text-left font-medium text-surface-600 dark:text-surface-400">
              Primary
            </th>
            <th className="px-4 py-2 text-right font-medium text-surface-600 dark:text-surface-400" />
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
          {members.map((m) => {
            const isRemoving = removingUserId === m.userId;
            const isConfirming = confirmUserId === m.userId;
            return (
              <tr key={m.userId} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td className="px-4 py-2 font-medium text-surface-900 dark:text-surface-100">
                  {m.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-surface-700 dark:text-surface-300">
                  {m.effectiveRole}
                </td>
                <td className="px-4 py-2 text-surface-600 dark:text-surface-400 text-xs">
                  {m.isPrimary ? (
                    <span className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 font-medium">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Yes
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-2 justify-end">
                    <Link
                      to={`/hr/users/${m.userId}`}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      Profile
                    </Link>
                    {isConfirming ? (
                      <div className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-surface-600 dark:text-surface-400">
                          Remove?
                        </span>
                        <removeFetcher.Form method="post">
                          <input type="hidden" name="intent" value="removeUser" />
                          <input type="hidden" name="userId" value={m.userId} />
                          <button
                            type="submit"
                            disabled={isRemoving}
                            className="text-xs font-medium text-danger-600 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300 disabled:opacity-50"
                          >
                            {isRemoving ? 'Removing…' : 'Yes'}
                          </button>
                        </removeFetcher.Form>
                        <button
                          type="button"
                          onClick={() => setConfirmUserId(null)}
                          className="text-xs text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmUserId(m.userId)}
                        disabled={isRemoving}
                        className="text-xs font-medium text-danger-600 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BranchOverviewRoute() {
  const { overview, allUsers } = useLoaderData<typeof loader>();
  const { branch, counts } = overview;

  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data, { successMessage: 'Saved' });

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

  // All current member user IDs (for filtering the add-member picker)
  const existingMemberIds = new Set([
    ...overview.csTeam.map((m) => m.userId),
    ...overview.marketingTeam.map((m) => m.userId),
    ...overview.otherMembers.map((m) => m.userId),
  ]);

  const availableUsers = allUsers.filter((u) => !existingMemberIds.has(u.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/admin/branches"
          className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
        >
          ← All branches
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-surface-900 dark:text-white">{branch.name}</h1>
            <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
              Code <span className="font-mono">{branch.code}</span>
              <span className="mx-2 text-surface-300 dark:text-surface-600">·</span>
              Created{' '}
              {new Date(branch.createdAt).toLocaleDateString('en-NG', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                branch.status === 'ACTIVE'
                  ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                  : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'
              }`}
            >
              {branch.status}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              Edit branch
            </Button>
          </div>
        </div>
        <p className="text-sm text-surface-600 dark:text-surface-400 mt-3 max-w-2xl">
          Snapshot of people and workload scoped to this branch: customer support assignments,
          marketing campaigns, and orders tagged with this{' '}
          <code className="text-xs bg-surface-100 dark:bg-surface-800 px-1 rounded">
            branch_id
          </code>
          .
        </p>
      </div>

      {/* Metrics — orders */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
            Orders
          </p>
          <p className="text-2xl font-semibold text-surface-900 dark:text-white mt-1">
            {counts.totalOrders}
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">All statuses</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
            Active pipeline
          </p>
          <p className="text-2xl font-semibold text-surface-900 dark:text-white mt-1">
            {counts.activeOrders}
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">Through in-transit</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
            Delivered
          </p>
          <p className="text-2xl font-semibold text-surface-900 dark:text-white mt-1">
            {counts.deliveredOrders}
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
            Completed deliveries
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
            Members
          </p>
          <p className="text-2xl font-semibold text-surface-900 dark:text-white mt-1">
            {counts.totalMembers}
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">Assigned to branch</p>
        </div>
      </div>

      {/* Metrics — campaigns + templates */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
            Marketing
          </p>
          <p className="text-2xl font-semibold text-surface-900 dark:text-white mt-1">
            {counts.campaigns}
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
            Campaigns with this branch
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400">
            CS templates
          </p>
          <p className="text-2xl font-semibold text-surface-900 dark:text-white mt-1">
            {counts.messageTemplates}
          </p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
            SMS / WhatsApp templates
          </p>
        </div>
      </div>

      {/* Member tables */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Team members</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddMemberOpen(true)}
          disabled={availableUsers.length === 0}
        >
          + Add member
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <MemberTable title="Customer support" members={overview.csTeam} branchId={branch.id} />
        <MemberTable title="Marketing" members={overview.marketingTeam} branchId={branch.id} />
      </div>

      {overview.otherMembers.length > 0 && (
        <MemberTable
          title="Other roles in this branch"
          members={overview.otherMembers}
          branchId={branch.id}
        />
      )}

      {/* Edit branch modal */}
      {editOpen && (
        <Modal
          open
          onClose={() => setEditOpen(false)}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="branch-edit-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3
                id="branch-edit-title"
                className="text-lg font-semibold text-surface-900 dark:text-white"
              >
                Edit branch
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                Update name and status ·{' '}
                <span className="font-mono text-xs">{branch.code}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={isSubmitting}
              className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 shrink-0"
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
            <div>
              <label
                className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1"
                htmlFor="edit-branch-name"
              >
                Name
              </label>
              <input
                id="edit-branch-name"
                name="name"
                type="text"
                required
                defaultValue={branch.name}
                className="input w-full"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1"
                htmlFor="edit-branch-status"
              >
                Status
              </label>
              <select
                id="edit-branch-status"
                name="status"
                defaultValue={branch.status}
                className="input w-full"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
            {fetcher.data?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
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

      {/* Add member modal */}
      {addMemberOpen && (
        <Modal
          open
          onClose={() => setAddMemberOpen(false)}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="add-member-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3
                id="add-member-title"
                className="text-lg font-semibold text-surface-900 dark:text-white"
              >
                Add member
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                Assign a staff member to <span className="font-medium">{branch.name}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddMemberOpen(false)}
              disabled={isSubmitting}
              className="text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 shrink-0"
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
              <label
                className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1"
                htmlFor="add-member-user"
              >
                Staff member
              </label>
              {availableUsers.length === 0 ? (
                <p className="text-sm text-surface-500 dark:text-surface-400">
                  All active staff are already in this branch.
                </p>
              ) : (
                <select
                  id="add-member-user"
                  name="userId"
                  required
                  className="input w-full"
                >
                  <option value="">Select a staff member…</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.role.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label
                className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1"
                htmlFor="add-member-role"
              >
                Role override{' '}
                <span className="text-xs font-normal text-surface-500 dark:text-surface-400">
                  (optional — leave blank to use global role)
                </span>
              </label>
              <select id="add-member-role" name="roleInBranch" className="input w-full">
                <option value="">Use global role</option>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="add-member-primary"
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="rounded border-surface-300 dark:border-surface-600 text-brand-600"
              />
              <label
                htmlFor="add-member-primary"
                className="text-sm text-surface-700 dark:text-surface-300 cursor-pointer"
              >
                Set as primary branch for this user
              </label>
            </div>
            {fetcher.data?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
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
