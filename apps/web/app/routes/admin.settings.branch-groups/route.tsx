import { json } from '@remix-run/node';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { Link, useLoaderData, useFetcher } from '@remix-run/react';
import { useCallback, useState } from 'react';
import { requirePermission, apiRequest, getSessionCookie } from '~/lib/api.server';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { EmptyState } from '~/components/ui/empty-state';
import { extractApiErrorMessage } from '~/lib/api-error';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';

export const meta: MetaFunction = () => [{ title: 'Company Groups — Yannis EOSE' }];

interface BranchGroup {
  id: string;
  name: string;
  createdAt: string;
  branchCount: number;
  userCount: number;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const cookie = getSessionCookie(request);

  const groupsRes = await apiRequest<{ result?: { data?: BranchGroup[] } }>('/trpc/branches.listGroups', {
    method: 'GET',
    cookie,
  });
  const groups = groupsRes.ok ? groupsRes.data?.result?.data ?? [] : [];

  return { groups };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'branches.manage');
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent')?.toString();

  if (intent === 'createGroup') {
    const name = form.get('name')?.toString()?.trim();
    if (!name) return json({ error: 'Name is required' }, { status: 400 });
    const res = await apiRequest('/trpc/branches.createGroup', {
      method: 'POST',
      cookie,
      body: { name },
    });
    if (!res.ok) return json({ error: extractApiErrorMessage(res.data, 'Failed to create group') }, { status: 400 });
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

export default function CompanyGroupsPage() {
  const { groups } = useLoaderData<typeof loader>();
  const [createOpen, setCreateOpen] = useState(false);

  const createFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const createSurface = useFetcherActionSurface(createFetcher);

  useFetcherToast(createFetcher.data, {
    successMessage: 'Group created',
    skipErrorToast: createOpen,
  });

  useCloseOnFetcherSuccess(createFetcher, useCallback(() => setCreateOpen(false), []));

  const isSubmitting = createFetcher.state !== 'idle';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Groups"
        backTo="/admin/settings?tab=system"
        mobileInlineActions
        description="Group branches into companies for data isolation."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Group tools"
            sheetSubtitle={<span>Manage company groups</span>}
            triggerAriaLabel="Group toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  + New Group
                </Button>
              </>
            }
            sheet={({ closeSheet }) => (
              <Button
                variant="primary"
                size="sm"
                className="w-full justify-center"
                onClick={() => { closeSheet(); setCreateOpen(true); }}
              >
                + New Group
              </Button>
            )}
          />
        }
      />

      {/* Groups grid — card design matching /admin/branches */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {groups.map((group) => (
          <article
            key={group.id}
            className="group relative bg-app-elevated rounded-xl border border-app-border p-5 shadow-sm hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200 flex flex-col min-h-[160px] focus-within:ring-2 focus-within:ring-brand-500"
          >
            {/* Card-level link */}
            <Link
              to={`/admin/settings/branch-groups/${group.id}`}
              prefetch="intent"
              aria-label={`View ${group.name}`}
              className="absolute inset-0 z-0 rounded-xl focus:outline-none"
            />

            <div className="relative z-10 flex items-start justify-between gap-3 mb-2 pointer-events-none">
              <h3 className="font-semibold text-app-fg text-base leading-snug line-clamp-2 min-w-0 flex-1 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                {group.name}
              </h3>
            </div>

            <div className="relative z-10 text-sm text-app-fg-muted mb-4 flex-1 pointer-events-none">
              <span>{group.branchCount} branch{group.branchCount !== 1 ? 'es' : ''}</span>
              <span className="mx-1.5">·</span>
              <span>{group.userCount} user{group.userCount !== 1 ? 's' : ''}</span>
              <span className="mx-1.5">·</span>
              <time dateTime={group.createdAt}>
                {new Date(group.createdAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </time>
            </div>

            <div className="relative z-10 flex items-center gap-2 pt-3 border-t border-app-border pointer-events-none">
              <span className="ml-auto text-xs font-medium text-app-fg-muted group-hover:text-brand-600 dark:group-hover:text-brand-400 inline-flex items-center gap-1 transition-colors">
                View details
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </div>
          </article>
        ))}
        {groups.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              title="No company groups yet"
              description="Create one to enable multi-company data isolation."
            />
          </div>
        )}
      </div>

      {/* Create Group Modal */}
      {createOpen && (
        <Modal
          open
          onClose={() => setCreateOpen(false)}
          maxWidth="max-w-md"
          role="dialog"
          aria-labelledby="group-create-title"
          contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[90dvh]"
        >
          <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0 px-4 pt-4 sm:px-5 sm:pt-5">
            <div>
              <h3 id="group-create-title" className="text-lg font-semibold text-app-fg">
                Create company group
              </h3>
              <p className="text-sm text-app-fg-muted mt-0.5">A company boundary for data isolation.</p>
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
          <createFetcher.Form
            method="post"
            className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <input type="hidden" name="intent" value="createGroup" />
            <TextInput
              label="Group name"
              id="create-group-name"
              name="name"
              type="text"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Company B"
            />
            <ModalFetcherInlineError message={createSurface.errorMatchingIntent('createGroup')} />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCreateOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting} loadingText="Creating...">
                Create
              </Button>
            </div>
          </createFetcher.Form>
        </Modal>
      )}
    </div>
  );
}
