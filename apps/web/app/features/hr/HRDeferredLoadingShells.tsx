import { Link } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { shellPulsePlaceholderRows, StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Tabs } from '~/components/ui/tabs';

export function hrUsersShellColumns(staffAccounts: boolean): CompactTableColumn<{ id: string }>[] {
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
        mobileInlineActions
        description="Run monthly payroll and manage staff adjustments."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="HR toolbar"
            desktop={
              <div className="flex items-center gap-2 flex-wrap">
                <PageRefreshButton />
                <Button variant="primary" size="sm" disabled className="opacity-60">
                  + Add-on
                </Button>
              </div>
            }
            sheet={<Button variant="primary" size="sm" className="h-12 w-full justify-center" disabled>+ Add-on</Button>}
          />
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
        title="Generate Payroll Batch"
        mobileInlineActions
        description="Generate payroll for a selected month and scope."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Payroll generator toolbar"
            showMobileRefresh={false}
            desktop={
              <Link to="/hr/payroll" className="btn-ghost btn-sm shrink-0 opacity-60 pointer-events-none">
                ← Back to payroll
              </Link>
            }
            sheet={
              <span
                className="inline-block h-9 w-full rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse"
                aria-hidden
              />
            }
          />
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
        mobileInlineActions
        description="Set base pay and commission rules for roles or staff."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Commission plan toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button variant="primary" size="sm" disabled className="opacity-60">
                  + New Commission Plan
                </Button>
              </>
            }
            sheet={<Button variant="primary" size="sm" className="h-12 w-full justify-center" disabled>+ New Commission Plan</Button>}
          />
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
        title={staffAccounts ? 'Staff Accounts' : 'Users'}
        mobileInlineActions
        description={
          staffAccounts
            ? 'Review staff payout details.'
            : 'Manage team members and roles.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Filters and actions"
            desktop={
              <>
                <PageRefreshButton />
                <Button variant="primary" size="sm" disabled className="opacity-60">
                  {staffAccounts ? 'Export' : '+ Add User'}
                </Button>
              </>
            }
            sheet={
              <Button variant="primary" size="sm" className="h-12 w-full justify-center" disabled>
                {staffAccounts ? 'Export' : '+ Add User'}
              </Button>
            }
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        tileClassName="min-w-[6.5rem]"
        items={
          staffAccounts
            ? [
                { label: 'Total matching', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Page', value: <StatValuePulse className="min-w-[2rem]" /> },
              ]
            : [
                { label: 'Total Users', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Active', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Pending', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Inactive / Archived', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Roles', value: <StatValuePulse className="min-w-[2rem]" /> },
              ]
        }
      />

      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {staffAccounts ? (
          /* Staff accounts: avatar + name + role, bank + account number */
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-app-hover animate-pulse shrink-0" />
                  <div className="h-4 w-28 rounded bg-app-hover animate-pulse" />
                </div>
                <div className="h-4 w-16 rounded bg-app-hover animate-pulse" />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
                <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
              </div>
            </div>
          ))
        ) : (
          /* HR users: avatar + name + status, role badges, email */
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card px-3 py-2.5 space-y-1.5">
              {/* Row 1: avatar + name + status */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-app-hover animate-pulse shrink-0" />
                  <div className="h-4 w-28 rounded bg-app-hover animate-pulse" />
                </div>
                <div className="h-5 w-14 rounded-full bg-app-hover animate-pulse" />
              </div>
              {/* Row 2: role badge */}
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-20 rounded bg-app-hover animate-pulse" />
              </div>
              {/* Row 3: email */}
              <div className="h-3 w-36 rounded bg-app-hover animate-pulse" />
            </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <CompactTable<{ id: string }>
          columns={hrUsersShellColumns(staffAccounts)}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}

/** `/hr/users/new` and edit — multi-section form */
/**
 * App Shell pattern — every static element of the form (page header,
 * breadcrumb, section headings, field labels, hints, action buttons) renders
 * for real. ONLY the input values + the avatar initials + the role-options
 * radio cards are skeleton pulses, so the user sees the actual full-width
 * page outline while `editingUser` and the 8 picklists are in flight.
 */
export function UserCreateEditLoadingShell({ mode }: { mode: 'create' | 'edit' }) {
  const inputPulse = (
    <div
      className="h-10 w-full rounded-md border border-app-border bg-app-hover/40 animate-pulse"
      aria-hidden
    />
  );
  const labelClass = 'block text-sm font-medium text-app-fg-muted mb-1.5';
  const sectionClass = 'card space-y-4';
  const sectionHeading = 'text-lg font-semibold text-app-fg';
  return (
    <div className="w-full space-y-6" aria-busy="true" aria-live="polite">
      <Breadcrumb
        items={
          mode === 'edit'
            ? [{ label: 'Users', to: '/hr/users' }, { label: 'Edit' }]
            : [{ label: 'Users', to: '/hr/users' }, { label: 'Add User' }]
        }
      />
      <PageHeader
        title={mode === 'edit' ? 'Edit user' : 'Add User'}
        description={
          mode === 'edit'
            ? 'Update account, branch memberships, permissions, and role settings.'
            : 'Create a new account for a team member with role-specific settings.'
        }
      />

      {/* Section 1: Account Details — full width card, role + name + email + branches */}
      <div className={sectionClass}>
        <div className="flex flex-col-reverse sm:flex-row sm:items-start sm:justify-between gap-4">
          <h2 className={`${sectionHeading} shrink-0`}>Account Details</h2>
          {/* Avatar gradient + initials placeholder — real ring chrome */}
          <div
            className="sm:mt-0 w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-app-hover ring-2 ring-app-border flex items-center justify-center shadow-md flex-shrink-0 self-start sm:self-auto animate-pulse"
            aria-hidden
          />
        </div>
        <p className="text-xs text-app-fg-muted -mt-2 sm:-mt-1">
          Initials preview from the full name and role (same style as the user profile header).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Role — full width */}
          <div className="sm:col-span-2 space-y-1.5">
            <label className={labelClass}>Role *</label>
            {inputPulse}
          </div>

          {/* Permission matrix preview block — real card frame, pulses inside */}
          <div className="sm:col-span-2">
            <div className="rounded-lg border border-app-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-app-fg-muted uppercase tracking-wider">
                  Effective permissions
                </span>
                <TableCellTextPulse className="h-3 w-16" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <span
                    key={i}
                    className="inline-flex items-center h-6 px-2.5 py-0.5 rounded-full bg-app-hover"
                    aria-hidden
                  >
                    <TableCellTextPulse className="h-3 w-20" />
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Full Name *</label>
            {inputPulse}
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Email Address *</label>
            {inputPulse}
            <p className="text-xs text-app-fg-muted">
              {mode === 'edit'
                ? 'Email changes require SuperAdmin approval before taking effect.'
                : 'A password will be auto-generated and sent to this email.'}
            </p>
          </div>

          {/* Branch memberships matrix — full width */}
          <div className="sm:col-span-2 space-y-3">
            <label className={labelClass}>Branch Memberships</label>
            <div className="border border-app-border rounded-lg overflow-hidden flex flex-col">
              {/* Real "Select all branches" row chrome */}
              <div className="flex items-center gap-3 px-3 py-2.5 bg-app-hover/70 border-b border-app-border">
                <span className="w-4 h-4 rounded bg-app-hover animate-pulse" aria-hidden />
                <span className="text-sm font-medium text-app-fg">Select all branches</span>
              </div>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 border-b border-app-border last:border-b-0"
                >
                  <span className="w-4 h-4 rounded bg-app-hover animate-pulse" aria-hidden />
                  <TableCellTextPulse className="w-[10rem] h-4" />
                  <TableCellTextPulse className="ml-auto w-[3rem] h-3" />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Primary Branch *</label>
              {inputPulse}
            </div>
          </div>

          {/* Status (edit only) */}
          {mode === 'edit' && (
            <div className="sm:col-span-2 space-y-1.5">
              <label className={labelClass}>Status</label>
              <div className="flex flex-wrap gap-2">
                {['Active', 'Inactive', 'Archived'].map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-app-border text-sm text-app-fg-muted"
                    aria-hidden
                  >
                    <span className="w-3.5 h-3.5 rounded-full border border-app-border" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Role Settings — capacity / logistics / products */}
      <div className={sectionClass}>
        <h2 className={sectionHeading}>Role Settings</h2>
        <p className="text-xs text-app-fg-muted">
          Capacity, logistics location, and product restrictions appear here based on the chosen role.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className={labelClass}>Order Capacity</label>
            {inputPulse}
            <p className="text-xs text-app-fg-muted">
              Maximum concurrent orders this agent can handle.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Logistics Location</label>
            {inputPulse}
          </div>
        </div>
      </div>

      {/* Section 3: Compensation */}
      <div className={sectionClass}>
        <h2 className={sectionHeading}>Compensation</h2>
        <p className="text-xs text-app-fg-muted">
          Either pick an existing commission plan or define a flat compensation inline.
        </p>
        {/* Mode toggle frame */}
        <div className="flex flex-wrap gap-2">
          {['Define compensation (flat)', 'Use existing plan'].map((label, i) => (
            <span
              key={label}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
                i === 0
                  ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-300'
                  : 'border-app-border text-app-fg-muted'
              }`}
              aria-hidden
            >
              <span className="w-3.5 h-3.5 rounded-full border border-current" />
              {label}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {['Fixed Salary (₦)', 'Bonus (₦)', 'Commission Type', 'Commission Value'].map((label) => (
            <div key={label} className="space-y-1.5">
              <label className={labelClass}>{label}</label>
              {inputPulse}
            </div>
          ))}
        </div>
      </div>

      {/* Section 4: Contact */}
      <div className={sectionClass}>
        <h2 className={sectionHeading}>Contact</h2>
        <div className="sm:w-1/2 space-y-1.5">
          <label className={labelClass}>
            WhatsApp / Phone Number {mode === 'edit' ? '' : '*'}
          </label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-app-border bg-app-hover/60 text-sm text-app-fg-muted">
              +234
            </span>
            <div className="h-10 w-full rounded-r-md border border-app-border bg-app-hover/40 animate-pulse" aria-hidden />
          </div>
        </div>
      </div>

      {/* Action buttons — visible chrome */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
        <span className="btn-secondary w-full sm:w-auto opacity-60 cursor-default" aria-hidden>
          Cancel
        </span>
        <span className="btn-primary w-full sm:w-auto opacity-60 cursor-default" aria-hidden>
          {mode === 'edit' ? 'Save changes' : 'Create user'}
        </span>
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
        description="Review the documents below and approve when ready."
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
        mobileInlineActions
        description="Review staff onboarding documents."
        actions={
          <>
            <PageRefreshButton className="hidden md:inline-flex" />
            <PageRefreshButton iconOnly className="md:hidden" />
          </>
        }
      />
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Not started', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'In progress', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Submitted', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Approved', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div className="list-panel">
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
