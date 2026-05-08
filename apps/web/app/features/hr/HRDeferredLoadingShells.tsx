import { Link } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { shellPulsePlaceholderRows, StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Tabs } from '~/components/ui/tabs';

function hrUsersShellColumns(staffAccounts: boolean): CompactTableColumn<{ id: string }>[] {
  if (staffAccounts) {
    return [
      { key: 'name', header: 'Name', render: () => <TableCellTextPulse className="w-[12rem]" /> },
      { key: 'acctName', header: 'Account name', render: () => <TableCellTextPulse className="w-[10rem]" /> },
      {
        key: 'acctNum',
        header: 'Account number',
        render: () => <TableCellTextPulse className="w-[9rem]" />,
      },
      { key: 'bank', header: 'Bank', render: () => <TableCellTextPulse className="w-[8rem]" /> },
      {
        key: 'bankCode',
        header: 'Bank code',
        render: () => <TableCellTextPulse className="w-[5rem]" />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
      },
    ];
  }
  return [
    { key: 'name', header: 'Name', render: () => <TableCellTextPulse className="w-[12rem]" /> },
    { key: 'email', header: 'Email', render: () => <TableCellTextPulse className="w-[14rem]" /> },
    { key: 'role', header: 'Role', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    { key: 'branches', header: 'Branches', render: () => <TableCellTextPulse className="w-[10rem]" /> },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[6rem]" /> },
    {
      key: 'joined',
      header: 'Joined',
      nowrap: true,
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

const ONBOARDING_DOCS_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'staff', header: 'Staff', render: () => <TableCellTextPulse className="w-[12rem]" /> },
  {
    key: 'onboarding',
    header: 'Onboarding',
    render: () => <TableCellTextPulse className="w-[8rem]" />,
  },
  {
    key: 'submitted',
    header: 'Submitted',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[9rem]" />,
  },
  {
    key: 'approved',
    header: 'Approved',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[9rem]" />,
  },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>Open</CompactTableActionButton>,
  },
];

const COMMISSION_PLANS_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'plan', header: 'Plan Name', render: () => <TableCellTextPulse className="w-[14rem]" /> },
  { key: 'role', header: 'Role', render: () => <TableCellTextPulse className="w-[8rem]" /> },
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[6rem]" /> },
  {
    key: 'effective',
    header: 'Effective',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[10rem]" />,
  },
  { key: 'rules', header: 'Rules', render: () => <TableCellTextPulse className="w-[8rem]" /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>Edit</CompactTableActionButton>,
  },
];

/** `/hr/payroll` */
export function MonthlyPayrollsLoadingShell() {
  const rows = shellPulsePlaceholderRows('payroll_batches', 8);
  const cols: CompactTableColumn<{ id: string }>[] = [
    { key: 'branch', header: 'Branch', render: () => <TableCellTextPulse className="w-[10rem]" /> },
    { key: 'dept', header: 'Department', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    { key: 'month', header: 'Month', render: () => <TableCellTextPulse className="w-[7rem]" /> },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: () => <CompactTableActionButton disabled>Open</CompactTableActionButton>,
    },
  ];
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="HR & Payroll"
        description="Monthly payroll batches and staff earnings adjustments. Commission plans and per-staff payouts live on their own pages."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <PageRefreshButton />
            <Button variant="primary" size="sm" disabled className="opacity-60">
              + Add-on
            </Button>
          </div>
        }
      />
      <Tabs
        value="monthly"
        onChange={() => {}}
        tabs={[
          { value: 'monthly', label: 'Monthly Payrolls' },
          { value: 'adjustments', label: 'Adjustments' },
        ]}
      />
      <CompactTable<{ id: string }>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** `/hr/payroll/generate` */
export function GeneratePayrollLoadingShell() {
  return (
    <div className="space-y-6 max-w-3xl" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Generate Monthly Payroll Batch"
        description="Auto-derives payouts from delivered orders and commission plans for the selected scope and month. Existing batches for that month are skipped; use Re-generate inside a draft batch to refresh a single slot."
        actions={
          <Link to="/hr/payroll" className="btn-ghost btn-sm shrink-0 opacity-60 pointer-events-none">
            ← Back to payroll
          </Link>
        }
      />
      <div className="card p-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-10 rounded-md bg-app-hover animate-pulse" aria-hidden />
          <div className="h-10 rounded-md bg-app-hover animate-pulse" aria-hidden />
        </div>
        <div className="h-10 rounded-md bg-app-hover animate-pulse max-w-xs" aria-hidden />
        <div className="h-10 w-40 rounded-md bg-app-hover animate-pulse" aria-hidden />
      </div>
    </div>
  );
}

/** `/hr/plans` */
export function CommissionPlansLoadingShell() {
  const rows = shellPulsePlaceholderRows('comm_plans', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Commission Plans"
        description="Define base pay, per-order rules, tiered rates, and accelerators. Role is optional — leave it blank for templates you attach to individual staff profiles."
        actions={
          <>
            <PageRefreshButton />
            <Button variant="primary" size="sm" disabled className="opacity-60">
              + New Commission Plan
            </Button>
          </>
        }
      />
      <CompactTable<{ id: string }>
        columns={COMMISSION_PLANS_SHELL_COLS}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** `/hr/users` and finance staff-accounts list */
export function HRUsersListLoadingShell({ staffAccounts = false }: { staffAccounts?: boolean }) {
  const rows = shellPulsePlaceholderRows('hr_users', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title={staffAccounts ? 'Staff accounts' : 'Users'}
        description={
          staffAccounts
            ? 'Staff names and payout bank details (account name, number, bank code) for disbursement.'
            : 'Manage team members and their roles'
        }
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <Button variant="primary" size="sm" disabled className="opacity-60">
              {staffAccounts ? 'Add staff' : 'Add User'}
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap gap-2">
        <div className="h-9 w-28 rounded-md bg-app-hover animate-pulse" aria-hidden />
        <div className="h-9 w-28 rounded-md bg-app-hover animate-pulse" aria-hidden />
      </div>
      <CompactTable<{ id: string }>
        columns={hrUsersShellColumns(staffAccounts)}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** `/hr/users/new` and edit — multi-section form */
export function UserCreateEditLoadingShell({ mode }: { mode: 'create' | 'edit' }) {
  return (
    <div className="space-y-6 max-w-4xl" aria-busy="true" aria-live="polite">
      <PageHeader
        title={mode === 'edit' ? 'Edit user' : 'Add User'}
        description={mode === 'edit' ? 'Update profile, role, and permissions.' : 'Create a new staff account with role, branch, and compensation.'}
        actions={<PageRefreshButton />}
      />
      <div className="space-y-4">
        {[1, 2, 3, 4].map((section) => (
          <div key={section} className="card p-4 space-y-3">
            <div className="h-5 w-40 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-10 w-full max-w-md rounded-md bg-app-hover animate-pulse" aria-hidden />
            <div className="h-10 w-full max-w-md rounded-md bg-app-hover animate-pulse" aria-hidden />
          </div>
        ))}
      </div>
    </div>
  );
}

/** `/hr/users/:id/onboarding` (HR review mode) */
export function UserOnboardingLoadingShell() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Onboarding"
        description="Review the packet below (documents open in a new tab). Staff edit from Your onboarding; approve here once verification is complete."
        actions={
          <div className="flex gap-2 items-center">
            <div className="h-6 w-20 rounded-full bg-app-hover animate-pulse" aria-hidden />
            <PageRefreshButton />
          </div>
        }
      />
      <div className="card p-4 space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 rounded bg-app-hover animate-pulse" aria-hidden />
        ))}
      </div>
    </div>
  );
}

/** `/hr/staff-onboarding-documents` */
export function StaffOnboardingDocsLoadingShell() {
  const rows = shellPulsePlaceholderRows('onb_docs', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Staff onboarding documents"
        description="Status of staff HR documents — open a row to review or edit in the full onboarding flow."
        actions={<PageRefreshButton />}
      />
      <OverviewStatStrip
        items={[
          { label: 'Total', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Not started', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'In progress', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Submitted', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Approved', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div className="card p-0 overflow-hidden">
        <div className="p-3 border-b border-app-border flex gap-2">
          <div className="h-9 flex-1 rounded-md bg-app-hover animate-pulse" aria-hidden />
          <div className="h-9 w-24 rounded-md bg-app-hover animate-pulse" aria-hidden />
        </div>
        <CompactTable<{ id: string }>
          withCard={false}
          columns={ONBOARDING_DOCS_SHELL_COLS}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}
