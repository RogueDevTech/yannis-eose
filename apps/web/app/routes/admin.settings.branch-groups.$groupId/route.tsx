import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData, useFetcher } from '@remix-run/react';
import { useCallback, useMemo, useState } from 'react';
import { requirePermission, apiRequest, getSessionCookie, safeStatus } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { extractApiErrorMessage } from '~/lib/api-error';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: `${data?.group?.name ?? 'Company Group'} — Yannis EOSE` },
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

  const res = await apiRequest<{ result?: { data?: GroupDetail } }>(
    `/trpc/branches.getGroupDetail?input=${encodeURIComponent(JSON.stringify({ groupId }))}`,
    { method: 'GET', cookie },
  );

  if (!res.ok) throw json({ error: 'Company group not found' }, { status: 404 });
  const group = res.data?.result?.data;
  if (!group) throw json({ error: 'Company group not found' }, { status: 404 });

  // Load all groups for the create-branch modal group selector
  const groupsRes = await apiRequest<{ result?: { data?: Array<{ id: string; name: string }> } }>(
    '/trpc/branches.listGroups',
    { method: 'GET', cookie },
  );
  const allGroups = groupsRes.ok ? groupsRes.data?.result?.data ?? [] : [];

  return { group, allGroups };
}

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

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function CompanyGroupDetailRoute() {
  const { group, allGroups } = useLoaderData<typeof loader>();
  const [editOpen, setEditOpen] = useState(false);
  const [createBranchOpen, setCreateBranchOpen] = useState(false);

  const editFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const branchFetcher = useFetcher<{ success?: boolean; error?: string }>();

  const editSurface = useFetcherActionSurface(editFetcher);
  const branchSurface = useFetcherActionSurface(branchFetcher);

  useFetcherToast(editFetcher.data, {
    successMessage: 'Group updated',
    skipErrorToast: editOpen,
  });
  useFetcherToast(branchFetcher.data, {
    successMessage: 'Branch created',
    skipErrorToast: createBranchOpen,
  });

  useCloseOnFetcherSuccess(editFetcher, useCallback(() => setEditOpen(false), []));
  useCloseOnFetcherSuccess(branchFetcher, useCallback(() => setCreateBranchOpen(false), []));

  const isEditSubmitting = editFetcher.state !== 'idle';
  const isBranchSubmitting = branchFetcher.state !== 'idle';

  const stats: OverviewStatStripItem[] = [
    { label: 'Branches', value: group.totals.branches },
    { label: 'Members', value: group.totals.members },
    { label: 'Products', value: group.totals.products },
    { label: 'Commission Plans', value: group.totals.commissionPlans },
    { label: 'Settlement Configs', value: group.totals.settlementConfigs },
  ];

  const branchColumns: CompactTableColumn<GroupBranch>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Branch',
      render: (b) => (
        <Link to={`/admin/branches/${b.id}`} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline">
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
        <TableActionButton to={`/admin/branches/${b.id}`} variant="primary">
          View
        </TableActionButton>
      ),
    },
  ], []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={group.name}
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

      {/* Overview stats */}
      <OverviewStatStrip items={stats} mobileGrid />

      {/* Branches table */}
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
              to={`/admin/branches/${b.id}`}
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
    </div>
  );
}
