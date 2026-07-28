import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ActionDropdown } from '~/components/ui/action-dropdown';
import { Button } from '~/components/ui/button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { useFetcherToast } from '~/components/ui/toast';
import { Tabs } from '~/components/ui/tabs';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { ChartOfAccountsPage, type AccountRow } from './ChartOfAccountsPage';

export interface AccountMappingRow {
  mappingKey: string;
  label: string;
  category: string;
  defaultCode: string;
  isCustom: boolean;
  accountId: string;
  accountCode: string;
  accountName: string;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  rootType: string;
  accountType?: string;
  isGroup?: boolean;
}

interface Props {
  mappings: AccountMappingRow[];
  /** Leaf-only option list for the mapping selectors. */
  accounts: AccountOption[];
  /** Full account rows (incl. inactive) for the Accounts tab tree + CRUD. */
  accountRows: AccountRow[];
  hasOpeningBalances: boolean;
  canWrite: boolean;
}

const CATEGORY_ORDER = [
  'Assets',
  'Liabilities',
  'Equity',
  'Revenue',
  'Cost of Sales',
  'Expenses',
  'Other',
];

function displayName(name: string): string {
  return name.replace(/\s*[—–]\s*/g, ' · ');
}

function accountTypeLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface AccountTypeRow {
  type: string;
  label: string;
  count: number;
  rootTypes: string;
}

export function AccountConfigPage({
  mappings,
  accounts,
  accountRows,
  hasOpeningBalances,
  canWrite,
}: Props) {
  const revalidator = useRevalidator();
  const totalCount = mappings.length;
  const customCount = mappings.filter((m) => m.isCustom).length;
  const defaultCount = totalCount - customCount;
  const missingCount = mappings.filter((m) => !m.accountId).length;

  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({});
  const saveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(saveFetcher.data, { successMessage: 'Mappings saved successfully' });

  const dirtyCount = Object.keys(localOverrides).length;

  useEffect(() => {
    if (saveFetcher.data?.success && saveFetcher.state === 'idle') {
      setLocalOverrides({});
      revalidator.revalidate();
    }
  }, [saveFetcher.data, saveFetcher.state, revalidator]);

  const handleMappingChange = useCallback((mappingKey: string, accountId: string) => {
    setLocalOverrides((prev) => {
      const original = mappings.find((m) => m.mappingKey === mappingKey);
      if (original && original.accountId === accountId) {
        const next = { ...prev };
        delete next[mappingKey];
        return next;
      }
      return { ...prev, [mappingKey]: accountId };
    });
  }, [mappings]);

  const handleSaveAll = useCallback(() => {
    if (dirtyCount === 0) return;
    saveFetcher.submit(
      { intent: 'bulkUpdateMappings', overrides: JSON.stringify(localOverrides) },
      { method: 'post' },
    );
  }, [saveFetcher, localOverrides, dirtyCount]);

  const [activeTab, setActiveTab] = useState<'accounts' | 'mappings' | 'categories' | 'rules'>(
    'accounts',
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // The Accounts tab (ChartOfAccountsPage) registers its create-modal opener
  // here so the page header's Add Account button can drive it.
  const openAccountCreateRef = useRef<((kind: 'leaf' | 'group') => void) | null>(null);
  const registerAccountCreate = useCallback((open: (kind: 'leaf' | 'group') => void) => {
    openAccountCreateRef.current = open;
  }, []);

  /** Account IDs referenced by a mapping — powers the deactivate warning. */
  const mappedAccountIds = useMemo(
    () => new Set(mappings.map((m) => m.accountId).filter(Boolean)),
    [mappings],
  );

  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(CATEGORY_ORDER),
  );
  const toggleCategory = (cat: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const leafAccounts = useMemo(
    () => accounts.filter((a) => !a.isGroup),
    [accounts],
  );

  const grouped = useMemo(() => {
    const groups: Record<string, AccountMappingRow[]> = {};
    for (const m of mappings) {
      (groups[m.category] ??= []).push(m);
    }
    return CATEGORY_ORDER
      .filter((cat) => groups[cat]?.length)
      .map((cat) => ({ category: cat, items: groups[cat]! }));
  }, [mappings]);

  const accountOptions = useMemo(
    () =>
      leafAccounts
        .slice()
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((a) => ({
          value: a.id,
          label: `${a.code} · ${displayName(a.name)}`,
          description: a.rootType,
        })),
    [leafAccounts],
  );

  const accountTypeRows = useMemo<AccountTypeRow[]>(() => {
    const map = new Map<string, { count: number; rootTypes: Set<string> }>();
    for (const a of leafAccounts) {
      if (!a.accountType) continue;
      const entry = map.get(a.accountType) ?? { count: 0, rootTypes: new Set() };
      entry.count += 1;
      if (a.rootType) entry.rootTypes.add(a.rootType);
      map.set(a.accountType, entry);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, { count, rootTypes }]) => ({
        type,
        label: accountTypeLabel(type),
        count,
        rootTypes: Array.from(rootTypes).sort().join(', ') || 'None',
      }));
  }, [leafAccounts]);

  const accountTypeColumns: CompactTableColumn<AccountTypeRow>[] = [
    {
      key: 'label',
      header: 'Type',
      render: (row) => (
        <div>
          <p className="text-sm font-medium text-app-fg">{row.label}</p>
          <p className="text-xs text-app-fg-muted font-mono">{row.type}</p>
        </div>
      ),
    },
    {
      key: 'count',
      header: 'Accounts',
      align: 'right',
      render: (row) => (
        <span className="text-sm tabular-nums text-app-fg">{row.count}</span>
      ),
    },
    {
      key: 'rootTypes',
      header: 'Root Types',
      render: (row) => (
        <span className="text-sm text-app-fg-muted">{row.rootTypes}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Account Config"
        mobileInlineActions
        description="Manage the chart of accounts and wire posting keys to the right GL accounts."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Account config toolbar"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                {activeTab === 'accounts' && canWrite && (
                  <ActionDropdown
                    id="account-config-add-account"
                    openMenuId={openMenuId}
                    setOpenMenuId={setOpenMenuId}
                    trigger="button"
                    triggerVariant="primary"
                    triggerLabel="Add Account"
                    items={[
                      { label: 'Leaf (postable)', onClick: () => openAccountCreateRef.current?.('leaf') },
                      { label: 'Group (header)', onClick: () => openAccountCreateRef.current?.('group') },
                    ]}
                  />
                )}
              </div>
            }
            sheet={
              activeTab === 'accounts' && canWrite ? (
                <ActionDropdown
                  id="account-config-add-account-sheet"
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  trigger="button"
                  triggerVariant="primary"
                  triggerLabel="Add Account"
                  triggerClassName="w-full justify-center"
                  align="start"
                  items={[
                    { label: 'Leaf (postable)', onClick: () => openAccountCreateRef.current?.('leaf') },
                    { label: 'Group (header)', onClick: () => openAccountCreateRef.current?.('group') },
                  ]}
                />
              ) : undefined
            }
          />
        }
      />

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'accounts', label: `Accounts (${accountRows.length})` },
          { value: 'mappings', label: `Mappings (${totalCount})` },
          { value: 'categories', label: `Account Types (${accountTypeRows.length})` },
          { value: 'rules', label: 'Posting Rules' },
        ]}
      />

      {activeTab === 'accounts' && (
        <ChartOfAccountsPage
          accounts={accountRows}
          canWrite={canWrite}
          hasOpeningBalances={hasOpeningBalances}
          mappedAccountIds={mappedAccountIds}
          embedded
          onRegisterCreate={registerAccountCreate}
        />
      )}

      {activeTab === 'mappings' && (
        <>
          <OverviewStatStrip
            mobileGrid
            mobileGridCols={missingCount > 0 ? 2 : 3}
            items={[
              { label: 'Total', value: totalCount },
              { label: 'Custom', value: customCount, valueClassName: customCount > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg' },
              { label: 'Default', value: defaultCount },
              ...(missingCount > 0
                ? [{ label: 'Unmapped', value: missingCount, valueClassName: 'text-danger-600 dark:text-danger-400' }]
                : []),
            ]}
          />

          {missingCount > 0 && (
            <div className="rounded-lg border border-warning-200 dark:border-warning-800 bg-warning-50/60 dark:bg-warning-900/20 px-4 py-3">
              <p className="text-sm font-medium text-warning-800 dark:text-warning-200">
                {missingCount} mapping{missingCount !== 1 ? 's' : ''} have no matching account
              </p>
              <p className="text-xs text-warning-700 dark:text-warning-300 mt-0.5">
                Remap each to an existing account, then save. Add new accounts on the Accounts tab.
              </p>
            </div>
          )}

          <div className="card !p-0 overflow-hidden">
            <div className="divide-y divide-app-border">
              {grouped.map(({ category, items }) => {
                const isExpanded = expanded.has(category);
                const customInGroup = items.filter((m) => m.isCustom).length;
                const missingInGroup = items.filter((m) => !m.accountId).length;
                return (
                  <div key={category}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-app-hover/30 hover:bg-app-hover/50 transition-colors text-left"
                    >
                      <svg
                        className={`w-3.5 h-3.5 text-app-fg-muted shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      <span className="text-sm font-semibold text-app-fg flex-1">{category}</span>
                      <span className="text-xs text-app-fg-muted">{items.length} mapping{items.length !== 1 ? 's' : ''}</span>
                      {missingInGroup > 0 && (
                        <span className="inline-flex items-center rounded-full bg-danger-100 dark:bg-danger-900/30 px-2 py-0.5 text-[10px] font-medium text-danger-700 dark:text-danger-300">
                          {missingInGroup} missing
                        </span>
                      )}
                      {customInGroup > 0 && (
                        <span className="inline-flex items-center rounded-full bg-warning-100 dark:bg-warning-900/30 px-2 py-0.5 text-[10px] font-medium text-warning-700 dark:text-warning-300">
                          {customInGroup} custom
                        </span>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="divide-y divide-app-border">
                        {items.map((mapping) => (
                          <MappingRow
                            key={mapping.mappingKey}
                            mapping={mapping}
                            localValue={localOverrides[mapping.mappingKey]}
                            accountOptions={accountOptions}
                            canWrite={canWrite}
                            onChange={handleMappingChange}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {canWrite && (
            <div className="sticky bottom-0 bg-app-bg border-t border-app-border py-3 -mx-4 px-4 md:-mx-6 md:px-6 flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                disabled={dirtyCount === 0}
                loading={saveFetcher.state === 'submitting'}
                loadingText="Saving..."
                onClick={handleSaveAll}
              >
                Save changes
              </Button>
              {dirtyCount > 0 && (
                <span className="text-xs text-warning-600 dark:text-warning-400">
                  {dirtyCount} unsaved change{dirtyCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'categories' && (
        <div className="space-y-3">
          <p className="text-xs text-app-fg-muted px-0.5">
            Account types tag leaf accounts for reports and Cash Flow (BANK / CASH). Add accounts on the Accounts tab to add more of a type.
          </p>
          <CompactTable
            columns={accountTypeColumns}
            rows={accountTypeRows}
            rowKey={(row) => row.type}
            emptyTitle="No account types found"
            emptyDescription="Account types come from the accounts chart. Add accounts to see types here."
          />
        </div>
      )}

      {activeTab === 'rules' && (
        <PostingRulesTab onJumpToMappings={() => setActiveTab('mappings')} />
      )}
    </div>
  );
}

/** Posting rules reference mapping labels — jump back to Mappings to remount them. */
const POSTING_RULES = [
  {
    trigger: 'Cash Remittance',
    description: 'When a delivery remittance is marked received',
    entries: [
      { side: 'DR', account: 'Primary Bank Account', mappingKey: 'BANK_PRIMARY' },
      { side: 'CR', account: 'Accounts Receivable', mappingKey: 'AR_CUSTOMERS' },
      { side: 'DR', account: 'Outbound Delivery Costs', mappingKey: 'OUTBOUND_DELIVERY' },
      { side: 'DR', account: 'Bank Charges', mappingKey: 'BANK_CHARGES' },
    ],
  },
  {
    trigger: 'Sales Invoice',
    description: 'When an order is delivered and invoiced',
    entries: [
      { side: 'DR', account: 'Accounts Receivable', mappingKey: 'AR_CUSTOMERS' },
      { side: 'CR', account: 'Product Sales Revenue', mappingKey: 'PRODUCT_SALES' },
      { side: 'CR', account: 'VAT Payable', mappingKey: 'VAT_OUTPUT' },
      { side: 'DR', account: 'Cost of Goods Sold', mappingKey: 'COGS_PURCHASE' },
      { side: 'CR', account: 'Finished Goods Stock', mappingKey: 'STOCK_FINISHED_GOODS' },
    ],
  },
  {
    trigger: 'Payroll Batch',
    description: 'When a payroll batch is marked paid',
    entries: [
      { side: 'DR', account: 'Staff Salaries', mappingKey: 'STAFF_SALARIES' },
      { side: 'CR', account: 'Accrued Salaries', mappingKey: 'ACCRUED_SALARIES' },
      { side: 'CR', account: 'PAYE Tax Payable', mappingKey: 'PAYE_PAYABLE' },
    ],
  },
  {
    trigger: 'Purchase Receipt',
    description: 'When stock is received from a supplier shipment',
    entries: [
      { side: 'DR', account: 'Finished Goods Stock', mappingKey: 'STOCK_FINISHED_GOODS' },
      { side: 'DR', account: 'VAT Input Credit', mappingKey: 'VAT_INPUT_CREDIT' },
      { side: 'CR', account: 'Accounts Payable (Suppliers)', mappingKey: 'AP_SUPPLIERS' },
    ],
  },
  {
    trigger: 'Supplier Payment',
    description: 'When a supplier invoice is paid',
    entries: [
      { side: 'DR', account: 'Accounts Payable (Suppliers)', mappingKey: 'AP_SUPPLIERS' },
      { side: 'CR', account: 'Primary Bank Account', mappingKey: 'BANK_PRIMARY' },
    ],
  },
  {
    trigger: 'Agent Commission Due',
    description: 'When a delivery agent earns commission',
    entries: [
      { side: 'DR', account: 'Agent Delivery Commission', mappingKey: 'AGENT_DELIVERY_COMM' },
      { side: 'CR', account: 'Agent Commissions Payable', mappingKey: 'AP_AGENT_COMMISSIONS' },
    ],
  },
  {
    trigger: 'Agent Commission Paid',
    description: 'When agent commission is disbursed',
    entries: [
      { side: 'DR', account: 'Agent Commissions Payable', mappingKey: 'AP_AGENT_COMMISSIONS' },
      { side: 'CR', account: 'Primary Bank Account', mappingKey: 'BANK_PRIMARY' },
      { side: 'CR', account: 'Withholding Tax Payable', mappingKey: 'WHT_PAYABLE' },
    ],
  },
  {
    trigger: 'Marketing Funding',
    description: 'When ad spend is disbursed to a media buyer',
    entries: [
      { side: 'DR', account: 'Digital Advertising Spend', mappingKey: 'AD_SPEND_DIGITAL' },
      { side: 'CR', account: 'Primary Bank Account', mappingKey: 'BANK_PRIMARY' },
    ],
  },
  {
    trigger: 'Expense Approval',
    description: 'When an expense submission is approved',
    entries: [
      { side: 'DR', account: '(Selected GL Account)' },
      { side: 'CR', account: 'Accounts Payable (Suppliers)', mappingKey: 'AP_SUPPLIERS' },
    ],
  },
  {
    trigger: 'Asset Acquisition',
    description: 'When a fixed asset is purchased',
    entries: [
      { side: 'DR', account: '(Asset Account)' },
      { side: 'CR', account: 'Primary Bank Account', mappingKey: 'BANK_PRIMARY' },
    ],
  },
  {
    trigger: 'Monthly Depreciation',
    description: 'When depreciation is run for a period',
    entries: [
      { side: 'DR', account: 'Depreciation Expense', mappingKey: 'DEPRECIATION_FIXED' },
      { side: 'CR', account: 'Accumulated Depreciation', mappingKey: 'ACC_DEPRECIATION' },
    ],
  },
  {
    trigger: 'Asset Disposal',
    description: 'When a fixed asset is sold or written off',
    entries: [
      { side: 'DR', account: 'Primary Bank Account', mappingKey: 'BANK_PRIMARY' },
      { side: 'DR', account: 'Accumulated Depreciation', mappingKey: 'ACC_DEPRECIATION' },
      { side: 'CR', account: '(Asset Account)' },
      { side: 'DR/CR', account: 'Gain/Loss on Disposal', mappingKey: 'DISPOSAL_GAIN_LOSS' },
    ],
  },
  {
    trigger: 'Customer Deposit',
    description: 'When a customer pays a deposit upfront',
    entries: [
      { side: 'DR', account: 'Primary Bank Account', mappingKey: 'BANK_PRIMARY' },
      { side: 'CR', account: 'Customer Deposits', mappingKey: 'CUSTOMER_DEPOSITS' },
    ],
  },
] as const;

function PostingRulesTab({ onJumpToMappings }: { onJumpToMappings: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(POSTING_RULES.map((r) => r.trigger)),
  );
  const toggle = (trigger: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(trigger)) next.delete(trigger);
      else next.add(trigger);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-app-fg-muted px-0.5">
        Read-only reference for how auto-posting journals are built. Remap any named account on the Mappings tab.
      </p>
      <div className="card !p-0 overflow-hidden">
        <div className="divide-y divide-app-border">
          {POSTING_RULES.map((rule) => {
            const isExpanded = expanded.has(rule.trigger);
            return (
              <div key={rule.trigger}>
                <button
                  type="button"
                  onClick={() => toggle(rule.trigger)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-app-hover/30 hover:bg-app-hover/50 transition-colors text-left"
                >
                  <svg
                    className={`w-3.5 h-3.5 text-app-fg-muted shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <div className="flex-1 min-w-0 text-left">
                    <span className="text-sm font-semibold text-app-fg">{rule.trigger}</span>
                    <p className="text-xs text-app-fg-muted mt-0.5">{rule.description}</p>
                  </div>
                  <span className="text-xs text-app-fg-muted shrink-0">
                    {rule.entries.length} lines
                  </span>
                </button>

                {isExpanded && (
                  <div className="divide-y divide-app-border">
                    {rule.entries.map((entry, idx) => (
                      <div key={idx} className="flex items-center gap-3 px-4 py-2.5 pl-12">
                        {entry.side === 'DR' ? (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300 shrink-0 w-10 justify-center">
                            DR
                          </span>
                        ) : entry.side === 'CR' ? (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300 shrink-0 w-10 justify-center">
                            CR
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-app-hover text-app-fg-muted shrink-0 w-10 justify-center">
                            {entry.side}
                          </span>
                        )}
                        {'mappingKey' in entry && entry.mappingKey ? (
                          <button
                            type="button"
                            onClick={onJumpToMappings}
                            className="text-sm text-brand-600 dark:text-brand-400 hover:underline text-left"
                            title={`Remap ${entry.mappingKey} on Mappings tab`}
                          >
                            {entry.account}
                            <span className="ml-1.5 text-[10px] font-mono text-app-fg-muted">{entry.mappingKey}</span>
                          </button>
                        ) : (
                          <span className="text-sm text-app-fg">{entry.account}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MappingRow({
  mapping,
  localValue,
  accountOptions,
  canWrite,
  onChange,
}: {
  mapping: AccountMappingRow;
  localValue?: string;
  accountOptions: Array<{ value: string; label: string; description?: string }>;
  canWrite: boolean;
  onChange: (mappingKey: string, accountId: string) => void;
}) {
  const currentValue = localValue ?? mapping.accountId;
  const isDirty = localValue !== undefined;
  const isMissing = !mapping.accountId && !localValue;

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-2.5 pl-12 ${
        isDirty
          ? 'bg-warning-50/50 dark:bg-warning-900/10'
          : isMissing
            ? 'bg-danger-50/40 dark:bg-danger-900/10'
            : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-app-fg">{mapping.label}</span>
          {isDirty ? (
            <span className="inline-flex items-center rounded-full bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300">
              Changed
            </span>
          ) : isMissing ? (
            <span className="inline-flex items-center rounded-full bg-danger-100 dark:bg-danger-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-danger-700 dark:text-danger-300">
              Missing account
            </span>
          ) : mapping.isCustom ? (
            <span className="inline-flex items-center rounded-full bg-brand-100 dark:bg-brand-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300">
              Custom
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-medium text-app-fg-muted">
              Default
            </span>
          )}
        </div>
        <p className="text-xs text-app-fg-muted mt-0.5">
          Default: <span className="font-mono">{mapping.defaultCode}</span>
          {mapping.accountId ? (
            <>
              {' · '}
              <Link
                to={`/admin/accounting/accounts/${mapping.accountId}`}
                className="text-brand-600 dark:text-brand-400 hover:underline"
              >
                Open {mapping.accountCode}
              </Link>
            </>
          ) : null}
        </p>
      </div>

      <div className="w-full sm:max-w-xs flex items-center gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <SearchableSelect
            value={currentValue}
            onChange={(v) => onChange(mapping.mappingKey, v)}
            options={accountOptions}
            placeholder={isMissing ? 'Select an account...' : 'Select account...'}
            searchPlaceholder="Search by code or name..."
            disabled={!canWrite}
            controlSize="sm"
          />
        </div>
      </div>
    </div>
  );
}
