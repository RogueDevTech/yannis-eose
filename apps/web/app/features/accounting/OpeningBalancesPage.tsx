import { useMemo, useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { DateInput } from '~/components/ui/date-input';
import { NumberInput } from '~/components/ui/number-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherToast } from '~/components/ui/toast';

export interface OpeningBalancesPageProps {
  accounts: Array<{ id: string; code: string; name: string; isGroup: boolean; rootType: string }>;
}

interface AmountDraft {
  debit: number | null;
  credit: number | null;
}

const toMinor = (v: number | null) => Math.round((v ?? 0) * 100);

export function OpeningBalancesPage({ accounts }: OpeningBalancesPageProps) {
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => navigate('/admin/finance/trial-balance'));

  const today = new Date().toISOString().slice(0, 10);
  const [postingDate, setPostingDate] = useState(today);
  const [search, setSearch] = useState('');
  const [amounts, setAmounts] = useState<Record<string, AmountDraft>>({});
  const [showPostConfirm, setShowPostConfirm] = useState(false);

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

  const setAmt = (id: string, side: 'debit' | 'credit', value: number | null) => {
    setAmounts((prev) => ({
      ...prev,
      // Entering one side clears the other (a line is one-sided).
      [id]: side === 'debit' ? { debit: value, credit: null } : { debit: null, credit: value },
    }));
  };

  const lineCount = Object.values(amounts).filter((a) => (a.debit ?? 0) > 0 || (a.credit ?? 0) > 0).length;

  const submit = () => {
    const lines = Object.entries(amounts)
      .map(([accountId, a]) => ({
        accountId,
        debit: a.debit ?? 0,
        credit: a.credit ?? 0,
      }))
      .filter((l) => l.debit > 0 || l.credit > 0);
    if (lines.length === 0) return;
    fetcher.submit(
      { intent: 'postOpening', payload: JSON.stringify({ postingDate, lines }) },
      { method: 'post' },
    );
    setShowPostConfirm(false);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Opening Balances"
        description="Enter each account's balance at go-live. Any residual posts to Opening Balance Equity so the entry balances."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Opening balances tools"
            filters={
              <>
                <DateInput
                  label="Cutover date"
                  value={postingDate}
                  onChange={(e) => setPostingDate(e.target.value)}
                />
                <PageSearchControl
                  value={search}
                  onApply={setSearch}
                  placeholder="Filter accounts"
                  title="Filter accounts"
                />
              </>
            }
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/admin/finance/trial-balance')}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={() => setShowPostConfirm(true)} disabled={!hasAny || fetcher.state !== 'idle'}>
                  {fetcher.state !== 'idle' ? 'Posting…' : 'Post opening balances'}
                </Button>
              </div>
            }
            sheet={
              <div className="flex flex-col gap-2">
                <Button type="button" variant="secondary" className="w-full" onClick={() => navigate('/admin/finance/trial-balance')}>
                  Cancel
                </Button>
                <Button type="button" className="w-full" onClick={() => setShowPostConfirm(true)} disabled={!hasAny || fetcher.state !== 'idle'}>
                  {fetcher.state !== 'idle' ? 'Posting…' : 'Post opening balances'}
                </Button>
              </div>
            }
          />
        }
      />

      <div className="hidden md:flex flex-wrap items-end gap-3">
        <DateInput
          label="Cutover date"
          value={postingDate}
          onChange={(e) => setPostingDate(e.target.value)}
          wrapperClassName="w-44"
        />
        <PageSearchControl
          value={search}
          onApply={setSearch}
          placeholder="Filter accounts"
          title="Filter accounts"
        />
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
                <td className="px-3 py-1.5 text-app-fg">{a.name.replace(/\s*[—–]\s*/g, ' · ')}</td>
                <td className="px-3 py-1.5">
                  <NumberInput
                    value={amounts[a.id]?.debit ?? null}
                    onValueChange={(v) => setAmt(a.id, 'debit', v)}
                    onValueCleared={() => setAmt(a.id, 'debit', null)}
                    coerce="decimal"
                    commitOnChange
                    allowEmpty
                    useGrouping
                    min={0}
                    controlSize="sm"
                    className="text-right tabular-nums"
                    wrapperClassName="ml-auto w-32"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <NumberInput
                    value={amounts[a.id]?.credit ?? null}
                    onValueChange={(v) => setAmt(a.id, 'credit', v)}
                    onValueCleared={() => setAmt(a.id, 'credit', null)}
                    coerce="decimal"
                    commitOnChange
                    allowEmpty
                    useGrouping
                    min={0}
                    controlSize="sm"
                    className="text-right tabular-nums"
                    wrapperClassName="ml-auto w-32"
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
            ? 'Balanced. No equity plug needed.'
            : `Residual of ${(Math.abs(residualMinor) / 100).toLocaleString('en-US')} posts to Opening Balance Equity`}
        </span>
      </div>

      {fetcher.data?.error && <p className="text-sm text-danger-600">{fetcher.data.error}</p>}

      <div className="hidden md:flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => navigate('/admin/finance/trial-balance')}>
          Cancel
        </Button>
        <Button type="button" onClick={() => setShowPostConfirm(true)} disabled={!hasAny || fetcher.state !== 'idle'}>
          {fetcher.state !== 'idle' ? 'Posting…' : 'Post opening balances'}
        </Button>
      </div>

      <ConfirmActionModal
        open={showPostConfirm}
        onClose={() => setShowPostConfirm(false)}
        title="Post opening balances"
        description={`Post ${lineCount} account line${lineCount === 1 ? '' : 's'} as of ${postingDate}? This creates a journal entry in the general ledger.`}
        details={
          <ul className="list-disc pl-4 space-y-1 text-sm">
            <li>
              Debit <NairaPrice amount={totalDebitMinor / 100} /> · Credit{' '}
              <NairaPrice amount={totalCreditMinor / 100} />
            </li>
            {residualMinor !== 0 ? (
              <li>
                Residual of {(Math.abs(residualMinor) / 100).toLocaleString('en-US')} posts to Opening Balance Equity
              </li>
            ) : (
              <li>Entry is balanced</li>
            )}
          </ul>
        }
        confirmLabel="Post opening balances"
        variant="warning"
        loading={fetcher.state !== 'idle'}
        onConfirm={submit}
      />
    </div>
  );
}
