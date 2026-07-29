import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { BankSelect } from '~/components/ui/bank-select';
import { EmptyState } from '~/components/ui/empty-state';
import { FormSelect } from '~/components/ui/form-select';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { NairaPrice } from '~/components/ui/naira-price';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { useFetcherToast } from '~/components/ui/toast';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { PayrollContractor } from './payroll-prd-types';

interface PayrollContractorsPageProps {
  contractors: PayrollContractor[];
  statusFilter: 'active' | 'inactive';
  canWrite: boolean;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export function PayrollContractorsPage({
  contractors,
  statusFilter,
  canWrite,
}: PayrollContractorsPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  useFetcherToast(fetcher.data, {
    successMessage: 'Contractor saved',
    skipErrorToast: showCreate,
  });

  const handleSuccess = useCallback(() => {
    setShowCreate(false);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess, { intent: 'createContractor' });

  const setStatusFilter = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value === 'inactive') next.set('status', 'inactive');
      else next.delete('status');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    setStatusFilter('active');
  }, [setStatusFilter]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return contractors;
    return contractors.filter((c) => {
      const haystack = [
        c.name,
        c.jobTitle,
        c.bankName,
        c.accountName,
        c.accountNumber,
        c.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [contractors, search]);

  const activeFilterCount = [search, statusFilter === 'inactive' ? 'inactive' : ''].filter(Boolean).length;

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
        key: 'bank',
        header: 'Bank',
        render: (row) => (
          <span className="text-xs text-app-fg-muted">
            {row.bankName ?? 'Not set'}
            {row.accountNumber ? ` · ${row.accountNumber}` : ''}
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
          </div>
        ),
      },
    ],
    [],
  );

  const monthlyCost = useMemo(
    () => contractors.reduce((sum, c) => sum + Number(c.monthlyFee), 0),
    [contractors],
  );

  const renderStatusSelect = (opts?: { className?: string; wrapperClassName?: string }) => (
    <FormSelect
      label=""
      name="status"
      options={STATUS_OPTIONS}
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value)}
      className={opts?.className ?? 'w-36'}
      wrapperClassName={opts?.wrapperClassName ?? 'w-full min-w-0 sm:w-36'}
    />
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contractors"
        mobileInlineActions
        description="External agency contractors on fixed monthly fees (no PAYE)."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="Contractors toolbar"
            filtersBadgeCount={activeFilterCount}
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
            filters={() => (
              <div className="space-y-3">
                <PageSearchControl
                  value={search}
                  onApply={setSearch}
                  placeholder="Search contractors"
                  title="Search contractors"
                />
                {renderStatusSelect({ wrapperClassName: 'w-full' })}
              </div>
            )}
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

      <MobileDateFilterRow
        hideDate
        actionsSheet={
          canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              className="h-12 w-full justify-center"
              onClick={() => setShowCreate(true)}
            >
              Add contractor
            </Button>
          ) : undefined
        }
        actionsSheetTitle="Actions"
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          {
            label: statusFilter === 'inactive' ? 'Inactive' : 'Active',
            value: contractors.length,
          },
          {
            label: 'Monthly cost',
            value: <NairaPrice amount={monthlyCost} />,
          },
        ]}
      />

      <div className="list-panel">
        <ToolbarFiltersCollapsible
          className="!border-0"
          hideMobileSheet
          badgeCount={activeFilterCount}
          onClearAll={activeFilterCount > 0 ? clearFilters : undefined}
          searchRow={
            <PageSearchControl
              value={search}
              onApply={setSearch}
              placeholder="Search by name, job title, or bank"
              title="Search contractors"
            />
          }
          desktopInlineFilters={renderStatusSelect()}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            search
              ? 'No matching contractors'
              : statusFilter === 'inactive'
                ? 'No inactive contractors'
                : 'No contractors'
          }
          description={
            search
              ? 'Try adjusting your search or status filter.'
              : statusFilter === 'inactive'
                ? 'Deactivated contractors will appear here.'
                : canWrite
                  ? 'Add agency contractors to include them in payroll batch generation.'
                  : 'Contractors configured by HR will appear here.'
          }
        />
      ) : (
        <CompactTable<PayrollContractor>
          columnVisibilityKey="hr.payroll.contractors"
          columns={columns}
          rows={filtered}
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
                    {row.jobTitle || 'Contractor'}
                  </p>
                </div>
                <span className="text-sm font-semibold text-app-fg">
                  <NairaPrice amount={Number(row.monthlyFee)} />
                </span>
              </div>
              <p className="text-xs text-app-fg-muted">
                {row.bankName ?? 'Bank not set'}
                {row.accountNumber ? ` · ${row.accountNumber}` : ''}
              </p>
            </Link>
          )}
        />
      )}

      {showCreate && (
        <ContractorModal
          contractor={null}
          submitting={fetcher.state === 'submitting'}
          error={surface.errorMatchingIntent('createContractor') ?? undefined}
          fetcher={fetcher}
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function ContractorModal({
  contractor,
  submitting,
  error,
  fetcher,
  onClose,
}: {
  contractor: PayrollContractor | null;
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
          {isEdit ? 'Edit contractor' : 'New contractor'}
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
          defaultValue={contractor?.name ?? ''}
        />
        <TextInput
          label="Job title"
          name="jobTitle"
          placeholder="e.g. IT Support, Cleaning Services"
          defaultValue={contractor?.jobTitle ?? ''}
        />
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Monthly fee</label>
          <AmountInput
            name="monthlyFee"
            className="input"
            defaultValue={contractor ? String(Number(contractor.monthlyFee)) : ''}
          />
        </div>
        <BankSelect
          id={isEdit ? `contractor-bank-${contractor.id}` : 'contractor-bank-new'}
          defaultBankName={contractor?.bankName}
          defaultBankCode={contractor?.bankCode}
        />
        <TextInput
          label="Account number"
          name="accountNumber"
          inputMode="numeric"
          maxLength={10}
          defaultValue={contractor?.accountNumber ?? ''}
        />
        <TextInput label="Account name" name="accountName" defaultValue={contractor?.accountName ?? ''} />
        <TextInput label="Notes" name="notes" defaultValue={contractor?.notes ?? ''} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={submitting}>
            Save contractor
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
