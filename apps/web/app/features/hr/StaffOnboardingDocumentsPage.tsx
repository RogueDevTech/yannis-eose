import { Link, useSearchParams } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { TableActionButton } from '~/components/ui/table-action-button';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
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
  sortByParam,
  sortOrderParam,
  searchParam,
  counts,
}: StaffOnboardingDocumentsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isFilterLoading = useLoaderRefetchBusy().busy;

  const [searchDraft, setSearchDraft] = useState(searchParam);
  useEffect(() => {
    setSearchDraft(searchParam);
  }, [searchParam]);

  const patchParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    next.set('page', '1');
    setSearchParams(next, { replace: true });
  };

  const columns: CompactTableColumn<StaffOnboardingDocumentRow>[] = [
    {
      key: 'name',
      header: 'Staff',
      render: (row) => (
        <div className="min-w-0">
          <Link
            to={`/hr/users/${row.userId}`}
            prefetch="intent"
            className="font-medium text-app-fg truncate hover:text-brand-600 dark:hover:text-brand-400 hover:underline underline-offset-2"
          >
            {row.name}
          </Link>
        </div>
      ),
    },
    {
      key: 'onboardingStatus',
      header: 'Onboarding',
      render: (row) => (
        <StatusBadge status={row.onboardingStatus} showDot size="sm" />
      ),
    },
    {
      key: 'submittedAt',
      header: 'Submitted',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs text-app-muted whitespace-nowrap">{formatTs(row.submittedAt)}</span>
      ),
    },
    {
      key: 'approvedAt',
      header: 'Approved',
      hideOnMobile: true,
      render: (row) => (
        <span className="text-xs text-app-muted whitespace-nowrap">{formatTs(row.approvedAt)}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      className: 'w-[1%]',
      render: (row) => (
        <TableActionButton to={`/hr/users/${row.userId}/onboarding`} variant="primary">
          Open
        </TableActionButton>
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
          <>
            <PageRefreshButton className="hidden md:inline-flex" />
            <PageRefreshButton iconOnly className="md:hidden" />
          </>
        }
      />

      {counts ? (
        <OverviewStatStrip
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
            },
            {
              label: 'In progress',
              value: counts.IN_PROGRESS.toString(),
              valueClassName:
                counts.IN_PROGRESS > 0
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-app-fg',
            },
            {
              label: 'Submitted',
              value: counts.SUBMITTED.toString(),
              valueClassName:
                counts.SUBMITTED > 0
                  ? 'text-info-600 dark:text-info-400'
                  : 'text-app-fg',
            },
            {
              label: 'Approved',
              value: counts.APPROVED.toString(),
              valueClassName:
                counts.APPROVED > 0
                  ? 'text-success-600 dark:text-success-400'
                  : 'text-app-fg',
            },
          ]}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs font-medium text-app-muted mb-1">Search</label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              patchParams({ search: searchDraft.trim() || undefined });
            }}
          >
            <SearchInput
              placeholder="Name or email…"
              value={searchDraft}
              onChange={(q) => {
                setSearchDraft(q);
                if (q.trim() === '') patchParams({ search: undefined });
              }}
              withSubmitButton
              wrapperClassName="w-full"
            />
          </form>
        </div>
        <div className="w-full sm:w-52">
          <label className="block text-xs font-medium text-app-muted mb-1">Onboarding</label>
          <FormSelect
            value={onboardingParam}
            onChange={(e) =>
              patchParams({ onboarding: e.target.value === 'ALL' ? undefined : e.target.value })
            }
            options={[...ONBOARDING_OPTIONS]}
          />
        </div>
        <div className="w-full sm:w-52">
          <label className="block text-xs font-medium text-app-muted mb-1">Sort</label>
          <FormSelect
            value={sortByParam}
            onChange={(e) => patchParams({ sortBy: e.target.value })}
            options={[...SORT_OPTIONS]}
          />
        </div>
        <div className="w-full sm:w-36">
          <label className="block text-xs font-medium text-app-muted mb-1">Order</label>
          <FormSelect
            value={sortOrderParam}
            onChange={(e) => patchParams({ sortOrder: e.target.value })}
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
          />
        </div>
      </div>

      <CompactTable<StaffOnboardingDocumentRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.userId}
        loading={isFilterLoading}
        loadingVariant="overlay"
        caption="Staff onboarding document status"
        emptyTitle="No staff match these filters"
        emptyDescription="Try clearing search or widening the onboarding status filter."
        withCard={false}
        pagination={
          totalCount > 0
            ? {
                page,
                totalPages,
                showWhenSinglePage: true,
                summary: (
                  <p className="text-sm text-app-fg-muted">
                    Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalCount)} of {totalCount}
                    <span className="text-app-fg-muted/90"> · {pageSize} per page</span>
                  </p>
                ),
                wrapperClassName:
                  'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-app-border pt-4',
                controlsClassName: 'sm:justify-end',
              }
            : undefined
        }
      />
    </div>
  );
}
