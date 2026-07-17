import { useMemo, useState, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherToast } from '~/components/ui/toast';

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  rootType: string;
  accountType: string | null;
  isGroup: boolean;
  parentAccountId: string | null;
  balance: string;
  isActive: boolean;
}

export interface ChartOfAccountsPageProps {
  accounts: AccountRow[];
  canWrite: boolean;
}

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

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: '1', label: '1000s Assets' },
  { value: '2', label: '2000s Liabilities' },
  { value: '3', label: '3000s Equity' },
  { value: '4', label: '4000s Revenue' },
  { value: '5', label: '5000s Cost of Sales' },
  { value: '6', label: '6000s Operating Expenses' },
  { value: '7', label: '7000s Other Income/Finance' },
  { value: '8', label: '8000s Tax' },
  { value: '9', label: '9000s System' },
];

/** Normal balance based on root type per IFRS. */
function normalBalance(rootType: string): 'Debit' | 'Credit' {
  return rootType === 'ASSET' || rootType === 'EXPENSE' ? 'Debit' : 'Credit';
}

/** Human label for a semantic account type tag. */
function typeLabel(accountType: string | null): string {
  if (!accountType) return '';
  const words = accountType.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Order accounts as a tree (parent immediately above its children) + depth. */
function toTree(accounts: AccountRow[]): Array<AccountRow & { depth: number }> {
  const byParent = new Map<string | null, AccountRow[]>();
  for (const a of accounts) {
    const key = a.parentAccountId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(a);
  }
  const out: Array<AccountRow & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.code.localeCompare(b.code));
    for (const c of children) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  const seen = new Set(out.map((o) => o.id));
  for (const a of accounts) if (!seen.has(a.id)) out.push({ ...a, depth: 0 });
  return out;
}

export function ChartOfAccountsPage({ accounts, canWrite }: ChartOfAccountsPageProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null);
  const [parentId, setParentId] = useState('');
  const [search, setSearch] = useState('');
  const [rootTypeFilter, setRootTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [postableOnly, setPostableOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');

  const createFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const editFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const deactivateFetcher = useFetcher<{ success?: boolean; error?: string }>();

  useFetcherToast(createFetcher.data);
  useFetcherToast(editFetcher.data);
  useFetcherToast(deactivateFetcher.data);

  useCloseOnFetcherSuccess(createFetcher, () => {
    setCreateOpen(false);
    setParentId('');
  });
  useCloseOnFetcherSuccess(editFetcher, () => setEditAccount(null));

  // Apply status filter first (active/inactive/all)
  const statusFiltered = useMemo(() => {
    if (statusFilter === 'active') return accounts.filter((a) => a.isActive);
    if (statusFilter === 'inactive') return accounts.filter((a) => !a.isActive);
    return accounts;
  }, [accounts, statusFilter]);

  const tree = useMemo(() => toTree(statusFiltered), [statusFiltered]);

  const rows = useMemo(() => {
    let filtered = tree;
    const q = search.trim().toLowerCase();
    if (q) {
      filtered = filtered
        .filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q))
        .map((a) => ({ ...a, depth: 0 }));
    }
    if (rootTypeFilter) {
      filtered = filtered.filter((a) => a.rootType === rootTypeFilter);
    }
    if (categoryFilter) {
      filtered = filtered.filter((a) => a.code.startsWith(categoryFilter));
    }
    if (postableOnly) {
      filtered = filtered.filter((a) => !a.isGroup);
    }
    return filtered;
  }, [tree, search, rootTypeFilter, categoryFilter, postableOnly]);

  const parentOptions = useMemo(
    () => accounts.filter((a) => a.isGroup).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })),
    [accounts],
  );

  const groupCount = statusFiltered.filter((a) => a.isGroup).length;
  const activeCount = accounts.filter((a) => a.isActive).length;
  const inactiveCount = accounts.length - activeCount;

  const handleDeactivate = useCallback(
    (account: AccountRow) => {
      if (!confirm(`Deactivate "${account.code} ${account.name}"? It will no longer be selectable for new postings.`)) return;
      deactivateFetcher.submit(
        { intent: 'deactivateAccount', accountId: account.id },
        { method: 'post' },
      );
    },
    [deactivateFetcher],
  );

  const hasFilters = rootTypeFilter || categoryFilter || postableOnly || statusFilter !== 'active';
  const resetFilters = () => {
    setRootTypeFilter('');
    setCategoryFilter('');
    setPostableOnly(false);
    setStatusFilter('active');
    setSearch('');
  };

  const columns: CompactTableColumn<AccountRow & { depth: number }>[] = [
    {
      key: 'code',
      header: 'Code',
      className: 'w-20',
      render: (r) => (
        <span className="text-xs font-mono text-app-fg-muted">{r.code}</span>
      ),
    },
    {
      key: 'name',
      header: 'Account',
      render: (r) => (
        <span style={{ paddingLeft: `${r.depth * 16}px` }} className="flex items-center gap-2">
          <span className={`${r.isGroup ? 'font-semibold' : ''} ${r.isActive ? 'text-app-fg' : 'text-app-fg-muted line-through'}`}>
            {r.name}
          </span>
          {r.isGroup && (
            <span className="rounded bg-app-hover px-1.5 py-0.5 text-[10px] uppercase text-app-fg-muted">
              group
            </span>
          )}
          {!r.isActive && (
            <StatusBadge status="INACTIVE" size="sm" />
          )}
        </span>
      ),
    },
    {
      key: 'rootType',
      header: 'Type',
      hideOnMobile: true,
      render: (r) => (
        <span className="text-xs text-app-fg-muted">{r.rootType}</span>
      ),
    },
    {
      key: 'accountType',
      header: 'Account Type',
      hideOnMobile: true,
      render: (r) => (
        <span className="text-xs text-app-fg-muted">{typeLabel(r.accountType)}</span>
      ),
    },
    {
      key: 'normalBalance',
      header: 'Normal',
      hideOnMobile: true,
      render: (r) => (
        <span className={`text-xs ${normalBalance(r.rootType) === 'Debit' ? 'text-info-600 dark:text-info-400' : 'text-success-600 dark:text-success-400'}`}>
          {normalBalance(r.rootType)}
        </span>
      ),
    },
    {
      key: 'postable',
      header: 'Post?',
      hideOnMobile: true,
      render: (r) => (
        <span className={`text-xs ${r.isGroup ? 'text-app-fg-muted' : 'text-success-600 dark:text-success-400'}`}>
          {r.isGroup ? 'No' : 'Yes'}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      hideOnMobile: true,
      render: (r) =>
        r.isGroup || Number(r.balance) === 0 ? null : <NairaPrice amount={r.balance} />,
    },
  ];

  if (canWrite) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <span className="flex items-center justify-end gap-1">
          <TableActionButton onClick={() => setEditAccount(r)}>Edit</TableActionButton>
          {r.isActive && (
            <TableActionButton onClick={() => handleDeactivate(r)} variant="danger">Deactivate</TableActionButton>
          )}
        </span>
      ),
    });
  }

  return (
    <>
      <PageHeader
        title="Chart of Accounts"
        description="IFRS-compliant account tree for double-entry ledger postings."
        actions={
          canWrite ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              New Account
            </Button>
          ) : undefined
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Total', value: String(accounts.length) },
          { label: 'Active', value: String(activeCount) },
          { label: 'Groups', value: String(groupCount) },
          { label: 'Postable', value: String(statusFiltered.length - groupCount) },
          ...(inactiveCount > 0 ? [{ label: 'Inactive', value: String(inactiveCount), valueClassName: 'text-app-fg-muted' }] : []),
        ]}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by code or name" className="max-w-xs" />
        <FormSelect
          value={rootTypeFilter}
          onChange={(e) => setRootTypeFilter(e.target.value)}
          options={[{ value: '', label: 'All types' }, ...ROOT_TYPES]}
          className="w-36"
        />
        <FormSelect
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          options={CATEGORY_OPTIONS}
          className="w-48"
        />
        <FormSelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'all', label: 'All' },
          ]}
          className="w-32"
        />
        <label className="flex items-center gap-1.5 text-xs text-app-fg-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={postableOnly}
            onChange={(e) => setPostableOnly(e.target.checked)}
            className="rounded border-app-border"
          />
          Postable only
        </label>
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="text-xs text-brand-600 hover:underline">
            Reset
          </button>
        )}
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="The chart of accounts seeds automatically on server boot. Create one manually if needed."
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No matches" description="No accounts match the current filters." />
      ) : (
        <CompactTable columns={columns} rows={rows} rowKey={(r) => r.id} />
      )}

      {/* Create Account Modal */}
      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">New Account</h2>
            <createFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="createAccount" />
              <TextInput label="Code" name="code" required placeholder="e.g. 1125" />
              <TextInput label="Name" name="name" required />
              <FormSelect name="rootType" label="Root type" options={ROOT_TYPES} required />
              <FormSelect
                name="accountType"
                label="Account type (optional)"
                options={[{ value: '', label: 'None' }, ...ACCOUNT_TYPES]}
              />
              <input type="hidden" name="parentAccountId" value={parentId} />
              <SearchableSelect
                label="Parent account (optional)"
                value={parentId}
                onChange={setParentId}
                options={parentOptions}
                clearable
              />
              <label className="flex items-center gap-2 text-sm text-app-fg">
                <input type="checkbox" name="isGroup" value="true" /> This is a group (header) account
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

      {/* Edit Account Modal (name only per FRD) */}
      {editAccount && (
        <Modal open onClose={() => setEditAccount(null)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Edit Account</h2>
            <p className="text-sm text-app-fg-muted">
              {editAccount.code}: only the account name can be changed after creation.
            </p>
            <editFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="updateAccount" />
              <input type="hidden" name="accountId" value={editAccount.id} />
              <TextInput label="Code" value={editAccount.code} disabled />
              <TextInput label="Name" name="name" defaultValue={editAccount.name} required />
              <TextInput label="Root type" value={editAccount.rootType} disabled />
              <TextInput label="Normal balance" value={normalBalance(editAccount.rootType)} disabled />
              {editFetcher.data?.error && (
                <p className="text-sm text-danger-600">{editFetcher.data.error}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setEditAccount(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editFetcher.state !== 'idle'}>
                  {editFetcher.state !== 'idle' ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </editFetcher.Form>
          </div>
        </Modal>
      )}
    </>
  );
}
