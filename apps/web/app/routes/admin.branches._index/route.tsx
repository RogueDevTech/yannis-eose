import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

import { Await, useLoaderData, useFetcher } from '@remix-run/react';
import { useCallback, useMemo, useState } from 'react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import { BranchesListLoadingShell } from '~/features/branches/BranchesDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Branch Management — Yannis EOSE' }];

interface Branch {
  id: string;
  name: string;
  code: string;
  status: string;
  settings: Record<string, unknown> | null;
  createdAt: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
  const res = await apiRequest<{ result?: { data?: Branch[] } }>(
    '/trpc/branches.list',
    { method: 'GET', cookie },
  );

  const branches: Branch[] = res.ok ? (res.data?.result?.data ?? []) : [];
  return { branches };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent') as string;

  if (intent === 'create') {
    const name = form.get('name')?.toString()?.trim() ?? '';
    const code = form.get('code')?.toString()?.trim().toUpperCase() ?? '';
    if (!name || !code) return json({ error: 'Name and code are required' }, { status: 400 });

    const res = await apiRequest('/trpc/branches.create', {
      method: 'POST',
      cookie,
      body: { name, code },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create branch') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'update') {
    const branchId = form.get('branchId')?.toString() ?? '';
    const name = form.get('name')?.toString()?.trim();
    const code = form.get('code')?.toString()?.trim().toUpperCase();
    const status = form.get('status')?.toString();
    const res = await apiRequest('/trpc/branches.update', {
      method: 'POST',
      cookie,
      // Only forward fields the operator actually touched. `branches.update`
      // makes every field optional and the service patches only what's set,
      // so an empty `code` from a stripped-down form (e.g. an older client)
      // won't accidentally clear the column.
      body: {
        branchId,
        ...(name ? { name } : {}),
        ...(code ? { code } : {}),
        ...(status ? { status } : {}),
      },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update branch') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

function BranchManagementContent({ branches }: { branches: Branch[] }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const branchSurface = useFetcherActionSurface(fetcher);
  const [createOpen, setCreateOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);

  useFetcherToast(fetcher.data, {
    successMessage: 'Branch saved',
    skipErrorToast: createOpen || !!editBranch,
  });

  const handleBranchSuccess = useCallback(() => {
    setCreateOpen(false);
    setEditBranch(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleBranchSuccess);

  const isSubmitting = fetcher.state !== 'idle';

  const branchColumns: CompactTableColumn<Branch>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (branch) => <span className="font-medium text-app-fg">{branch.name}</span>,
      },
      {
        key: 'code',
        header: 'Code',
        render: (branch) => <span className="font-mono text-xs text-app-fg-muted">{branch.code}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (branch) => <StatusBadge status={branch.status} />,
      },
      {
        key: 'created',
        header: 'Created',
        render: (branch) => (
          <span className="text-xs text-app-fg-muted">
            {new Date(branch.createdAt).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        render: (branch) => (
          <div className="inline-flex items-center justify-end gap-2">
            <CompactTableActionButton to={`/admin/branches/${branch.id}`}>View</CompactTableActionButton>
            <Button variant="secondary" size="sm" onClick={() => setEditBranch(branch)}>
              Edit
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branch Management"
        description="Manage company branches and tenant separation. Each branch has its own data scope."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            + New Branch
          </Button>
        }
      />

      {/* Branches Table */}
      <div className="card p-0 overflow-hidden">
        <CompactTable<Branch>
          columns={branchColumns}
          rows={branches}
          rowKey={(b) => b.id}
          withCard={false}
          emptyTitle="No branches yet"
          emptyDescription="Create one to enable multi-branch mode."
        />
      </div>

      {/* Create Modal */}
      {createOpen && (
        <Modal
          open
          onClose={() => setCreateOpen(false)}
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
              <p className="text-sm text-app-fg-muted mt-0.5">Add an operational unit for data scoping.</p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
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
            <input type="hidden" name="intent" value="create" />
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
            <ModalFetcherInlineError message={branchSurface.errorMatchingIntent('create')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCreateOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting} loadingText="Creating...">
                Create
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Edit Modal */}
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
                Update name, code, and status
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditBranch(null)}
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
            <input type="hidden" name="branchId" value={editBranch.id} />
            <TextInput
              label="Name"
              id="branch-edit-name"
              name="name"
              type="text"
              required
              defaultValue={editBranch.name}
            />
            <TextInput
              label="Code (unique identifier)"
              id="branch-edit-code"
              name="code"
              type="text"
              required
              defaultValue={editBranch.code}
              hint="Short label shown in the branch switcher (e.g. LGS, ABJ). Auto-uppercased on save."
              className="font-mono uppercase"
              maxLength={20}
            />
            <FormSelect
              label="Status"
              id="branch-edit-status"
              name="status"
              defaultValue={editBranch.status}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
            <ModalFetcherInlineError message={branchSurface.errorMatchingIntent('update')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" size="sm" onClick={() => setEditBranch(null)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting} loadingText="Saving...">
                Save
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}
    </div>
  );
}

export default function BranchManagementRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<BranchesListLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
        {(data) => <BranchManagementContent branches={data.branches} />}
      </CachedAwait>
  );
}
