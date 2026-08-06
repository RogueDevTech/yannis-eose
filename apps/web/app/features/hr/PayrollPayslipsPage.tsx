import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { FormSelect } from '~/components/ui/form-select';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Pagination } from '~/components/ui/pagination';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { PayslipPreviewModal } from '~/components/ui/payslip-preview-modal';
import { downloadPayslipPdf, generatePayslipPdfBytes } from '~/lib/payslip-pdf';
import { createZipStoreBlob } from '~/lib/zip-store';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import type { PayslipListItem } from './payroll-prd-types';
import type { BranchOption } from './types';
import { formatRole } from '~/features/users/types';
import { DEPT_LABEL, batchScopeLabel } from './payroll-constants';
import { deductionLineLabel, payslipFilename, toPayslipPdfInput } from './payslip-mappers';

interface PayrollPayslipsPageProps {
  items: PayslipListItem[];
  page: number;
  limit: number;
  total: number;
  branches: BranchOption[];
  filters: {
    department?: string;
    branchId?: string;
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
    search?: string;
  };
}

function formatPeriod(month: string): string {
  const d = new Date(month);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

// One dropdown covers real departments plus the two org-wide batch scopes
// (Contractors / All staff & contractors), whose batches carry a NULL
// department. Scope values are prefixed "scope:" so the loader can route them to
// the scopeType filter instead of department.
const DEPARTMENT_OPTIONS = [
  { value: '', label: 'All departments & scopes' },
  ...Object.entries(DEPT_LABEL).map(([value, label]) => ({ value, label })),
  { value: 'scope:CONTRACTORS', label: 'Contractors' },
  { value: 'scope:ALL', label: 'All staff & contractors' },
];


export function PayrollPayslipsPage({ items, page, limit, total, branches, filters }: PayrollPayslipsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [viewingPayslip, setViewingPayslip] = useState<PayslipListItem | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const { toast } = useToast();

  const branchOptions = useMemo(
    () => [{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))],
    [branches],
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
          // Reset to page 1 when a non-page filter changes
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleDownload = useCallback(async (row: PayslipListItem) => {
    setDownloadingId(row.payout.id);
    try {
      await downloadPayslipPdf(toPayslipPdfInput(row), payslipFilename(row));
    } finally {
      setDownloadingId(null);
    }
  }, []);

  /**
   * Bulk-download every payslip matching the current filters (department /
   * branch / period / search) as a single ZIP of individual PDFs. Fetches the
   * full filtered set from the loader's export mode, then builds + zips client
   * side (same jsPDF builder as the per-row download).
   */
  const handleBulkDownload = useCallback(async () => {
    setBulkDownloading(true);
    try {
      const params = new URLSearchParams(searchParams);
      params.set('export', '1');
      params.delete('page');
      const res = await fetch(`?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to load payslips');
      const data = (await res.json()) as { items: PayslipListItem[]; total: number };
      if (!data.items.length) {
        toast.info('No payslips', 'Nothing matches the current filters.');
        return;
      }

      const seen = new Map<string, number>();
      const files: Array<{ name: string; data: Uint8Array }> = [];
      for (const row of data.items) {
        const bytes = await generatePayslipPdfBytes(toPayslipPdfInput(row));
        // Guard against duplicate filenames within the zip.
        let name = payslipFilename(row);
        const count = seen.get(name) ?? 0;
        seen.set(name, count + 1);
        if (count > 0) name = name.replace(/\.pdf$/i, `-${count + 1}.pdf`);
        files.push({ name, data: bytes });
      }

      const zip = createZipStoreBlob(files);
      const url = URL.createObjectURL(zip);
      const a = document.createElement('a');
      const scope = filters.department || (filters.branchId ? 'branch' : 'all');
      a.href = url;
      a.download = `payslips-${scope}-${filters.startDate}_to_${filters.endDate}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Payslips downloaded', `${files.length} payslip${files.length === 1 ? '' : 's'} zipped.`);
    } catch (err) {
      toast.error('Download failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBulkDownloading(false);
    }
  }, [searchParams, filters.department, filters.branchId, filters.startDate, filters.endDate, toast]);

  const columns: CompactTableColumn<PayslipListItem>[] = useMemo(
    () => [
      {
        key: 'staff',
        header: 'Employee',
        hideable: false,
        render: (row) => (
          <span className="font-medium text-app-fg">{row.staffName ?? 'Unknown'}</span>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">
            {row.staffRole
              ? formatRole(row.staffRole)
              : row.payout.payRoleName?.trim() || 'N/A'}
          </span>
        ),
      },
      {
        key: 'department',
        header: 'Dept',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">{batchScopeLabel(row.batch.department)}</span>
        ),
      },
      {
        key: 'period',
        header: 'Period',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">{formatPeriod(row.batch.periodMonth)}</span>
        ),
      },
      {
        key: 'gross',
        header: 'Gross',
        align: 'right',
        render: (row) => <NairaPrice amount={Number(row.payout.grossPay)} />,
      },
      {
        key: 'net',
        header: 'Net pay',
        align: 'right',
        render: (row) => (
          <span className="font-semibold text-app-fg">
            <NairaPrice amount={Number(row.payout.netPay)} />
          </span>
        ),
      },
      {
        key: 'deductions',
        header: 'Deductions',
        render: (row) => {
          const lines = (row.deductionLines ?? []).filter((d) => Number(d.amount) > 0);
          if (lines.length === 0) return <span className="text-app-fg-muted">{'—'}</span>;
          return (
            <div className="space-y-0.5">
              {lines.map((d, i) => (
                <div key={`${d.category}-${i}`} className="flex items-baseline gap-2 text-xs">
                  <span className="text-app-fg-muted truncate max-w-[16rem]" title={deductionLineLabel(d.category, d.reason)}>
                    {deductionLineLabel(d.category, d.reason)}
                  </span>
                  <span className="text-danger-600 dark:text-danger-400 tabular-nums whitespace-nowrap">
                    {'−'}<NairaPrice amount={Number(d.amount)} />
                  </span>
                </div>
              ))}
            </div>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) => (
          <div className="flex items-center gap-1.5">
            <CompactTableActionButton onClick={() => setViewingPayslip(row)}>
              View
            </CompactTableActionButton>
            <CompactTableActionButton
              tone="brand"
              disabled={downloadingId === row.payout.id}
              onClick={() => void handleDownload(row)}
            >
              {downloadingId === row.payout.id ? 'Generating\u2026' : 'PDF'}
            </CompactTableActionButton>
          </div>
        ),
      },
    ],
    [downloadingId, handleDownload],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasActiveFilters = !!(filters.department || filters.branchId || filters.search || filters.startDate || filters.endDate);

  const totalNetPay = useMemo(
    () => items.reduce((sum, r) => sum + Number(r.payout.netPay), 0),
    [items],
  );

  const payslipStatStrip = useMemo(
    () => [
      { label: 'Payslips', value: total },
      {
        label: 'Total net pay',
        value: <NairaPrice amount={totalNetPay} />,
        plainValue: true,
      },
    ],
    [total, totalNetPay],
  );

  const viewingPdf = viewingPayslip ? toPayslipPdfInput(viewingPayslip) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payslips"
        mobileInlineActions
        description="Paid payout lines with downloadable PDF payslips."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="Payslips toolbar"
            filtersBadgeCount={[filters.department, filters.branchId].filter(Boolean).length}
            onClearFilters={
              filters.department || filters.branchId
                ? () => {
                    setSearchParams(
                      (prev) => {
                        const next = new URLSearchParams(prev);
                        next.delete('department');
                        next.delete('branchId');
                        next.delete('page');
                        return next;
                      },
                      { replace: true },
                    );
                  }
                : undefined
            }
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={bulkDownloading}
                  loadingText="Zipping…"
                  disabled={total === 0}
                  onClick={() => void handleBulkDownload()}
                >
                  Download all ({total})
                </Button>
              </div>
            }
            filters={
              <div className="space-y-3">
                <FormSelect
                  label="Department"
                  name="department"
                  options={DEPARTMENT_OPTIONS}
                  value={filters.department ?? ''}
                  onChange={(e) => setFilter('department', e.target.value)}
                />
                {branches.length > 1 && (
                  <FormSelect
                    label="Branch"
                    name="branchId"
                    options={branchOptions}
                    value={filters.branchId ?? ''}
                    onChange={(e) => setFilter('branchId', e.target.value)}
                  />
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  loading={bulkDownloading}
                  loadingText="Zipping…"
                  disabled={total === 0}
                  onClick={() => void handleBulkDownload()}
                >
                  Download all ({total})
                </Button>
              </div>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <OverviewStatStrip items={payslipStatStrip} />

      <ToolbarFiltersCollapsible
        hideMobileSheet
        badgeCount={[filters.department, filters.branchId].filter(Boolean).length}
        searchRow={
          <PageSearchControl
            value={filters.search ?? ''}
            placeholder="Search by name"
            title="Search payslips"
            onApply={(query) => setFilter('search', query)}
          />
        }
        desktopInlineFilters={
          <>
            <FormSelect
              label=""
              name="department"
              options={DEPARTMENT_OPTIONS}
              value={filters.department ?? ''}
              onChange={(e) => setFilter('department', e.target.value)}
              className="w-44"
            />
            {branches.length > 1 && (
              <FormSelect
                label=""
                name="branchId"
                options={branchOptions}
                value={filters.branchId ?? ''}
                onChange={(e) => setFilter('branchId', e.target.value)}
                className="w-44"
              />
            )}
          </>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? 'No matching payslips' : 'No payslips yet'}
          description={
            hasActiveFilters
              ? 'Try adjusting your filters.'
              : 'Payslips appear after Finance marks payroll batches as paid.'
          }
        />
      ) : (
        <>
          <CompactTable<PayslipListItem>
            columnVisibilityKey="hr.payroll.payslips"
            columns={columns}
            rows={items}
            rowKey={(r) => r.payout.id}
            emptyTitle="No payslips"
            emptyDescription=""
            renderMobileCard={(row) => (
              <button
                type="button"
                onClick={() => setViewingPayslip(row)}
                className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-app-fg leading-snug truncate">{row.staffName ?? 'Unknown'}</p>
                  <span className="shrink-0 text-sm font-semibold text-app-fg tabular-nums">
                    <NairaPrice amount={Number(row.payout.netPay)} />
                  </span>
                </div>
                <p className="text-xs text-app-fg-muted truncate">
                  {row.staffRole
                    ? formatRole(row.staffRole)
                    : row.payout.payRoleName?.trim() || 'N/A'}
                  {' \u00b7 '}
                  {batchScopeLabel(row.batch.department)}
                  {' \u00b7 '}
                  {formatPeriod(row.batch.periodMonth)}
                </p>
              </button>
            )}
          />

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-app-border pt-4">
            <p className="text-sm text-app-fg-muted">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
            </p>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={(p) => setFilter('page', String(p))}
            />
          </div>
        </>
      )}

      <PayslipPreviewModal
        payslip={viewingPdf}
        title={
          viewingPayslip
            ? `View · ${viewingPayslip.staffName ?? 'Payslip'} · ${formatPeriod(viewingPayslip.batch.periodMonth)}`
            : undefined
        }
        downloading={viewingPayslip != null && downloadingId === viewingPayslip.payout.id}
        onDownload={viewingPayslip ? () => void handleDownload(viewingPayslip) : undefined}
        onClose={() => setViewingPayslip(null)}
      />
    </div>
  );
}
