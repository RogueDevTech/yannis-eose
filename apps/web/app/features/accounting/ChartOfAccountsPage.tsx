import { useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { NairaPrice } from '~/components/ui/naira-price';
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
  // Any orphaned rows (parent not in set) still appear at depth 0.
  const seen = new Set(out.map((o) => o.id));
  for (const a of accounts) if (!seen.has(a.id)) out.push({ ...a, depth: 0 });
  return out;
}

export function ChartOfAccountsPage({ accounts, canWrite }: ChartOfAccountsPageProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [parentId, setParentId] = useState('');
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();

  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => {
    setCreateOpen(false);
    setParentId('');
  });

  const tree = useMemo(() => toTree(accounts), [accounts]);
  const parentOptions = useMemo(
    () => accounts.filter((a) => a.isGroup).map((a) => ({ value: a.id, label: `${a.code}` })),
    [accounts],
  );

  const columns: CompactTableColumn<AccountRow & { depth: number }>[] = [
    {
      key: 'name',
      header: 'Account',
      render: (r) => (
        <span style={{ paddingLeft: `${r.depth * 16}px` }} className="flex items-center gap-2">
          <span className={r.isGroup ? 'font-semibold text-app-fg' : 'text-app-fg'}>{r.name}</span>
          {r.isGroup && (
            <span className="rounded bg-app-hover px-1.5 py-0.5 text-[10px] uppercase text-app-fg-muted">
              group
            </span>
          )}
        </span>
      ),
    },
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono text-xs text-app-fg-muted">{r.code}</span>, hideOnMobile: true },
    { key: 'type', header: 'Type', render: (r) => <span className="text-xs text-app-fg-muted">{r.accountType?.replace(/_/g, ' ') ?? '—'}</span>, hideOnMobile: true },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      render: (r) => (r.isGroup ? <span className="text-app-fg-muted">—</span> : <NairaPrice amount={r.balance} zeroAsDash />),
    },
  ];

  const groupCount = accounts.filter((a) => a.isGroup).length;

  return (
    <>
      <PageHeader
        title="Chart of Accounts"
        description="The account tree your double-entry ledger posts against."
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
          { label: 'Accounts', value: String(accounts.length) },
          { label: 'Groups', value: String(groupCount) },
          { label: 'Postable', value: String(accounts.length - groupCount) },
        ]}
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="The chart of accounts seeds automatically on server boot. Create one manually if needed."
        />
      ) : (
        <CompactTable columns={columns} rows={tree} rowKey={(r) => r.id} />
      )}

      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">New Account</h2>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="createAccount" />
              <div>
                <label className="mb-1 block text-sm font-medium text-app-fg">Code</label>
                <input name="code" required className="w-full h-10 rounded-lg border border-app-border bg-app-bg px-3 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-app-fg">Name</label>
                <input name="name" required className="w-full h-10 rounded-lg border border-app-border bg-app-bg px-3 text-sm" />
              </div>
              <FormSelect name="rootType" label="Root type" options={ROOT_TYPES} required />
              <FormSelect
                name="accountType"
                label="Account type (optional)"
                options={[{ value: '', label: '— none —' }, ...ACCOUNT_TYPES]}
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
              {fetcher.data?.error && (
                <p className="text-sm text-danger-600">{fetcher.data.error}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={fetcher.state !== 'idle'}>
                  {fetcher.state !== 'idle' ? 'Saving…' : 'Create'}
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </Modal>
      )}
    </>
  );
}
