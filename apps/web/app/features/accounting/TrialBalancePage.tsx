import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  rootType: string;
  debit: number;
  credit: number;
}

export interface TrialBalancePageProps {
  accounts: TrialBalanceRow[];
  totals: { totalDebit: number; totalCredit: number; balanced: boolean };
  filters: { asOfDate: string };
}

const ROOT_LABELS: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

const ROOT_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

export function TrialBalancePage({ accounts, totals, filters }: TrialBalancePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const onAsOfChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('asOfDate', value);
    else next.delete('asOfDate');
    setSearchParams(next);
  };

  const columns: CompactTableColumn<TrialBalanceRow>[] = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono text-xs text-app-fg-muted">{r.code}</span> },
    { key: 'name', header: 'Account', render: (r) => <span className="font-medium text-app-fg">{r.name}</span> },
    {
      key: 'debit',
      header: 'Debit',
      align: 'right',
      render: (r) => <NairaPrice amount={r.debit} zeroAsDash className="tabular-nums" />,
    },
    {
      key: 'credit',
      header: 'Credit',
      align: 'right',
      render: (r) => <NairaPrice amount={r.credit} zeroAsDash className="tabular-nums" />,
    },
  ];

  const grouped = ROOT_ORDER.map((root) => ({
    root,
    label: ROOT_LABELS[root] ?? root,
    rows: accounts.filter((a) => a.rootType === root),
  })).filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        title="Trial Balance"
        description="Every account's net balance, straight from the ledger. Debits must equal credits."
        actions={
          <span
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
              totals.balanced
                ? 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                : 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
            ].join(' ')}
          >
            {totals.balanced ? '✓ Balanced' : '⚠ Out of balance'}
          </span>
        }
      />

      <div className="flex items-center gap-2">
        <label htmlFor="tb-asof" className="text-sm text-app-fg-muted">
          As of
        </label>
        <input
          id="tb-asof"
          type="date"
          value={filters.asOfDate}
          onChange={(e) => onAsOfChange(e.target.value)}
          className="h-10 md:h-9 rounded-lg border border-app-border bg-app-bg px-3 text-sm text-app-fg"
        />
      </div>

      <OverviewStatStrip
        items={[
          { label: 'Total Debit', value: <NairaPrice amount={totals.totalDebit} /> },
          { label: 'Total Credit', value: <NairaPrice amount={totals.totalCredit} /> },
          { label: 'Accounts', value: String(accounts.length) },
        ]}
      />

      {accounts.length === 0 ? (
        <EmptyState
          title="No ledger activity yet"
          description="Post a journal entry to see balances appear here."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => {
            const subDebit = g.rows.reduce((s, r) => s + r.debit, 0);
            const subCredit = g.rows.reduce((s, r) => s + r.credit, 0);
            return (
              <div key={g.root}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-fg-muted">
                  {g.label}
                </h3>
                <CompactTable columns={columns} rows={g.rows} rowKey={(r) => r.accountId} />
                <div className="mt-1 flex justify-end gap-8 pr-4 text-sm font-medium text-app-fg-muted">
                  <span>
                    Subtotal debit <NairaPrice amount={subDebit} className="ml-1 text-app-fg" />
                  </span>
                  <span>
                    credit <NairaPrice amount={subCredit} className="ml-1 text-app-fg" />
                  </span>
                </div>
              </div>
            );
          })}

          <div className="flex justify-end gap-8 border-t-2 border-app-border pt-3 pr-4 text-base font-semibold">
            <span>
              Total debit <NairaPrice amount={totals.totalDebit} className="ml-1" />
            </span>
            <span>
              Total credit <NairaPrice amount={totals.totalCredit} className="ml-1" />
            </span>
          </div>
        </div>
      )}
    </>
  );
}
