import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useFetcher, Link } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';

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
      const err = res.data as { error?: { message?: string } };
      return json({ error: err?.error?.message ?? 'Failed to create branch' }, { status: safeStatus(res.status) });
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
      const err = res.data as { error?: { message?: string } };
      return json({ error: err?.error?.message ?? 'Failed to update branch' }, { status: safeStatus(res.status) });
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Branch Management</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            Manage company branches and tenant separation. Each branch has its own data scope.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          + New Branch
        </Button>
      </div>

      {/* Branches Table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700">
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Name</th>
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Code</th>
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Status</th>
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
            {branches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-surface-500 dark:text-surface-400">
                  No branches yet. Create one to enable multi-branch mode.
                </td>
              </tr>
            )}
            {branches.map((branch) => (
              <tr key={branch.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-100">{branch.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-surface-700 dark:text-surface-300">{branch.code}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    branch.status === 'ACTIVE'
                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                      : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'
                  }`}>
                    {branch.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-surface-600 dark:text-surface-400 text-xs">
                  {new Date(branch.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-2 justify-end">
                    <Link
                      to={`/admin/branches/${branch.id}`}
                      className="inline-flex items-center justify-center rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-800 dark:text-surface-100 hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors"
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
          <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="branch-create-title" className="text-lg font-semibold text-surface-900 dark:text-white">
                Create branch
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">Add an operational unit for data scoping.</p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
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
            <input type="hidden" name="intent" value="create" />
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1" htmlFor="branch-create-name">
                Branch name
              </label>
              <input
                id="branch-create-name"
                name="name"
                type="text"
                required
                minLength={2}
                maxLength={100}
                className="input w-full"
                placeholder="e.g. Lagos Branch"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1" htmlFor="branch-create-code">
                Code (unique identifier)
              </label>
              <input
                id="branch-create-code"
                name="code"
                type="text"
                required
                minLength={2}
                maxLength={20}
                className="input w-full uppercase"
                placeholder="e.g. LGS"
              />
            </div>
            {fetcher.data?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-700 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-400">{fetcher.data.error}</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-200 dark:border-surface-700">
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
          <div className="flex items-center justify-between pb-3 border-b border-surface-200 dark:border-surface-700 shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="branch-edit-title" className="text-lg font-semibold text-surface-900 dark:text-white">
                Edit branch
              </h3>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
                Update name and status · <span className="font-mono">{editBranch.code}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditBranch(null)}
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
            <input type="hidden" name="branchId" value={editBranch.id} />
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1" htmlFor="branch-edit-name">
                Name
              </label>
              <input id="branch-edit-name" name="name" type="text" defaultValue={editBranch.name} required className="input w-full" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1" htmlFor="branch-edit-status">
                Status
              </label>
              <select id="branch-edit-status" name="status" defaultValue={editBranch.status} className="input w-full">
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
