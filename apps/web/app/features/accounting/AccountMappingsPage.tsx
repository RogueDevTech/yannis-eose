import { useMemo, useCallback, useState, useEffect } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { useFetcherToast } from '~/components/ui/toast';
import { Tabs } from '~/components/ui/tabs';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

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

const ROOT_TYPES = [
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
];

const ACCOUNT_TYPES = [
  'BANK', 'CASH', 'RECEIVABLE', 'PAYABLE', 'STOCK', 'COST_OF_GOODS_SOLD',
  'TAX', 'FIXED_ASSET', 'INDIRECT_EXPENSE', 'INDIRECT_INCOME', 'DIRECT_INCOME',
  'EQUITY', 'ROUND_OFF', 'TEMPORARY', 'DEPRECIATION', 'EXPENSE_ACCOUNT',
  'CHARGEABLE', 'STOCK_RECEIVED_BUT_NOT_BILLED',
].map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

/** Prefill hints when creating an account for a missing mapping. */
const CREATE_PRESETS: Record<string, { code: string; name: string; rootType: string; accountType: string }> = {
  CASH_PETTY: { code: '1111', name: 'Cash on Hand (Petty Cash)', rootType: 'ASSET', accountType: 'CASH' },
  BANK_PRIMARY: { code: '1112', name: 'Cash at Bank — Primary Account', rootType: 'ASSET', accountType: 'BANK' },
  BANK_SECONDARY: { code: '1113', name: 'Cash at Bank — Secondary Account', rootType: 'ASSET', accountType: 'BANK' },
};

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

interface CreateDraft {
  mappingKey?: string;
  code: string;
  name: string;
  rootType: string;
  accountType: string;
  parentAccountId: string;
}

export function AccountMappingsPage({ mappings, accounts, canWrite }: Props) {
  const revalidator = useRevalidator();
  const totalCount = mappings.length;
  const customCount = mappings.filter((m) => m.isCustom).length;
  const defaultCount = totalCount - customCount;
  const missingCount = mappings.filter((m) => !m.accountId).length;

  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({});
  const saveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(saveFetcher.data, { successMessage: 'Mappings saved successfully' });

  const createFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    intent?: string;
    account?: { id: string; code: string; name: string };
    assignToMappingKey?: string;
  }>();
  useFetcherToast(createFetcher.data, { successMessage: 'Account created' });

  const dirtyCount = Object.keys(localOverrides).length;

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    code: '',
    name: '',
    rootType: 'ASSET',
    accountType: 'BANK',
    parentAccountId: '',
  });
  const [parentId, setParentId] = useState('');

  useCloseOnFetcherSuccess(createFetcher, () => {
    setCreateOpen(false);
    setParentId('');
  });

  // After create (+ optional assign), clear dirty for that key and refresh loader data.
  useEffect(() => {
    if (!createFetcher.data?.success || createFetcher.state !== 'idle') return;
    const created = createFetcher.data.account;
    const assignKey = createFetcher.data.assignToMappingKey;
    if (created && assignKey) {
      setLocalOverrides((prev) => {
        const next = { ...prev };
        delete next[assignKey];
        return next;
      });
    }
    revalidator.revalidate();
  }, [createFetcher.data, createFetcher.state, revalidator]);

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

  const openCreate = useCallback((opts?: { mappingKey?: string }) => {
    const preset = opts?.mappingKey ? CREATE_PRESETS[opts.mappingKey] : undefined;
    const mapping = opts?.mappingKey
      ? mappings.find((m) => m.mappingKey === opts.mappingKey)
      : undefined;
    setCreateDraft({
      mappingKey: opts?.mappingKey,
      code: preset?.code ?? mapping?.defaultCode ?? '',
      name: preset?.name ?? (mapping ? mapping.label : ''),
      rootType: preset?.rootType ?? 'ASSET',
      accountType: preset?.accountType ?? '',
      parentAccountId: '',
    });
    setParentId('');
    setCreateOpen(true);
  }, [mappings]);

  const [activeTab, setActiveTab] = useState<'mappings' | 'categories' | 'rules'>('mappings');

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

  const parentOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.isGroup)
        .slice()
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
        title="Account Mappings"
        mobileInlineActions
        description="Point auto-posting at the GL accounts your company uses. Create or remap accounts here."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Account mappings toolbar"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                <Link to="/admin/finance/accounts" className="btn-secondary btn-sm inline-flex items-center">
                  Chart of Accounts
                </Link>
                {canWrite && (
                  <Button type="button" size="sm" onClick={() => openCreate()}>
                    New Account
                  </Button>
                )}
              </div>
            }
            sheet={({ closeSheet }) => (
              <div className="space-y-2">
                <Link
                  to="/admin/finance/accounts"
                  className="btn-secondary w-full flex items-center justify-center h-12"
                  onClick={() => closeSheet()}
                >
                  Chart of Accounts
                </Link>
                {canWrite && (
                  <Button
                    type="button"
                    className="w-full h-12"
                    onClick={() => {
                      closeSheet();
                      openCreate();
                    }}
                  >
                    New Account
                  </Button>
                )}
              </div>
            )}
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        mobileGridCols={missingCount > 0 ? 4 : 3}
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
            Create the missing account (suggested code is filled in) or remap to an existing one, then save.
          </p>
        </div>
      )}

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
                            onCreateAccount={() => openCreate({ mappingKey: mapping.mappingKey })}
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
            Account types tag leaf accounts for reports and Cash Flow (BANK / CASH). Create accounts from Mappings or Chart of Accounts to add more of a type.
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

      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">New Account</h2>
            {createDraft.mappingKey && (
              <p className="text-xs text-app-fg-muted">
                Creating for mapping <span className="font-mono">{createDraft.mappingKey}</span>. After save it will be assigned automatically.
              </p>
            )}
            <createFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="createAccount" />
              {createDraft.mappingKey && (
                <input type="hidden" name="assignToMappingKey" value={createDraft.mappingKey} />
              )}
              <input type="hidden" name="parentAccountId" value={parentId} />
              <TextInput
                label="Code"
                name="code"
                required
                defaultValue={createDraft.code}
                placeholder="e.g. 1113"
              />
              <TextInput
                label="Name"
                name="name"
                required
                defaultValue={createDraft.name}
              />
              <FormSelect
                name="rootType"
                label="Root type"
                options={ROOT_TYPES}
                required
                defaultValue={createDraft.rootType}
              />
              <FormSelect
                name="accountType"
                label="Account type (optional)"
                options={[{ value: '', label: 'None' }, ...ACCOUNT_TYPES]}
                defaultValue={createDraft.accountType}
              />
              <SearchableSelect
                label="Parent account (optional)"
                value={parentId}
                onChange={setParentId}
                options={parentOptions}
                clearable
              />
              <label className="flex items-center gap-2 text-sm text-app-fg">
                <input
                  type="checkbox"
                  name="isGroup"
                  value="true"
                  className="rounded border-app-border text-brand-600 focus:ring-brand-500"
                />
                This is a group (header) account
              </label>
              {createFetcher.data?.error && (
                <p className="text-sm text-danger-600">{createFetcher.data.error}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createFetcher.state !== 'idle'}>
                  {createFetcher.state !== 'idle' ? 'Saving...' : 'Create'}
                </Button>
              </div>
            </createFetcher.Form>
          </div>
        </Modal>
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
  onCreateAccount,
}: {
  mapping: AccountMappingRow;
  localValue?: string;
  accountOptions: Array<{ value: string; label: string; description?: string }>;
  canWrite: boolean;
  onChange: (mappingKey: string, accountId: string) => void;
  onCreateAccount: () => void;
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
                to={`/admin/finance/accounts/${mapping.accountId}`}
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
            placeholder={isMissing ? 'Select or create account...' : 'Select account...'}
            searchPlaceholder="Search by code or name..."
            disabled={!canWrite}
            controlSize="sm"
          />
        </div>
        {canWrite && isMissing && (
          <Button type="button" size="sm" variant="secondary" onClick={onCreateAccount}>
            Create
          </Button>
        )}
      </div>
    </div>
  );
}
