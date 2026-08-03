import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { InlineFilter } from '~/components/ui/inline-filter';
import { FormSelect } from '~/components/ui/form-select';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { RoleBadge } from '~/components/ui/role-badge';
import { StatusBadge } from '~/components/ui/status-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { exportToCsv } from '~/lib/csv-export';
import type { PayrollRegisterRow } from './payroll-prd-types';
import { batchScopeLabel } from './payroll-constants';

export interface PayrollReportsPageProps {
  rows: PayrollRegisterRow[];
  costByBranch: Array<{
    branchId: string;
    branchName: string;
    totalGross: number;
    totalTax: number;
    totalNet: number;
    batchCount: number;
  }>;
  costByRole: Array<{ category: string; totalGross: number; totalNet: number; headcount: number }>;
  trend: Array<{
    periodMonth: string;
    totalGross: number;
    totalTax: number;
    totalNet: number;
    staffCount: number;
  }>;
  branches: Array<{ id: string; name: string }>;
  filters: {
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
    status: string;
    department: string;
    branchId: string;
  };
}

function formatMonth(month: string): string {
  const d = new Date(month);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'short', year: 'numeric' });
}

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_HR', label: 'Pending HR' },
  { value: 'PENDING_FINANCE', label: 'Pending Finance' },
  { value: 'PAID', label: 'Paid' },
];

const DEPARTMENT_OPTIONS = [
  { value: '', label: 'All departments' },
  { value: 'CS', label: 'CS' },
  { value: 'MARKETING', label: 'Marketing' },
  { value: 'LOGISTICS', label: 'Logistics' },
  { value: 'HR', label: 'HR' },
  { value: 'OPERATIONS', label: 'Operations' },
];

export function PayrollReportsPage({ rows, costByBranch, costByRole, trend, branches, filters }: PayrollReportsPageProps) {
  const [, setSearchParams] = useSearchParams();

  const status = filters.status || 'ALL';
  const department = filters.department || '';
  const branchId = filters.branchId || '';

  const branchOptions = useMemo(
    () => [{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: b.name }))],
    [branches],
  );

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const gross = Number(row.payout.grossPay) || Number(row.payout.totalPayout);
        const net = Number(row.payout.netPay) || Number(row.payout.totalPayout);
        acc.gross += gross;
        acc.paye += Number(row.payout.payeTax);
        acc.net += net;
        return acc;
      },
      { gross: 0, paye: 0, net: 0 },
    );
  }, [rows]);

  const setFilter = useCallback(
    (key: 'status' | 'department' | 'branchId', value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          // Drop legacy month params if present.
          next.delete('fromMonth');
          next.delete('toMonth');
          if (!value || (key === 'status' && value === 'ALL')) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('status');
        next.delete('department');
        next.delete('branchId');
        next.delete('fromMonth');
        next.delete('toMonth');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const activeFilterCount = [status !== 'ALL' ? status : '', department, branchId].filter(Boolean).length;

  const columns: CompactTableColumn<PayrollRegisterRow>[] = useMemo(
    () => [
      {
        key: 'staff',
        header: 'Employee',
        hideable: false,
        render: (row) => (
          <span className="font-medium text-app-fg">{row.staffName ?? 'Contractor / unknown'}</span>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        nowrap: true,
        render: (row) => row.staffRole ? <RoleBadge role={row.staffRole} size="sm" /> : <span className="text-sm text-app-fg-muted">N/A</span>,
      },
      {
        key: 'period',
        header: 'Period',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">{formatMonth(row.batch.periodMonth)}</span>
        ),
      },
      {
        key: 'dept',
        header: 'Dept',
        render: (row) => <span className="text-xs text-app-fg-muted">{batchScopeLabel(row.batch.department)}</span>,
      },
      {
        key: 'gross',
        header: 'Gross',
        align: 'right',
        render: (row) => (
          <NairaPrice amount={Number(row.payout.grossPay) || Number(row.payout.totalPayout)} />
        ),
      },
      {
        key: 'paye',
        header: 'PAYE',
        align: 'right',
        render: (row) => <NairaPrice amount={Number(row.payout.payeTax)} />,
      },
      {
        key: 'net',
        header: 'Net',
        align: 'right',
        render: (row) => (
          <span className="font-semibold">
            <NairaPrice amount={Number(row.payout.netPay) || Number(row.payout.totalPayout)} />
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Batch',
        render: (row) => <StatusBadge status={row.batch.status} />,
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) => (
          <CompactTableActionButton to={`/hr/payroll-batch/${row.batch.id}`}>
            View
          </CompactTableActionButton>
        ),
      },
    ],
    [],
  );

  const handleExport = () => {
    const csvRows = rows.map((row) => ({
      employee: row.staffName ?? '',
      role: row.staffRole ?? '',
      period: row.batch.periodMonth,
      department: batchScopeLabel(row.batch.department),
      batchStatus: row.batch.status,
      baseSalary: row.payout.baseSalary,
      performanceBonus: row.payout.performanceBonus,
      allowances: row.payout.allowancesTotal,
      grossPay: row.payout.grossPay,
      payeTax: row.payout.payeTax,
      netPay: row.payout.netPay,
      payRole: row.payout.payRoleName ?? '',
    }));
    exportToCsv(
      csvRows,
      [
        { key: 'employee', label: 'Employee' },
        { key: 'role', label: 'Role' },
        { key: 'period', label: 'Period month' },
        { key: 'department', label: 'Department' },
        { key: 'batchStatus', label: 'Batch status' },
        { key: 'baseSalary', label: 'Base salary' },
        { key: 'performanceBonus', label: 'Performance bonus' },
        { key: 'allowances', label: 'Allowances' },
        { key: 'grossPay', label: 'Gross pay' },
        { key: 'payeTax', label: 'PAYE tax' },
        { key: 'netPay', label: 'Net pay' },
        { key: 'payRole', label: 'Pay role' },
      ],
      `payroll-register-${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const sheetFilters = (
    <div className="space-y-3">
      <FormSelect
        label="Batch status"
        value={status}
        onChange={(e) => setFilter('status', e.target.value)}
        options={STATUS_OPTIONS}
      />
      <FormSelect
        label="Department"
        value={department}
        onChange={(e) => setFilter('department', e.target.value)}
        options={DEPARTMENT_OPTIONS}
      />
      {branches.length > 1 ? (
        <FormSelect
          label="Branch"
          value={branchId}
          onChange={(e) => setFilter('branchId', e.target.value)}
          options={branchOptions}
        />
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll register"
        mobileInlineActions
        description="Exportable payroll register across paid and in-flight batches."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Payroll reports toolbar"
            filtersBadgeCount={activeFilterCount}
            onClearFilters={activeFilterCount > 0 ? clearAllFilters : undefined}
            filters={sheetFilters}
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                <Button variant="secondary" size="sm" onClick={handleExport} disabled={!rows.length}>
                  Export CSV
                </Button>
              </div>
            }
            sheet={({ closeSheet }) => (
              <Button
                variant="secondary"
                size="sm"
                className="h-12 w-full justify-center"
                disabled={!rows.length}
                onClick={() => {
                  closeSheet();
                  handleExport();
                }}
              >
                Export CSV
              </Button>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <OverviewStatStrip
        items={[
          { label: 'Rows', value: rows.length },
          { label: 'Total gross', value: <NairaPrice amount={totals.gross} /> },
          { label: 'Total PAYE', value: <NairaPrice amount={totals.paye} /> },
          { label: 'Total net', value: <NairaPrice amount={totals.net} /> },
        ]}
      />

      {(costByBranch.length > 0 || costByRole.length > 0 || trend.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <AnalyticsCard title="Cost by branch">
            {costByBranch.length === 0 ? (
              <p className="text-xs text-app-fg-muted">No branch totals in range.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {costByBranch.slice(0, 8).map((row) => (
                  <li key={row.branchId} className="flex justify-between gap-2">
                    <span className="text-app-fg truncate">{row.branchName}</span>
                    <NairaPrice amount={row.totalNet} />
                  </li>
                ))}
              </ul>
            )}
          </AnalyticsCard>
          <AnalyticsCard title="Cost by role category">
            {costByRole.length === 0 ? (
              <p className="text-xs text-app-fg-muted">No role breakdown in range.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {costByRole.slice(0, 8).map((row) => (
                  <li key={row.category} className="flex justify-between gap-2">
                    <span className="text-app-fg truncate">{row.category.replace(/_/g, ' ')}</span>
                    <NairaPrice amount={row.totalNet} />
                  </li>
                ))}
              </ul>
            )}
          </AnalyticsCard>
          <AnalyticsCard title="Payroll trend">
            {trend.length === 0 ? (
              <p className="text-xs text-app-fg-muted">No monthly trend in range.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {trend.slice(-6).map((row) => (
                  <li key={row.periodMonth} className="flex justify-between gap-2">
                    <span className="text-app-fg-muted">{formatMonth(row.periodMonth)}</span>
                    <NairaPrice amount={row.totalNet} />
                  </li>
                ))}
              </ul>
            )}
          </AnalyticsCard>
        </div>
      )}

      <div className="list-panel">
      <ToolbarFiltersCollapsible
        className="!border-0"
        hideMobileSheet
        badgeCount={activeFilterCount}
        onClearAll={activeFilterCount > 0 ? clearAllFilters : undefined}
        desktopInlineFilters={
          <>
            <InlineFilter
              type="select"
              value={status}
              defaultValue="ALL"
              onChange={(v) => setFilter('status', v)}
              options={STATUS_OPTIONS}
              width="status"
            />
            <InlineFilter
              type="select"
              value={department}
              defaultValue=""
              onChange={(v) => setFilter('department', v)}
              options={DEPARTMENT_OPTIONS}
              width="department"
            />
            {branches.length > 1 ? (
              <InlineFilter
                type="select"
                value={branchId}
                defaultValue=""
                onChange={(v) => setFilter('branchId', v)}
                options={branchOptions}
                width="branch"
              />
            ) : null}
          </>
        }
        sheetFilterBody={sheetFilters}
      />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No register rows"
          description="Adjust the month range or batch status filter, or generate payroll batches first."
        />
      ) : (
        <div className="list-panel">
          <CompactTable<PayrollRegisterRow>
            withCard={false}
            columnVisibilityKey="hr.payroll.reports"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.payout.id}
            emptyTitle="No rows"
            emptyDescription=""
            renderMobileCard={(row) => (
              <Link
                to={`/hr/payroll-batch/${row.batch.id}`}
                className="block p-4 space-y-3 hover:bg-app-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-app-fg text-sm truncate">
                      {row.staffName ?? 'Contractor / unknown'}
                    </p>
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      {formatMonth(row.batch.periodMonth)} · {batchScopeLabel(row.batch.department)}
                    </p>
                  </div>
                  <StatusBadge status={row.batch.status} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-app-fg-muted">Net</span>
                  <span className="font-semibold text-app-fg">
                    <NairaPrice amount={Number(row.payout.netPay) || Number(row.payout.totalPayout)} />
                  </span>
                </div>
              </Link>
            )}
          />
        </div>
      )}
    </div>
  );
}

function AnalyticsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-app-fg mb-3">{title}</h3>
      {children}
    </div>
  );
}
