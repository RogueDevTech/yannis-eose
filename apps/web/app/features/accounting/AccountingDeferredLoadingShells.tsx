import type { ReactNode } from 'react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { StatValuePulse } from '~/components/ui/deferred-skeletons';
import { Tabs } from '~/components/ui/tabs';

type DateFilters = { startDate: string; endDate: string; periodAllTime: boolean };

function TablePulseRows({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-12 w-full rounded-md bg-app-hover/40 animate-pulse" aria-hidden />
      ))}
    </div>
  );
}

function AccountingChromeShell({
  title,
  description,
  filters,
  showSearch,
  searchPlaceholder,
  stats,
  children,
}: {
  title: string;
  description: string;
  filters?: DateFilters;
  showSearch?: boolean;
  searchPlaceholder?: string;
  stats?: Array<{ label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title={title}
        mobileInlineActions
        description={description}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel={`${title} toolbar`}
            saveFilterKey={Boolean(filters)}
            desktop={
              <>
                {filters ? (
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    chrome="pill"
                  />
                ) : null}
                <PageRefreshButton />
              </>
            }
            sheet={<PageRefreshButton />}
          />
        }
      />
      {stats && stats.length > 0 ? (
        <OverviewStatStrip
          items={stats.map((s) => ({
            label: s.label,
            value: <StatValuePulse className="min-w-[3.5rem]" />,
          }))}
        />
      ) : null}
      {showSearch ? (
        <PageSearchControl
          value=""
          onApply={() => {}}
          placeholder={searchPlaceholder ?? 'Search...'}
          title="Search"
        />
      ) : null}
      {children}
      <TablePulseRows />
    </div>
  );
}

export function ChartOfAccountsLoadingShell() {
  return (
    <AccountingChromeShell
      title="Account Config"
      description="Manage the chart of accounts and wire posting keys to the right GL accounts."
      showSearch
      searchPlaceholder="Search accounts..."
      stats={[{ label: 'Accounts' }, { label: 'Active' }, { label: 'Groups' }]}
    />
  );
}

export function JournalEntriesLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Journal Entries"
      description="Manual balanced postings to the general ledger."
      filters={filters}
      showSearch
      searchPlaceholder="Search journal entries..."
      stats={[{ label: 'Entries' }, { label: 'Posted' }]}
    />
  );
}

export function JournalEntryCreateLoadingShell() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="New Journal Entry"
        mobileInlineActions
        description="Post a balanced entry to the general ledger."
        actions={<PageRefreshButton />}
      />
      <div className="card p-4 space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 w-full rounded-md bg-app-hover/50 animate-pulse" aria-hidden />
        ))}
      </div>
    </div>
  );
}

export function TrialBalanceLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Trial Balance"
      description="Every account's net balance. Debits must equal credits."
      filters={filters}
      stats={[{ label: 'Total Debit' }, { label: 'Total Credit' }, { label: 'Accounts' }]}
    />
  );
}

export function ProfitAndLossLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Profit & Loss"
      description="Income less expenses over the period, straight from the ledger."
      filters={filters}
      stats={[{ label: 'Income' }, { label: 'Expenses' }, { label: 'Net' }]}
    />
  );
}

export function BalanceSheetLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Balance Sheet"
      description="Assets versus liabilities and equity, as of a date."
      filters={filters}
      stats={[{ label: 'Assets' }, { label: 'Liabilities' }, { label: 'Equity' }]}
    />
  );
}

export function CashFlowLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Cash Flow"
      description="Movement across bank and cash accounts over the period."
      filters={filters}
      stats={[{ label: 'Inflows' }, { label: 'Outflows' }, { label: 'Net' }]}
    />
  );
}

export function BudgetVsActualLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Budget vs Actual"
      description="Compare departmental budgets against GL expense postings."
      filters={filters}
      stats={[{ label: 'Budget' }, { label: 'Actual' }, { label: 'Variance' }]}
    />
  );
}

export function BankReconciliationLoadingShell() {
  return (
    <AccountingChromeShell
      title="Bank Reconciliation"
      description="Match bank statements against ledger entries."
      stats={[{ label: 'In progress' }, { label: 'Completed' }]}
    />
  );
}

export function TaxReturnsLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Tax Returns (VAT)"
      description="VAT summary for FIRS filing. Select a month to view output and input VAT."
      filters={filters}
      stats={[{ label: 'Output VAT' }, { label: 'Input VAT' }, { label: 'Net' }]}
    />
  );
}

export function WhtCertificatesLoadingShell() {
  return (
    <AccountingChromeShell
      title="WHT Certificates"
      description="Record withholding tax deductions and generate FIRS certificates."
      stats={[{ label: 'Certificates' }, { label: 'Total WHT' }]}
    />
  );
}

export function OpeningBalancesLoadingShell() {
  return (
    <AccountingChromeShell
      title="Opening Balances"
      description="Enter each account's balance at go-live. Any residual posts to Opening Balance Equity so the entry balances."
      showSearch
      searchPlaceholder="Filter accounts..."
    />
  );
}

export function AgingLoadingShell({ kind = 'RECEIVABLE' }: { kind?: 'RECEIVABLE' | 'PAYABLE' }) {
  const isAR = kind === 'RECEIVABLE';
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Aging Report"
        mobileInlineActions
        description={isAR ? 'Outstanding customer balances by age.' : 'Outstanding supplier balances by age.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Aging toolbar"
            desktop={<PageRefreshButton />}
          />
        }
      />
      <Tabs
        variant="pill"
        value={kind}
        onChange={() => {}}
        tabs={[
          { value: 'RECEIVABLE', label: 'Receivable' },
          { value: 'PAYABLE', label: 'Payable' },
        ]}
      />
      <OverviewStatStrip
        items={[
          { label: 'Current (0–30)', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: '90d+ overdue', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Total outstanding', value: <StatValuePulse className="min-w-[3.5rem]" /> },
        ]}
      />
      <TablePulseRows />
    </div>
  );
}

export function AssetRegisterLoadingShell() {
  return (
    <AccountingChromeShell
      title="Asset Register"
      description="Track fixed assets, depreciation, and disposals."
      showSearch
      searchPlaceholder="Search assets..."
      stats={[{ label: 'Assets' }, { label: 'Book value' }]}
    />
  );
}

export function ExpenseSubmissionsLoadingShell() {
  return (
    <AccountingChromeShell
      title="Expense Submissions"
      description="Submit and review vendor expense claims."
      showSearch
      searchPlaceholder="Search expenses..."
      stats={[{ label: 'Pending' }, { label: 'Approved' }, { label: 'Total' }]}
    />
  );
}

export function AccountDetailLoadingShell({ filters }: { filters: DateFilters }) {
  return (
    <AccountingChromeShell
      title="Account Detail"
      description="Sub-ledger entries for this account."
      filters={filters}
      stats={[{ label: 'Total Debit' }, { label: 'Total Credit' }, { label: 'Net Balance' }, { label: 'Entries' }]}
    />
  );
}
