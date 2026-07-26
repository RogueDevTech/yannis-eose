import { useCallback, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { RoleBadge } from '~/components/ui/role-badge';
import { StatusBadge } from '~/components/ui/status-badge';
import { useFetcherToast } from '~/components/ui/toast';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { PayrollOnboardingQueueItem } from './payroll-prd-types';

interface PayrollOnboardingPageProps {
  queue: PayrollOnboardingQueueItem[];
  canWrite: boolean;
}

const ROLE_OPTIONS = [
  { value: '', label: 'All roles' },
  { value: 'CS_CLOSER', label: 'CS Closer' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'TPL_MANAGER', label: 'TPL Manager' },
  { value: 'TPL_RIDER', label: 'TPL Rider' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable' },
];

export function PayrollOnboardingPage({ queue, canWrite }: PayrollOnboardingPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [approveUser, setApproveUser] = useState<PayrollOnboardingQueueItem | null>(null);
  const [rejectUser, setRejectUser] = useState<PayrollOnboardingQueueItem | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  useFetcherToast(fetcher.data, {
    successMessage: 'Onboarding action completed',
    skipErrorToast: !!(rejectUser || approveUser),
  });

  const closeApprove = useCallback(() => setApproveUser(null), []);
  const closeReject = useCallback(() => setRejectUser(null), []);
  useCloseOnFetcherSuccess(fetcher, closeApprove, { intent: 'approvePayrollOnboarding' });
  useCloseOnFetcherSuccess(fetcher, closeReject, { intent: 'rejectPayrollOnboarding' });

  const filteredQueue = useMemo(() => {
    let list = queue;
    const q = search.toLowerCase().trim();
    if (q) list = list.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
    if (roleFilter) list = list.filter((r) => r.role === roleFilter);
    if (statusFilter) list = list.filter((r) => r.onboardingPayrollStatus === statusFilter);
    return list;
  }, [queue, search, roleFilter, statusFilter]);

  const activeFilterCount = [roleFilter, statusFilter, search].filter(Boolean).length;

  const columns: CompactTableColumn<PayrollOnboardingQueueItem>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        hideable: false,
        render: (row) => <span className="font-medium text-app-fg">{row.name}</span>,
      },
      {
        key: 'email',
        header: 'Email',
        render: (row) => <span className="text-app-fg-muted truncate">{row.email}</span>,
      },
      {
        key: 'role',
        header: 'Role',
        render: (row) => <RoleBadge role={row.role} size="sm" />,
      },
      {
        key: 'status',
        header: 'Payroll status',
        render: (row) => <StatusBadge status={row.onboardingPayrollStatus} />,
      },
      {
        key: 'created',
        header: 'Joined',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">
            {new Date(row.createdAt).toLocaleDateString('en-NG', {
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
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) =>
          canWrite ? (
            <div className="inline-flex gap-1.5 justify-end">
              <CompactTableActionButton tone="success" onClick={() => setApproveUser(row)}>
                Approve
              </CompactTableActionButton>
              <CompactTableActionButton tone="danger" onClick={() => setRejectUser(row)}>
                Reject
              </CompactTableActionButton>
            </div>
          ) : (
            <CompactTableActionButton to={`/hr/users/${row.id}`}>Profile</CompactTableActionButton>
          ),
      },
    ],
    [canWrite, fetcher],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll onboarding queue"
        mobileInlineActions
        description="Staff awaiting payroll profile approval before inclusion in monthly runs."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="Onboarding toolbar"
            filtersBadgeCount={activeFilterCount}
            desktop={<PageRefreshButton />}
            filters={() => (
              <div className="space-y-3">
                <PageSearchControl
                  value={search}
                  placeholder="Search by name or email"
                  title="Search staff"
                  onApply={setSearch}
                />
                <FormSelect
                  label="Role"
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  options={ROLE_OPTIONS}
                />
                <FormSelect
                  label="Payroll status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  options={STATUS_OPTIONS}
                />
              </div>
            )}
          />
        }
      />

      <ToolbarFiltersCollapsible
        hideMobileSheet
        badgeCount={activeFilterCount}
        onClearAll={activeFilterCount > 0 ? () => { setSearch(''); setRoleFilter(''); setStatusFilter(''); } : undefined}
        searchRow={
          <PageSearchControl
            value={search}
            placeholder="Search by name or email"
            title="Search staff"
            onApply={setSearch}
          />
        }
        desktopInlineFilters={
          <>
            <FormSelect
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              options={ROLE_OPTIONS}
              wrapperClassName="w-full min-w-0 sm:w-44"
            />
            <FormSelect
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={STATUS_OPTIONS}
              wrapperClassName="w-full min-w-0 sm:w-44"
            />
          </>
        }
      />

      {filteredQueue.length === 0 ? (
        <EmptyState
          title={activeFilterCount > 0 ? 'No matching staff' : 'Queue is empty'}
          description={activeFilterCount > 0 ? 'Try adjusting your filters.' : 'New staff with pending payroll onboarding will appear here for HR review.'}
        />
      ) : (
        <CompactTable<PayrollOnboardingQueueItem>
          columnVisibilityKey="hr.payroll.onboarding"
          columns={columns}
          rows={filteredQueue}
          rowKey={(r) => r.id}
          emptyTitle="Queue is empty"
          emptyDescription=""
        />
      )}

      {approveUser ? (
        <Modal open onClose={closeApprove} maxWidth="max-w-md" backdropBlur contentClassName="p-6 space-y-4">
          <h3 className="text-base font-semibold text-app-fg">Approve payroll onboarding</h3>
          <p className="text-sm text-app-fg-muted">
            Approve <strong className="text-app-fg">{approveUser.name}</strong> for payroll? They will be included in future monthly batch runs.
          </p>
          <ModalFetcherInlineError message={surface.errorMatchingIntent('approvePayrollOnboarding')} />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={fetcher.state === 'submitting'}
              loadingText="Approving…"
              onClick={() => {
                fetcher.submit(
                  { intent: 'approvePayrollOnboarding', userId: approveUser.id },
                  { method: 'post' },
                );
              }}
            >
              Approve
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={closeApprove}>
              Cancel
            </Button>
          </div>
        </Modal>
      ) : null}

      {rejectUser ? (
        <Modal open onClose={closeReject} maxWidth="max-w-md" backdropBlur contentClassName="p-6 space-y-4">
          <h3 className="text-base font-semibold text-app-fg">Reject payroll onboarding</h3>
          <p className="text-sm text-app-fg-muted">
            {rejectUser.name} will be marked not applicable for payroll onboarding.
          </p>
          <ModalFetcherInlineError message={surface.errorMatchingIntent('rejectPayrollOnboarding')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="rejectPayrollOnboarding" />
            <input type="hidden" name="userId" value={rejectUser.id} />
            <TextInput label="Comment (optional)" name="comment" maxLength={500} />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="danger"
                size="sm"
                loading={fetcher.state === 'submitting'}
                loadingText="Rejecting…"
              >
                Reject
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={closeReject}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      ) : null}

      <p className="text-xs text-app-fg-muted">
        After approval, assign pay role and tax settings on the{' '}
        <Link to="/hr/users" className="text-brand-600 dark:text-brand-400 hover:underline">
          staff profile
        </Link>
        .
      </p>
    </div>
  );
}
