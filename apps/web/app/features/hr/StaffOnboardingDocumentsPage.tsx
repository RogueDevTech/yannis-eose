import { Link, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { InlineFilter } from '~/components/ui/inline-filter';
import { FormSelect } from '~/components/ui/form-select';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { StatusBadge } from '~/components/ui/status-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';

export type StaffOnboardingDocumentRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  primaryBranchId: string | null;
  primaryBranchName: string | null;
  payRoleId: string | null;
  onboardingPayrollStatus: string | null;
  onboardingStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
  submittedAt: string | null;
  approvedAt: string | null;
  onboardingUpdatedAt: string | null;
};

interface StaffOnboardingDocumentsPageProps {
  rows: StaffOnboardingDocumentRow[];
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onboardingParam: string;
  payrollParam: string;
  sortByParam: string;
  sortOrderParam: string;
  searchParam: string;
  counts?: {
    total: number;
    NOT_STARTED: number;
    IN_PROGRESS: number;
    SUBMITTED: number;
    APPROVED: number;
  };
}

const ONBOARDING_OPTIONS = [
  { value: 'ALL', label: 'All onboarding statuses' },
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'APPROVED', label: 'Approved' },
] as const;

const PAYROLL_OPTIONS = [
  { value: 'ALL', label: 'All payroll setup' },
  { value: 'SET_UP', label: 'Payroll set up' },
  { value: 'NOT_SET_UP', label: 'Payroll not set up' },
] as const;

const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A–Z default)' },
  { value: 'onboardingUpdatedAt', label: 'Last onboarding activity' },
] as const;

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function StaffOnboardingDocumentsPage({
  rows,
  page,
  totalPages,
  totalCount,
  pageSize,
  onboardingParam,
  payrollParam,
  sortByParam,
  sortOrderParam,
  searchParam,
  counts,
}: StaffOnboardingDocumentsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isFilterLoading = useLoaderRefetchBusy().busy;

  const activeFilterCount = [
    onboardingParam !== 'ALL' ? onboardingParam : '',
    payrollParam !== 'ALL' ? payrollParam : '',
    sortByParam !== 'name' ? sortByParam : '',
    sortOrderParam !== 'asc' ? sortOrderParam : '',
  ].filter(Boolean).length;

  const clearFilters = () =>
    patchParams({
      onboarding: undefined,
      payroll: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });

  const patchParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  /** Mirrors `patchParams` but returns a `?query` string for `<Link to>`. */
  const buildQuery = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.set('page', '1');
    const qs = next.toString();
    return qs ? `?${qs}` : '?';
  };

  const columns: CompactTableColumn<StaffOnboardingDocumentRow>[] = [
    {
      key: 'name',
      header: 'Name',
      hideable: false,
      render: (row) => (
        <Link
          to={`/hr/users/${row.userId}`}
          prefetch="intent"
          className="text-sm font-medium leading-none text-brand-600 dark:text-brand-400 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    {
      key: 'onboardingStatus',
      header: 'Onboarding',
      render: (row) => (
        <StatusBadge status={row.onboardingStatus} size="sm" className="!py-0 leading-none" />
      ),
    },
    {
      key: 'payrollStatus',
      header: 'Payroll',
      render: (row) => (
        <StatusBadge
          status={row.payRoleId ? 'Set up' : 'Not set up'}
          variant={row.payRoleId ? 'success' : 'warning'}
          size="sm"
          className="!py-0 leading-none"
        />
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs leading-none text-app-muted whitespace-nowrap">{formatTs(row.submittedAt)}</span>
      ),
    },
    {
      key: 'approvedAt',
      header: 'Approved',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs leading-none text-app-muted whitespace-nowrap">{formatTs(row.approvedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      hideable: false,
      render: (row) => (
        <CompactTableActionButton to={`/hr/users/${row.userId}/onboarding`} tone="brand">
          Open
        </CompactTableActionButton>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff onboarding documents"
        mobileInlineActions
        description="Review staff onboarding documents."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="Onboarding filters"
            saveFilterKey
            filtersBadgeCount={activeFilterCount}
            onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
            desktop={<PageRefreshButton />}
            filters={
              <div className="space-y-3">
                <FormSelect
                  label="Onboarding"
                  value={onboardingParam}
                  onChange={(e) => patchParams({ onboarding: e.target.value === 'ALL' ? undefined : e.target.value })}
                  options={[...ONBOARDING_OPTIONS]}
                />
                <FormSelect
                  label="Payroll"
                  value={payrollParam}
                  onChange={(e) => patchParams({ payroll: e.target.value === 'ALL' ? undefined : e.target.value })}
                  options={[...PAYROLL_OPTIONS]}
                />
                <FormSelect
                  label="Sort"
                  value={sortByParam}
                  onChange={(e) => patchParams({ sortBy: e.target.value })}
                  options={[...SORT_OPTIONS]}
                />
                <FormSelect
                  label="Order"
                  value={sortOrderParam}
                  onChange={(e) => patchParams({ sortOrder: e.target.value })}
                  options={[
                    { value: 'asc', label: 'Ascending' },
                    { value: 'desc', label: 'Descending' },
                  ]}
                />
              </div>
            }
          />
        }
      />

      <MobileDateFilterRow hideDate />

      {counts ? (
        <OverviewStatStrip
          mobileGrid
          items={[
            {
              label: 'Total',
              value: counts.total.toString(),
              valueClassName: 'text-app-fg',
            },
            {
              label: 'Not started',
              value: counts.NOT_STARTED.toString(),
              valueClassName:
                counts.NOT_STARTED > 0
                  ? 'text-app-fg-muted'
                  : 'text-app-fg',
              to: buildQuery({ onboarding: 'NOT_STARTED' }),
            },
            {
              label: 'In progress',
              value: counts.IN_PROGRESS.toString(),
              valueClassName:
                counts.IN_PROGRESS > 0
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-app-fg',
              to: buildQuery({ onboarding: 'IN_PROGRESS' }),
            },
            {
              label: 'Submitted',
              value: counts.SUBMITTED.toString(),
              valueClassName:
                counts.SUBMITTED > 0
                  ? 'text-info-600 dark:text-info-400'
                  : 'text-app-fg',
              to: buildQuery({ onboarding: 'SUBMITTED' }),
            },
            {
              label: 'Approved',
              value: counts.APPROVED.toString(),
              valueClassName:
                counts.APPROVED > 0
                  ? 'text-success-600 dark:text-success-400'
                  : 'text-app-fg',
              to: buildQuery({ onboarding: 'APPROVED' }),
            },
          ]}
        />
      ) : null}

      <div className="list-panel">
        <ToolbarFiltersCollapsible
          className="!border-0 !px-0 md:!px-4"
          hideMobileSheet
          badgeCount={activeFilterCount}
          searchRow={
            <PageSearchControl
              value={searchParam}
              placeholder="Name or email…"
              title="Search staff"
              onApply={(query) => patchParams({ search: query || undefined })}
            />
          }
          desktopInlineFilters={
            <>
              <InlineFilter
                type="select"
                value={onboardingParam}
                defaultValue="ALL"
                onChange={(v) => patchParams({ onboarding: v === 'ALL' ? undefined : v })}
                options={[...ONBOARDING_OPTIONS]}
                width="status"
              />
              <InlineFilter
                type="select"
                value={payrollParam}
                defaultValue="ALL"
                onChange={(v) => patchParams({ payroll: v === 'ALL' ? undefined : v })}
                options={[...PAYROLL_OPTIONS]}
                width="status"
              />
              <InlineFilter
                type="select"
                value={sortByParam}
                defaultValue="name"
                onChange={(v) => patchParams({ sortBy: v })}
                options={[...SORT_OPTIONS]}
                width="sort"
              />
              <InlineFilter
                type="select"
                value={sortOrderParam}
                defaultValue="asc"
                onChange={(v) => patchParams({ sortOrder: v })}
                options={[
                  { value: 'asc', label: 'Ascending' },
                  { value: 'desc', label: 'Descending' },
                ]}
                width="sort"
              />
            </>
          }
        />

        <CompactTable<StaffOnboardingDocumentRow>
          columnVisibilityKey="hr.staff-onboarding"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.userId}
          loading={isFilterLoading}
          loadingVariant="overlay"
          withCard={false}
          emptyTitle="No staff match these filters"
          emptyDescription="Try clearing search or widening the onboarding / payroll filters."
          renderMobileCard={(row) => (
            <Link
              to={`/hr/users/${row.userId}/onboarding`}
              prefetch="intent"
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-app-fg leading-snug truncate">{row.name}</p>
                <StatusBadge status={row.onboardingStatus} size="sm" />
              </div>
              <p className="text-xs text-app-fg-muted">
                Payroll:{' '}
                <span className={row.payRoleId ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}>
                  {row.payRoleId ? 'Set up' : 'Not set up'}
                </span>
              </p>
            </Link>
          )}
          pagination={undefined}
        />
      </div>
    </div>
  );
}
