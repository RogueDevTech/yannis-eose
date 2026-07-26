import { useMemo, useCallback, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { useFetcherToast } from '~/components/ui/toast';
import { Tabs } from '~/components/ui/tabs';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';

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
}

interface Props {
  mappings: AccountMappingRow[];
  accounts: AccountOption[];
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

/** Convert SCREAMING_SNAKE_CASE enum values to Title Case labels. */
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

export function AccountMappingsPage({ mappings, accounts, canWrite }: Props) {
  const totalCount = mappings.length;
  const customCount = mappings.filter((m) => m.isCustom).length;
  const defaultCount = totalCount - customCount;

  // Track local overrides (mappingKey → accountId) for batch save
  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({});
  const saveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(saveFetcher.data, { successMessage: 'Mappings saved successfully' });

  const dirtyCount = Object.keys(localOverrides).length;

  const handleMappingChange = useCallback((mappingKey: string, accountId: string) => {
    setLocalOverrides((prev) => {
      // Find the original value
      const original = mappings.find((m) => m.mappingKey === mappingKey);
      if (original && original.accountId === accountId) {
        // Reverted to original — remove from dirty
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

  // Clear local overrides on successful save
  if (saveFetcher.data?.success && dirtyCount > 0) {
    setLocalOverrides({});
  }

  const [activeTab, setActiveTab] = useState<'mappings' | 'categories' | 'rules'>('mappings');

  // Start with all categories expanded
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
      accounts
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((a) => ({
          value: a.id,
          label: `${a.code} · ${displayName(a.name)}`,
          description: a.rootType,
        })),
    [accounts],
  );

  const accountTypeRows = useMemo<AccountTypeRow[]>(() => {
    const map = new Map<string, { count: number; rootTypes: Set<string> }>();
    for (const a of accounts) {
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
  }, [accounts]);

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
        title="Account Mappings"
        mobileInlineActions
        description="Configure which GL accounts the auto-posting engine uses."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Account mappings toolbar"
            desktop={<PageRefreshButton />}
            sheet={() => null}
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        mobileGridCols={3}
        items={[
          { label: 'Total', value: totalCount },
          { label: 'Custom', value: customCount, valueClassName: customCount > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg' },
          { label: 'Default', value: defaultCount },
        ]}
      />

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'mappings', label: `Mappings (${totalCount})` },
          { value: 'categories', label: `Account Types (${accountTypeRows.length})` },
          { value: 'rules', label: 'Posting Rules' },
        ]}
      />

      {activeTab === 'mappings' && (
        <>
        <div className="card !p-0 overflow-hidden">
          <div className="divide-y divide-app-border">
            {grouped.map(({ category, items }) => {
              const isExpanded = expanded.has(category);
              const customInGroup = items.filter((m) => m.isCustom).length;
              return (
                <div key={category}>
                  {/* Category header - clickable accordion */}
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
                    {customInGroup > 0 && (
                      <span className="inline-flex items-center rounded-full bg-warning-100 dark:bg-warning-900/30 px-2 py-0.5 text-[10px] font-medium text-warning-700 dark:text-warning-300">
                        {customInGroup} custom
                      </span>
                    )}
                  </button>

                  {/* Expanded rows */}
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
            Account types are system-defined. Contact your administrator to add new types.
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
        <PostingRulesTab />
      )}
    </div>
  );
}

const POSTING_RULES = [
  {
    trigger: 'Cash Remittance',
    description: 'When a delivery remittance is marked received',
    entries: [
      { side: 'DR', account: 'Primary Bank Account' },
      { side: 'CR', account: 'Accounts Receivable' },
      { side: 'DR', account: 'Outbound Delivery Costs' },
      { side: 'DR', account: 'Bank Charges' },
    ],
  },
  {
    trigger: 'Sales Invoice',
    description: 'When an order is delivered and invoiced',
    entries: [
      { side: 'DR', account: 'Accounts Receivable' },
      { side: 'CR', account: 'Product Sales Revenue' },
      { side: 'CR', account: 'VAT Payable' },
      { side: 'DR', account: 'Cost of Goods Sold' },
      { side: 'CR', account: 'Finished Goods Stock' },
    ],
  },
  {
    trigger: 'Payroll Batch',
    description: 'When a payroll batch is marked paid',
    entries: [
      { side: 'DR', account: 'Staff Salaries' },
      { side: 'CR', account: 'Accrued Salaries' },
      { side: 'CR', account: 'PAYE Tax Payable' },
    ],
  },
  {
    trigger: 'Purchase Receipt',
    description: 'When stock is received from a supplier shipment',
    entries: [
      { side: 'DR', account: 'Finished Goods Stock' },
      { side: 'DR', account: 'VAT Input Credit' },
      { side: 'CR', account: 'Accounts Payable (Suppliers)' },
    ],
  },
  {
    trigger: 'Supplier Payment',
    description: 'When a supplier invoice is paid',
    entries: [
      { side: 'DR', account: 'Accounts Payable (Suppliers)' },
      { side: 'CR', account: 'Primary Bank Account' },
    ],
  },
  {
    trigger: 'Agent Commission Due',
    description: 'When a delivery agent earns commission',
    entries: [
      { side: 'DR', account: 'Agent Delivery Commission' },
      { side: 'CR', account: 'Agent Commissions Payable' },
    ],
  },
  {
    trigger: 'Agent Commission Paid',
    description: 'When agent commission is disbursed',
    entries: [
      { side: 'DR', account: 'Agent Commissions Payable' },
      { side: 'CR', account: 'Primary Bank Account' },
      { side: 'CR', account: 'Withholding Tax Payable' },
    ],
  },
  {
    trigger: 'Marketing Funding',
    description: 'When ad spend is disbursed to a media buyer',
    entries: [
      { side: 'DR', account: 'Digital Advertising Spend' },
      { side: 'CR', account: 'Primary Bank Account' },
    ],
  },
  {
    trigger: 'Expense Approval',
    description: 'When an expense submission is approved',
    entries: [
      { side: 'DR', account: '(Selected GL Account)' },
      { side: 'CR', account: 'Accounts Payable (Suppliers)' },
    ],
  },
  {
    trigger: 'Asset Acquisition',
    description: 'When a fixed asset is purchased',
    entries: [
      { side: 'DR', account: '(Asset Account)' },
      { side: 'CR', account: 'Primary Bank Account' },
    ],
  },
  {
    trigger: 'Monthly Depreciation',
    description: 'When depreciation is run for a period',
    entries: [
      { side: 'DR', account: 'Depreciation Expense' },
      { side: 'CR', account: 'Accumulated Depreciation' },
    ],
  },
  {
    trigger: 'Asset Disposal',
    description: 'When a fixed asset is sold or written off',
    entries: [
      { side: 'DR', account: 'Primary Bank Account' },
      { side: 'DR', account: 'Accumulated Depreciation' },
      { side: 'CR', account: '(Asset Account)' },
      { side: 'DR/CR', account: 'Gain/Loss on Disposal' },
    ],
  },
  {
    trigger: 'Customer Deposit',
    description: 'When a customer pays a deposit upfront',
    entries: [
      { side: 'DR', account: 'Primary Bank Account' },
      { side: 'CR', account: 'Customer Deposits' },
    ],
  },
] as const;

function PostingRulesTab() {
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
                      <span className="text-sm text-app-fg">{entry.account}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
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

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 pl-12 ${isDirty ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''}`}>
      {/* Label + default code + badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-app-fg">{mapping.label}</span>
          {isDirty ? (
            <span className="inline-flex items-center rounded-full bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300">
              Changed
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
        </p>
      </div>

      {/* Current account + select */}
      <div className="w-full max-w-xs flex items-center gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <SearchableSelect
            value={currentValue}
            onChange={(v) => onChange(mapping.mappingKey, v)}
            options={accountOptions}
            placeholder="Select account..."
            searchPlaceholder="Search by code or name..."
            disabled={!canWrite}
            controlSize="sm"
          />
        </div>
        {/* Reset button removed - use Save Changes instead */}
        {false && (
          <button
            type="button"
            className="shrink-0 p-1 rounded text-app-fg-muted hover:text-app-fg hover:bg-app-hover transition-colors disabled:opacity-50"
            title="Reset to default"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
