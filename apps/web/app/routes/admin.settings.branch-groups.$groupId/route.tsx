import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData, useFetcher } from '@remix-run/react';
import { useCallback, useMemo, useState } from 'react';
import { requirePermission, apiRequest, getSessionCookie, safeStatus } from '~/lib/api.server';
import { cachedClientLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip, OverviewStatStripSkeleton, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { extractApiErrorMessage } from '~/lib/api-error';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';

export const meta: MetaFunction = () => [
  { title: 'Company Group — Yannis EOSE' },
];

interface GroupBranch {
  id: string;
  name: string;
  code: string;
  status: string;
  createdAt: string;
  memberCount: number;
}

interface GroupDetail {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string | null;
  branches: GroupBranch[];
  totals: {
    branches: number;
    members: number;
    products: number;
    commissionPlans: number;
    settlementConfigs: number;
  };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const cookie = getSessionCookie(request);
  const groupId = params.groupId!;

  const [res, groupsRes] = await Promise.all([
    apiRequest<{ result?: { data?: GroupDetail } }>(
      `/trpc/branches.getGroupDetail?input=${encodeURIComponent(JSON.stringify({ groupId }))}`,
      { method: 'GET', cookie },
    ),
    apiRequest<{ result?: { data?: Array<{ id: string; name: string }> } }>(
      '/trpc/branches.listGroups',
      { method: 'GET', cookie },
    ),
  ]);

  if (!res.ok) throw json({ error: 'Company group not found' }, { status: 404 });
  const group = res.data?.result?.data;
  if (!group) throw json({ error: 'Company group not found' }, { status: 404 });

  const allGroups = groupsRes.ok ? groupsRes.data?.result?.data ?? [] : [];
  return { group, allGroups };
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent')?.toString();
  const groupId = params.groupId!;

  if (intent === 'updateGroup') {
    const name = form.get('name')?.toString()?.trim();
    if (!name) return json({ error: 'Name is required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.updateGroup', {
      method: 'POST',
      cookie,
      body: { groupId, name },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update group') }, { status: 400 });
    return json({ success: true });
  }

  if (intent === 'updateBranch') {
    const branchId = form.get('branchId')?.toString();
    const name = form.get('name')?.toString()?.trim();
    const code = form.get('code')?.toString()?.trim().toUpperCase();
    if (!branchId) return json({ error: 'Branch ID is required' }, { status: 400 });
    if (!name && !code) return json({ error: 'Name or code is required' }, { status: 400 });
    const body: Record<string, string> = { branchId };
    if (name) body.name = name;
    if (code) body.code = code;
    const res = await apiRequest('/trpc/branches.update', {
      method: 'POST',
      cookie,
      body,
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to update branch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'createBranch') {
    const name = form.get('name')?.toString()?.trim() ?? '';
    const code = form.get('code')?.toString()?.trim().toUpperCase() ?? '';
    if (!name || !code) return json({ error: 'Name and code are required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.create', {
      method: 'POST',
      cookie,
      body: { name, code, groupId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to create branch') }, { status: safeStatus(res.status) });
    return json({ success: true });
  }

  if (intent === 'assignBranch') {
    const branchId = form.get('branchId')?.toString();
    if (!branchId) return json({ error: 'Branch is required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.assignBranchToGroup', {
      method: 'POST',
      cookie,
      body: { branchId, groupId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to move branch') }, { status: 400 });
    return json({ success: true });
  }

  if (intent === 'toggleStatus') {
    const res = await apiRequest('/trpc/branches.toggleGroupStatus', {
      method: 'POST',
      cookie,
      body: { groupId },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to toggle status') }, { status: 400 });
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

// ── Loading shell ───────────────────────────────────────────────────
function GroupDetailLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title={<span className="inline-block h-6 w-36 rounded bg-app-hover animate-pulse align-middle" />}
        backTo="/admin/settings/branch-groups"
        mobileInlineActions
        description={<span className="inline-block h-3.5 w-44 rounded bg-app-hover animate-pulse align-middle" />}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Group tools"
            triggerAriaLabel="Group toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button variant="secondary" size="sm" disabled className="opacity-60">Edit</Button>
                <Button variant="primary" size="sm" disabled className="opacity-60">+ New Branch</Button>
              </>
            }
          />
        }
      />
      <OverviewStatStripSkeleton
        count={3}
        labels={['Branches', 'Members', 'Products']}
      />
      {/* Table skeleton matching branch rows */}
      <div className="card !p-0 overflow-hidden">
        <div className="divide-y divide-app-border">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-32 rounded bg-app-hover animate-pulse" />
              <div className="h-4 w-14 rounded bg-app-hover animate-pulse" />
              <div className="h-4 w-10 rounded bg-app-hover animate-pulse ml-auto" />
              <div className="h-5 w-16 rounded-full bg-app-hover animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Page component ──────────────────────────────────────────────────
function GroupDetailPage({ group }: { group: GroupDetail; allGroups: Array<{ id: string; name: string }> }) {
  const [editOpen, setEditOpen] = useState(false);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [toggleConfirmOpen, setToggleConfirmOpen] = useState(false);
  const [branchCode, setBranchCode] = useState('');
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
  const [editBranch, setEditBranch] = useState<GroupBranch | null>(null);

  const editFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const branchFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const toggleFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const editBranchFetcher = useFetcher<{ success?: boolean; error?: string }>();

  const editSurface = useFetcherActionSurface(editFetcher);
  const branchSurface = useFetcherActionSurface(branchFetcher);
  const editBranchSurface = useFetcherActionSurface(editBranchFetcher);

  useFetcherToast(editFetcher.data, {
    successMessage: 'Group updated',
    skipErrorToast: editOpen,
  });
  useFetcherToast(branchFetcher.data, {
    successMessage: 'Branch created',
    skipErrorToast: createBranchOpen,
  });
  useFetcherToast(toggleFetcher.data, {
    successMessage: group.status === 'ACTIVE' ? 'Group deactivated' : 'Group activated',
  });
  useFetcherToast(editBranchFetcher.data, {
    successMessage: 'Branch updated',
    skipErrorToast: !!editBranch,
  });
  useCloseOnFetcherSuccess(toggleFetcher, useCallback(() => setToggleConfirmOpen(false), []));

  useCloseOnFetcherSuccess(editFetcher, useCallback(() => setEditOpen(false), []));
  useCloseOnFetcherSuccess(branchFetcher, useCallback(() => { setCreateBranchOpen(false); setBranchCode(''); setCodeManuallyEdited(false); }, []));
  useCloseOnFetcherSuccess(editBranchFetcher, useCallback(() => setEditBranch(null), []));

  const isEditSubmitting = editFetcher.state !== 'idle';
  const isBranchSubmitting = branchFetcher.state !== 'idle';
  const isEditBranchSubmitting = editBranchFetcher.state !== 'idle';

  const stats: OverviewStatStripItem[] = [
    { label: 'Branches', value: group.totals.branches },
    { label: 'Members', value: group.totals.members },
    { label: 'Products', value: group.totals.products },
  ];

  const branchColumns: CompactTableColumn<GroupBranch>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Branch',
      render: (b) => (
        <Link to={`/admin/branches/${b.id}?backTo=${encodeURIComponent(`/admin/settings/branch-groups/${group.id}`)}`} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
          {b.name}
        </Link>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      render: (b) => (
        <span className="font-mono text-mini text-app-fg-muted">{b.code}</span>
      ),
    },
    {
      key: 'members',
      header: 'Members',
      align: 'right',
      render: (b) => <span className="text-sm tabular-nums text-app-fg">{b.memberCount}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (b) => <StatusBadge status={b.status} />,
    },
    {
      key: 'created',
      header: 'Created',
      render: (b) => (
        <span className="text-xs text-app-fg-muted">
          {new Date(b.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (b) => (
        <span className="inline-flex items-center gap-1.5">
          <TableActionButton onClick={() => setEditBranch(b)}>
            Edit
          </TableActionButton>
          <TableActionButton to={`/admin/branches/${b.id}?backTo=${encodeURIComponent(`/admin/settings/branch-groups/${group.id}`)}`} variant="primary">
            View
          </TableActionButton>
        </span>
      ),
    },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="inline-flex items-center gap-2">{group.name} <StatusBadge status={group.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'} /></span>}
        backTo="/admin/settings/branch-groups"
        mobileInlineActions
        description={`Created ${new Date(group.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}`}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Group tools"
            sheetSubtitle={<span>{group.name}</span>}
            triggerAriaLabel="Group toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button
                  variant="secondary"
                  size="sm"
                  className={group.status === 'ACTIVE' ? '!text-danger-600 !border-danger-300 hover:!bg-danger-50 dark:!text-danger-400 dark:!border-danger-700 dark:hover:!bg-danger-900/20' : ''}
                  onClick={() => setToggleConfirmOpen(true)}
                >
                  {group.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
                <Button variant="primary" size="sm" onClick={() => setCreateBranchOpen(true)}>
                  + New Branch
                </Button>
              </>
            }
            sheet={({ closeSheet }) => (
              <div className="space-y-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className={`w-full justify-center ${group.status === 'ACTIVE' ? '!text-danger-600 !border-danger-300 hover:!bg-danger-50 dark:!text-danger-400 dark:!border-danger-700 dark:hover:!bg-danger-900/20' : ''}`}
                  onClick={() => { closeSheet(); setToggleConfirmOpen(true); }}
                >
                  {group.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => { closeSheet(); setEditOpen(true); }}
                >
                  Edit group
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => { closeSheet(); setCreateBranchOpen(true); }}
                >
                  + New Branch
                </Button>
              </div>
            )}
          />
        }
      />

      <OverviewStatStrip items={stats} mobileGrid />

      {group.branches.length === 0 ? (
        <EmptyState
          title="No branches yet"
          description="Create the first branch for this company group."
        />
      ) : (
        <CompactTable<GroupBranch>
          columns={branchColumns}
          rows={group.branches}
          rowKey={(b) => b.id}
          renderMobileCard={(b) => (
            <Link
              to={`/admin/branches/${b.id}?backTo=${encodeURIComponent(`/admin/settings/branch-groups/${group.id}`)}`}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">{b.name}</span>
                <StatusBadge status={b.status} />
              </div>
              <div className="flex items-center gap-3 text-xs text-app-fg-muted">
                <span className="font-mono">{b.code}</span>
                <span>{b.memberCount} member{b.memberCount !== 1 ? 's' : ''}</span>
                <time dateTime={b.createdAt}>
                  {new Date(b.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                </time>
              </div>
            </Link>
          )}
        />
      )}

      {/* Edit Group Modal */}
      {editOpen && (
        <Modal
          open
          onClose={() => setEditOpen(false)}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="group-edit-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="group-edit-title" className="text-lg font-semibold text-app-fg">
                Edit company group
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5">Rename this group.</p>
            </div>
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              disabled={isEditSubmitting}
              className="text-app-fg-muted hover:text-app-fg shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <editFetcher.Form
            method="post"
            className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <input type="hidden" name="intent" value="updateGroup" />
            <TextInput
              label="Group name"
              id="edit-group-name"
              name="name"
              type="text"
              required
              defaultValue={group.name}
            />
            <ModalFetcherInlineError message={editSurface.errorMatchingIntent('updateGroup')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditOpen(false)} disabled={isEditSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isEditSubmitting} loading={isEditSubmitting} loadingText="Saving...">
                Save
              </Button>
            </div>
          </editFetcher.Form>
        </Modal>
      )}

      {/* Create Branch Modal */}
      {createBranchOpen && (
        <Modal
          open
          onClose={() => setCreateBranchOpen(false)}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="branch-create-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="branch-create-title" className="text-lg font-semibold text-app-fg">
                Create branch
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5">Add a branch to {group.name}.</p>
            </div>
            <button
              type="button"
              onClick={() => setCreateBranchOpen(false)}
              disabled={isBranchSubmitting}
              className="text-app-fg-muted hover:text-app-fg shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <branchFetcher.Form
            method="post"
            className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <input type="hidden" name="intent" value="createBranch" />
            <TextInput
              label="Branch name"
              id="branch-create-name"
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Lagos Branch"
              onChange={(e) => {
                if (!codeManuallyEdited) {
                  const words = e.target.value.trim().split(/\s+/).filter(Boolean);
                  const auto = words.map((w) => w.slice(0, 2).toUpperCase()).join('').slice(0, 6);
                  setBranchCode(auto);
                }
              }}
            />
            <TextInput
              label="Code (unique identifier)"
              id="branch-create-code"
              name="code"
              type="text"
              required
              minLength={2}
              maxLength={20}
              className="uppercase"
              placeholder="e.g. LGS"
              value={branchCode}
              onChange={(e) => {
                setCodeManuallyEdited(true);
                setBranchCode(e.target.value.toUpperCase());
              }}
            />
            <ModalFetcherInlineError message={branchSurface.errorMatchingIntent('createBranch')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCreateBranchOpen(false)} disabled={isBranchSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isBranchSubmitting} loading={isBranchSubmitting} loadingText="Creating...">
                Create
              </Button>
            </div>
          </branchFetcher.Form>
        </Modal>
      )}

      {/* Edit Branch Modal */}
      {editBranch && (
        <Modal
          open
          onClose={() => setEditBranch(null)}
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
                <span className="font-mono">{editBranch.code}</span> — {editBranch.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditBranch(null)}
              disabled={isEditBranchSubmitting}
              className="text-app-fg-muted hover:text-app-fg shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <editBranchFetcher.Form
            method="post"
            className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <input type="hidden" name="intent" value="updateBranch" />
            <input type="hidden" name="branchId" value={editBranch.id} />
            <TextInput
              label="Branch name"
              id="edit-branch-name"
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={100}
              defaultValue={editBranch.name}
            />
            <TextInput
              label="Code"
              id="edit-branch-code"
              name="code"
              type="text"
              required
              minLength={2}
              maxLength={20}
              className="uppercase"
              defaultValue={editBranch.code}
            />
            <ModalFetcherInlineError message={editBranchSurface.errorMatchingIntent('updateBranch')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditBranch(null)} disabled={isEditBranchSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isEditBranchSubmitting} loading={isEditBranchSubmitting} loadingText="Saving...">
                Save
              </Button>
            </div>
          </editBranchFetcher.Form>
        </Modal>
      )}

      {/* Activate / Deactivate Confirmation Modal */}
      {toggleConfirmOpen && (
        <Modal
          open
          onClose={() => setToggleConfirmOpen(false)}
          maxWidth="max-w-sm"
          role="alertdialog"
          contentClassName="p-6 space-y-4"
        >
          <h3 className="text-lg font-semibold text-app-fg">
            {group.status === 'ACTIVE' ? 'Deactivate company group?' : 'Activate company group?'}
          </h3>
          <p className="text-sm text-app-fg-muted">
            {group.status === 'ACTIVE'
              ? `"${group.name}" and its ${group.totals.branches} branch${group.totals.branches !== 1 ? 'es' : ''} will be hidden from the branch filter. Existing data is preserved.`
              : `"${group.name}" will be visible in the branch filter again.`}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setToggleConfirmOpen(false)} disabled={toggleFetcher.state !== 'idle'}>
              Cancel
            </Button>
            <Button
              variant={group.status === 'ACTIVE' ? 'danger' : 'primary'}
              size="sm"
              disabled={toggleFetcher.state !== 'idle'}
              loading={toggleFetcher.state !== 'idle'}
              loadingText={group.status === 'ACTIVE' ? 'Deactivating...' : 'Activating...'}
              onClick={() => toggleFetcher.submit({ intent: 'toggleStatus' }, { method: 'post' })}
            >
              {group.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Route export ────────────────────────────────────────────────────
export default function CompanyGroupDetailRoute() {
  const { group, allGroups } = useLoaderData<typeof loader>();
  return <GroupDetailPage group={group} allGroups={allGroups} />;
}
