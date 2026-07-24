import { useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { RoleBadge } from '~/components/ui/role-badge';
import { StatusBadge } from '~/components/ui/status-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { exportToCsv } from '~/lib/csv-export';
import type { PayrollRegisterRow } from './payroll-prd-types';

interface PayrollReportsPageProps {
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
    fromMonth: string;
    toMonth: string;
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
  const [fromMonth, setFromMonth] = useState(filters.fromMonth);
  const [toMonth, setToMonth] = useState(filters.toMonth);
  const [status, setStatus] = useState(filters.status);
  const [department, setDepartment] = useState(filters.department);
  const [branchId, setBranchId] = useState(filters.branchId);

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

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (fromMonth) params.set('fromMonth', fromMonth.length === 7 ? `${fromMonth}-01` : fromMonth);
    if (toMonth) params.set('toMonth', toMonth.length === 7 ? `${toMonth}-01` : toMonth);
    if (status && status !== 'ALL') params.set('status', status);
    if (department) params.set('department', department);
    if (branchId) params.set('branchId', branchId);
    setSearchParams(params);
  };

  const activeFilterCount = [fromMonth, toMonth, status !== 'ALL' ? status : '', department, branchId].filter(Boolean).length;

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
        render: (row) => row.staffRole ? <RoleBadge role={row.staffRole} size="sm" /> : <span className="text-sm text-app-fg-muted">—</span>,
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
        render: (row) => <span className="text-xs text-app-fg-muted">{row.batch.department}</span>,
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
    ],
    [],
  );

  const handleExport = () => {
    const csvRows = rows.map((row) => ({
      employee: row.staffName ?? '',
      role: row.staffRole ?? '',
      period: row.batch.periodMonth,
      department: row.batch.department,
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

  const filterFields = (
    <>
      <TextInput
        label="From month"
        type="month"
        value={fromMonth.slice(0, 7)}
        onChange={(e) => setFromMonth(e.target.value ? `${e.target.value}-01` : '')}
      />
      <TextInput
        label="To month"
        type="month"
        value={toMonth.slice(0, 7)}
        onChange={(e) => setToMonth(e.target.value ? `${e.target.value}-01` : '')}
      />
      <FormSelect
        label="Batch status"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        options={STATUS_OPTIONS}
        className="sm:w-44"
      />
      <FormSelect
        label="Department"
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
        options={DEPARTMENT_OPTIONS}
        className="sm:w-44"
      />
      {branches.length > 1 && (
        <FormSelect
          label="Branch"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          options={branchOptions}
          className="sm:w-44"
        />
      )}
    </>
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
            desktop={
              <>
                <PageRefreshButton />
                <Button variant="secondary" size="sm" onClick={handleExport} disabled={!rows.length}>
                  Export CSV
                </Button>
              </>
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

      <ToolbarFiltersCollapsible
        badgeCount={activeFilterCount}
        desktopInlineFilters={
          <>
            {filterFields}
            <div className="flex items-end">
              <Button type="button" variant="primary" size="sm" onClick={applyFilters}>
                Apply filters
              </Button>
            </div>
          </>
        }
        sheetFilterBody={
          <div className="space-y-3">
            {filterFields}
            <Button type="button" variant="primary" size="sm" className="w-full justify-center h-12" onClick={applyFilters}>
              Apply filters
            </Button>
          </div>
        }
      />

      <OverviewStatStrip
        mobileGrid
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
