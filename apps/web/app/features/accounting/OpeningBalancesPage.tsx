import { useMemo, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { SearchInput } from '~/components/ui/search-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherToast } from '~/components/ui/toast';

export interface OpeningBalancesPageProps {
  accounts: Array<{ id: string; code: string; name: string; isGroup: boolean; rootType: string }>;
}

const toMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);

export function OpeningBalancesPage({ accounts }: OpeningBalancesPageProps) {
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => navigate('/admin/finance/trial-balance'));

  const today = new Date().toISOString().slice(0, 10);
  const [postingDate, setPostingDate] = useState(today);
  const [search, setSearch] = useState('');
  const [amounts, setAmounts] = useState<Record<string, { debit: string; credit: string }>>({});

  const postable = useMemo(
    () => accounts.filter((a) => !a.isGroup),
    [accounts],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return postable;
    return postable.filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q));
  }, [postable, search]);

  const totalDebitMinor = Object.values(amounts).reduce((s, a) => s + toMinor(a.debit), 0);
  const totalCreditMinor = Object.values(amounts).reduce((s, a) => s + toMinor(a.credit), 0);
  const residualMinor = totalDebitMinor - totalCreditMinor;
  const hasAny = totalDebitMinor > 0 || totalCreditMinor > 0;

  const setAmt = (id: string, side: 'debit' | 'credit', value: string) => {
    setAmounts((prev) => ({
      ...prev,
      // Entering one side clears the other (a line is one-sided).
      [id]: side === 'debit' ? { debit: value, credit: '' } : { debit: '', credit: value },
    }));
  };

  const submit = () => {
    const lines = Object.entries(amounts)
      .map(([accountId, a]) => ({
        accountId,
        debit: parseFloat(a.debit) || 0,
        credit: parseFloat(a.credit) || 0,
      }))
      .filter((l) => l.debit > 0 || l.credit > 0);
    if (lines.length === 0) return;
    fetcher.submit(
      { intent: 'postOpening', payload: JSON.stringify({ postingDate, lines }) },
      { method: 'post' },
    );
  };

  return (
    <>
      <PageHeader
        title="Opening Balances"
        description="Enter each account's balance at go-live. Any residual posts to Opening Balance Equity so the entry balances."
        backTo="/admin/finance/trial-balance"
      />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-app-fg">Cutover date</label>
          <input
            type="date"
            value={postingDate}
            onChange={(e) => setPostingDate(e.target.value)}
            className="h-10 rounded-lg border border-app-border bg-app-canvas px-3 text-sm text-app-fg"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter accounts…" />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-app-border">
        <table className="w-full text-sm">
          <thead className="bg-app-hover text-xs uppercase text-app-fg-muted">
            <tr>
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-right w-40">Debit</th>
              <th className="px-3 py-2 text-right w-40">Credit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-t border-app-border">
                <td className="px-3 py-1.5">
                  <span className="font-mono text-xs text-app-fg-muted mr-2">{a.code}</span>
                  {a.name}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amounts[a.id]?.debit ?? ''}
                    onChange={(e) => setAmt(a.id, 'debit', e.target.value)}
                    className="h-8 w-32 rounded border border-app-border bg-app-canvas px-2 text-right tabular-nums"
                  />
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amounts[a.id]?.credit ?? ''}
                    onChange={(e) => setAmt(a.id, 'credit', e.target.value)}
                    className="h-8 w-32 rounded border border-app-border bg-app-canvas px-2 text-right tabular-nums"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-app-border bg-app-hover px-4 py-3 text-sm">
        <div className="flex gap-6">
          <span>Debit <NairaPrice amount={totalDebitMinor / 100} className="ml-1 font-semibold text-app-fg" /></span>
          <span>Credit <NairaPrice amount={totalCreditMinor / 100} className="ml-1 font-semibold text-app-fg" /></span>
        </div>
        <span className="text-app-fg-muted">
          {residualMinor === 0
            ? 'Balanced — no equity plug needed'
            : `Residual ${(Math.abs(residualMinor) / 100).toLocaleString('en-US')} → Opening Balance Equity`}
        </span>
      </div>

      {fetcher.data?.error && <p className="text-sm text-danger-600">{fetcher.data.error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => navigate('/admin/finance/trial-balance')}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={!hasAny || fetcher.state !== 'idle'}>
          {fetcher.state !== 'idle' ? 'Posting…' : 'Post opening balances'}
        </Button>
      </div>
    </>
  );
}
