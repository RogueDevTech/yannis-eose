import { defer, json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';

import { Link, useLoaderData, useFetcher } from '@remix-run/react';
import { useCallback, useState } from 'react';
import {
  apiRequest,
  getSessionCookie,
  requirePermission,
  requirePermissionOrRoles,
  safeStatus,
} from '~/lib/api.server';
import { extractApiErrorMessage } from '~/lib/api-error';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
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
  // Branches list is also visible to org-wide heads (HoM / HoCS / HoLogistics)
  // so they can drill into the branches they're a department head for and
  // manage their team via `branches.teams.*`. Branch-mutating actions
  // (create/update/assignUser) are still gated by `branches.manage` in the
  // tRPC layer + in the action handler below.
  await requirePermissionOrRoles(request, {
    roles: ['HEAD_OF_MARKETING', 'HEAD_OF_CS', 'HEAD_OF_LOGISTICS'],
    permission: 'branches.manage',
  });
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branch Management"
        mobileInlineActions
        description="Manage company branches."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Branch tools"
            sheetSubtitle={<span>Refresh and create</span>}
            triggerAriaLabel="Branch toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  + New Branch
                </Button>
              </>
            }
            sheet={({ closeSheet }) => (
              <Button
                variant="primary"
                size="sm"
                className="w-full justify-center"
                onClick={() => {
                  closeSheet();
                  setCreateOpen(true);
                }}
              >
                + New Branch
              </Button>
            )}
          />
        }
      />

      {/* Branches grid — same card shape as `/admin/marketing/forms`. The
          whole card is a click target that routes to the branch detail page
          (overlay link with `inset-0`); the Edit button sits on top via
          `relative z-10` so it stays interactive without bubbling to the
          card's link. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {branches.map((branch) => (
          <article
            key={branch.id}
            className="group relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200 flex flex-col min-h-[180px] focus-within:ring-2 focus-within:ring-brand-500"
          >
            {/* Card-level link — covers the whole surface so any click
                outside the action buttons opens the detail view. The link
                itself has no children; the visible content sits above it. */}
            <Link
              to={`/admin/branches/${branch.id}`}
              prefetch="intent"
              aria-label={`View ${branch.name}`}
              className="absolute inset-0 z-0 rounded-xl focus:outline-none"
            />
            <div className="relative z-10 flex items-start justify-between gap-3 mb-2 pointer-events-none">
              <h3 className="font-semibold text-app-fg text-base leading-snug line-clamp-2 min-w-0 flex-1 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                {branch.name}
              </h3>
              <StatusBadge status={branch.status} className="shrink-0" />
            </div>

            <div className="relative z-10 text-sm text-app-fg-muted mb-4 flex-1 pointer-events-none">
              <span className="inline-flex items-center rounded-md border border-app-border bg-app-hover px-1.5 py-0.5 font-mono text-mini font-semibold text-app-fg-muted">
                {branch.code}
              </span>
              <span className="mx-1.5">·</span>
              <time dateTime={branch.createdAt}>
                {new Date(branch.createdAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </time>
            </div>

            <div className="relative z-10 flex items-center gap-2 pt-3 border-t border-app-border">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditBranch(branch);
                }}
                className="gap-1.5 shrink-0"
              >
                Edit
              </Button>
              <span className="ml-auto text-xs font-medium text-app-fg-muted group-hover:text-brand-600 dark:group-hover:text-brand-400 inline-flex items-center gap-1 transition-colors pointer-events-none">
                View details
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </article>
        ))}
        {branches.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              title="No branches yet"
              description="Create one to enable multi-branch mode."
            />
          </div>
        )}
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
