import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { NairaPrice } from '~/components/ui/naira-price';
import { useFetcherToast } from '~/components/ui/toast';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { BranchOption, PayrollContractor } from './payroll-prd-types';

interface PayrollContractorsPageProps {
  contractors: PayrollContractor[];
  branches: BranchOption[];
  canWrite: boolean;
}

export function PayrollContractorsPage({ contractors, branches, canWrite }: PayrollContractorsPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [editRow, setEditRow] = useState<PayrollContractor | null>(null);

  useFetcherToast(fetcher.data, {
    successMessage: 'Contractor saved',
    skipErrorToast: showCreate || !!editRow,
  });

  const handleSuccess = useCallback(() => {
    setShowCreate(false);
    setEditRow(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess, { intent: 'createContractor' });
  useCloseOnFetcherSuccess(fetcher, handleSuccess, { intent: 'updateContractor' });

  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string | null) => (id ? map.get(id) ?? 'Unknown branch' : 'All branches');
  }, [branches]);

  const columns: CompactTableColumn<PayrollContractor>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Contractor',
        hideable: false,
        render: (row) => (
          <Link
            to={`/hr/payroll/contractors/${row.id}`}
            className="font-medium text-app-fg hover:underline"
          >
            {row.name}
          </Link>
        ),
      },
      {
        key: 'jobTitle',
        header: 'Job title',
        render: (row) => <span className="text-app-fg-muted">{row.jobTitle || 'Not set'}</span>,
      },
      {
        key: 'fee',
        header: 'Monthly fee',
        align: 'right',
        render: (row) => <NairaPrice amount={Number(row.monthlyFee)} />,
      },
      {
        key: 'branch',
        header: 'Branch',
        render: (row) => <span className="text-sm text-app-fg-muted">{branchName(row.branchId)}</span>,
      },
      {
        key: 'bank',
        header: 'Bank',
        render: (row) => (
          <span className="text-xs text-app-fg-muted">
            {row.bankName ?? 'Not set'}
            {row.accountNumber ? ` · ****${row.accountNumber.slice(-4)}` : ''}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) => (
          <div className="flex items-center justify-end gap-2">
            <CompactTableActionButton to={`/hr/payroll/contractors/${row.id}`} tone="brand">
              View
            </CompactTableActionButton>
            {canWrite ? (
              <CompactTableActionButton tone="brand" onClick={() => setEditRow(row)}>
                Edit
              </CompactTableActionButton>
            ) : null}
          </div>
        ),
      },
    ],
    [branchName, canWrite],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contractors"
        mobileInlineActions
        description="External agency contractors on fixed monthly fees (no PAYE)."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Contractors toolbar"
            desktop={
              <>
                <PageRefreshButton />
                {canWrite ? (
                  <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                    Add contractor
                  </Button>
                ) : null}
              </>
            }
            sheet={({ closeSheet }) =>
              canWrite ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-12 w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowCreate(true);
                  }}
                >
                  Add contractor
                </Button>
              ) : null
            }
          />
        }
      />

      {contractors.length > 0 && (
        <OverviewStatStrip
          mobileGrid
          items={[
            { label: 'Contractors', value: contractors.length },
            { label: 'Active', value: contractors.filter((c) => c.active).length },
            {
              label: 'Monthly cost',
              value: (
                <NairaPrice
                  amount={contractors
                    .filter((c) => c.active)
                    .reduce((sum, c) => sum + Number(c.monthlyFee), 0)}
                />
              ),
            },
          ]}
        />
      )}

      {contractors.length === 0 ? (
        <EmptyState
          title="No contractors"
          description={
            canWrite
              ? 'Add agency contractors to include them in payroll batch generation.'
              : 'Contractors configured by HR will appear here.'
          }
        />
      ) : (
        <CompactTable<PayrollContractor>
          columnVisibilityKey="hr.payroll.contractors"
          columns={columns}
          rows={contractors}
          rowKey={(r) => r.id}
          emptyTitle="No contractors"
          emptyDescription=""
          renderMobileCard={(row) => (
            <Link
              to={`/hr/payroll/contractors/${row.id}`}
              className="block p-4 space-y-3 hover:bg-app-hover transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-app-fg text-sm">{row.name}</p>
                  <p className="text-xs text-app-fg-muted mt-0.5">
                    {row.jobTitle ? `${row.jobTitle} · ` : ''}{branchName(row.branchId)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-app-fg">
                  <NairaPrice amount={Number(row.monthlyFee)} />
                </span>
              </div>
              <p className="text-xs text-app-fg-muted">
                {row.bankName ?? 'Bank not set'}
                {row.accountNumber ? ` · ****${row.accountNumber.slice(-4)}` : ''}
              </p>
            </Link>
          )}
        />
      )}

      {(showCreate || editRow) && (
        <ContractorModal
          contractor={editRow}
          branches={branches}
          readOnly={false}
          submitting={fetcher.state === 'submitting'}
          error={surface.errorMatchingIntent(editRow ? 'updateContractor' : 'createContractor') ?? undefined}
          fetcher={fetcher}
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowCreate(false);
            setEditRow(null);
          }}
        />
      )}
    </div>
  );
}

function ContractorModal({
  contractor,
  branches,
  readOnly,
  submitting,
  error,
  fetcher,
  onClose,
}: {
  contractor: PayrollContractor | null;
  branches: BranchOption[];
  readOnly: boolean;
  submitting: boolean;
  error?: string;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const isEdit = !!contractor;
  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" backdropBlur contentClassName="p-6 sm:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-app-fg">
          {readOnly ? 'View contractor' : isEdit ? 'Edit contractor' : 'New contractor'}
        </h3>
        <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg p-1 -m-1" aria-label="Close">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <ModalFetcherInlineError message={error} />

      <fetcher.Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value={isEdit ? 'updateContractor' : 'createContractor'} />
        {isEdit ? <input type="hidden" name="contractorId" value={contractor.id} /> : null}

        <TextInput
          label="Name"
          name="name"
          required
          readOnly={readOnly}
          defaultValue={contractor?.name ?? ''}
        />
        <TextInput
          label="Job title"
          name="jobTitle"
          readOnly={readOnly}
          placeholder="e.g. IT Support, Cleaning Services"
          defaultValue={contractor?.jobTitle ?? ''}
        />
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Monthly fee (₦)</label>
          <AmountInput
            name="monthlyFee"
            className="input"
            disabled={readOnly}
            defaultValue={contractor ? String(Number(contractor.monthlyFee)) : ''}
          />
        </div>
        <FormSelect
          label="Branch (optional)"
          name="branchId"
          disabled={readOnly}
          defaultValue={contractor?.branchId ?? ''}
          options={[
            { value: '', label: 'No branch' },
            ...branches.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
        <TextInput label="Bank name" name="bankName" readOnly={readOnly} defaultValue={contractor?.bankName ?? ''} />
        <TextInput label="Bank code" name="bankCode" readOnly={readOnly} defaultValue={contractor?.bankCode ?? ''} />
        <TextInput
          label="Account number"
          name="accountNumber"
          readOnly={readOnly}
          maxLength={10}
          defaultValue={contractor?.accountNumber ?? ''}
        />
        <TextInput label="Account name" name="accountName" readOnly={readOnly} defaultValue={contractor?.accountName ?? ''} />
        <TextInput label="Notes" name="notes" readOnly={readOnly} defaultValue={contractor?.notes ?? ''} />

        <div className="flex gap-2 pt-1">
          {!readOnly ? (
            <Button type="submit" variant="primary" size="sm" loading={submitting} loadingText="Saving…">
              Save contractor
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
