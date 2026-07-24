import { useCallback, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { EmptyState } from '~/components/ui/empty-state';
import { RoleBadge } from '~/components/ui/role-badge';
import { useFetcherToast } from '~/components/ui/toast';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TableActionButton } from '~/components/ui/table-action-button';
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

export function PayrollOnboardingPage({ queue, canWrite }: PayrollOnboardingPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [rejectUser, setRejectUser] = useState<PayrollOnboardingQueueItem | null>(null);

  useFetcherToast(fetcher.data, {
    successMessage: 'Onboarding action completed',
    skipErrorToast: !!rejectUser,
  });

  const closeReject = useCallback(() => setRejectUser(null), []);
  useCloseOnFetcherSuccess(fetcher, closeReject, { intent: 'rejectPayrollOnboarding' });
  useCloseOnFetcherSuccess(fetcher, () => undefined, { intent: 'approvePayrollOnboarding' });

  const columns: CompactTableColumn<PayrollOnboardingQueueItem>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Staff',
        hideable: false,
        render: (row) => (
          <div>
            <span className="font-medium text-app-fg">{row.name}</span>
            <p className="text-xs text-app-fg-muted truncate">{row.email}</p>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        render: (row) => <RoleBadge role={row.role} />,
      },
      {
        key: 'status',
        header: 'Payroll status',
        render: (row) => (
          <span className="badge-warning text-2xs">{row.onboardingPayrollStatus.replace(/_/g, ' ')}</span>
        ),
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
              <fetcher.Form method="post" className="inline">
                <input type="hidden" name="intent" value="approvePayrollOnboarding" />
                <input type="hidden" name="userId" value={row.id} />
                <TableActionButton
                  type="submit"
                  variant="success"
                  disabled={fetcher.state !== 'idle'}
                >
                  Approve
                </TableActionButton>
              </fetcher.Form>
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
            sheetTitle="Actions"
            triggerAriaLabel="Onboarding toolbar"
            desktop={<PageRefreshButton />}
          />
        }
      />

      {queue.length === 0 ? (
        <EmptyState
          title="Queue is empty"
          description="New staff with pending payroll onboarding will appear here for HR review."
        />
      ) : (
        <CompactTable<PayrollOnboardingQueueItem>
          columnVisibilityKey="hr.payroll.onboarding"
          columns={columns}
          rows={queue}
          rowKey={(r) => r.id}
          emptyTitle="Queue is empty"
          emptyDescription=""
        />
      )}

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
