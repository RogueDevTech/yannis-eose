import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useFetcher, Link } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
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

  const res = await apiRequest<{ result?: { data?: Branch[] } }>(
    '/trpc/branches.list',
    { method: 'GET', cookie },
  );

  const branches: Branch[] = res.ok ? (res.data?.result?.data ?? []) : [];
  return { branches };
}

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
    const status = form.get('status')?.toString();
    const res = await apiRequest('/trpc/branches.update', {
      method: 'POST',
      cookie,
      body: { branchId, name, status },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update branch') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function BranchManagementRoute() {
  const { branches } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data, { successMessage: 'Branch saved' });

  const [createOpen, setCreateOpen] = useState(false);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);

  const wasSubmittingRef = useRef(false);
  useEffect(() => {
    if (fetcher.state === 'submitting' || fetcher.state === 'loading') {
      wasSubmittingRef.current = true;
      return;
    }
    if (fetcher.state === 'idle' && wasSubmittingRef.current) {
      wasSubmittingRef.current = false;
      if (fetcher.data?.success) {
        setCreateOpen(false);
        setEditBranch(null);
      }
    }
  }, [fetcher.state, fetcher.data]);

  const isSubmitting = fetcher.state !== 'idle';

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
      <div className="card p-0">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header-muted">Name</th>
                <th className="table-header-muted">Code</th>
                <th className="table-header-muted">Status</th>
                <th className="table-header-muted">Created</th>
                <th className="table-header-muted w-0" />
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {branches.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10">
                    <EmptyState
                      title="No branches yet"
                      description="Create one to enable multi-branch mode."
                      variant="inline"
                    />
                  </td>
                </tr>
              )}
              {branches.map((branch) => (
                <tr key={branch.id} className="hover:bg-app-hover/50">
                  <td className="px-4 py-3 font-medium text-app-fg">{branch.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-app-fg-muted">{branch.code}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={branch.status} />
                  </td>
                  <td className="px-4 py-3 text-app-fg-muted text-xs">
                    {new Date(branch.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2 justify-end">
                      <Link
                        to={`/admin/branches/${branch.id}`}
                        className="inline-flex items-center justify-center rounded-lg border border-app-border bg-app-elevated px-3 py-1.5 text-xs font-medium text-app-fg hover:bg-app-hover transition-colors"
                      >
                        View
                      </Link>
                      <Button variant="secondary" size="sm" onClick={() => setEditBranch(branch)}>
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="md:hidden space-y-3 p-3">
          {branches.length === 0 && (
            <EmptyState
              title="No branches yet"
              description="Create one to enable multi-branch mode."
              variant="inline"
              bordered
            />
          )}
          {branches.map((branch) => (
            <div
              key={branch.id}
              className="rounded-lg border border-app-border bg-app-elevated p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-app-fg truncate">{branch.name}</p>
                  <p className="mt-1 font-mono text-xs text-app-fg-muted">{branch.code}</p>
                </div>
                <StatusBadge status={branch.status} />
              </div>
              <p className="mt-3 text-xs text-app-fg-muted">
                Created {new Date(branch.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Link
                  to={`/admin/branches/${branch.id}`}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-app-border bg-app-elevated px-3 py-2 text-xs font-medium text-app-fg hover:bg-app-hover transition-colors"
                >
                  View
                </Link>
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => setEditBranch(branch)}>
                  Edit
                </Button>
              </div>
            </div>
          ))}
        </div>
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
            {fetcher.data?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
              </div>
            )}
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
                Update name and status · <span className="font-mono">{editBranch.code}</span>
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
            {fetcher.data?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
              </div>
            )}
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
