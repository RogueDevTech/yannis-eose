import { useMemo, useState, useCallback } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { NairaPrice } from '~/components/ui/naira-price';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherToast } from '~/components/ui/toast';

export interface JournalEntryCreatePageProps {
  accounts: Array<{ id: string; code: string; name: string; isGroup: boolean }>;
}

interface LineDraft {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
}

const toMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);
let lineSeq = 0;
const newLine = (): LineDraft => ({ key: `l${lineSeq++}`, accountId: '', debit: '', credit: '' });

export function JournalEntryCreatePage({ accounts }: JournalEntryCreatePageProps) {
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => navigate('/admin/finance/journal-entries'));

  const today = new Date().toISOString().slice(0, 10);
  const [postingDate, setPostingDate] = useState(today);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine(), newLine()]);

  const accountOptions = useMemo(
    () =>
      accounts
        .filter((a) => !a.isGroup)
        .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` })),
    [accounts],
  );

  const totalDebitMinor = lines.reduce((s, l) => s + toMinor(l.debit), 0);
  const totalCreditMinor = lines.reduce((s, l) => s + toMinor(l.credit), 0);
  const balanced = totalDebitMinor === totalCreditMinor && totalDebitMinor > 0;
  const allLinesValid = lines.every(
    (l) => l.accountId && (toMinor(l.debit) > 0) !== (toMinor(l.credit) > 0),
  );
  const canSubmit = balanced && allLinesValid && lines.length >= 2 && !!description.trim() && fetcher.state === 'idle';

  const setLine = useCallback((key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const submit = () => {
    if (!canSubmit) return;
    const payload = {
      postingDate,
      description: description.trim(),
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
      })),
    };
    fetcher.submit(
      { intent: 'createEntry', payload: JSON.stringify(payload) },
      { method: 'post' },
    );
  };

  return (
    <>
      <PageHeader title="New Journal Entry" backTo="/admin/finance/journal-entries" />

      <div className="space-y-4 max-w-3xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg">Posting date</label>
            <input
              type="date"
              value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)}
              className="w-full h-10 rounded-lg border border-app-border bg-app-bg px-3 text-sm text-app-fg"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Agent remittance — batch AP-2026-06-00001"
              className="w-full h-10 rounded-lg border border-app-border bg-app-bg px-3 text-sm text-app-fg"
            />
          </div>
        </div>

        {/* Lines editor */}
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[1fr_140px_140px_40px] gap-2 text-xs font-semibold uppercase tracking-wide text-app-fg-muted px-1">
            <span>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
            <span />
          </div>
          {lines.map((line) => (
            <div key={line.key} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_40px] gap-2 items-center">
              <SearchableSelect
                value={line.accountId}
                onChange={(v) => setLine(line.key, { accountId: v })}
                options={accountOptions}
                placeholder="Select account"
              />
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={line.debit}
                onChange={(e) => setLine(line.key, { debit: e.target.value, credit: '' })}
                placeholder="0.00"
                className="h-10 rounded-lg border border-app-border bg-app-bg px-3 text-sm text-right tabular-nums"
              />
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={line.credit}
                onChange={(e) => setLine(line.key, { credit: e.target.value, debit: '' })}
                placeholder="0.00"
                className="h-10 rounded-lg border border-app-border bg-app-bg px-3 text-sm text-right tabular-nums"
              />
              <button
                type="button"
                aria-label="Remove line"
                disabled={lines.length <= 2}
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                className="h-10 rounded-lg text-app-fg-muted hover:text-danger-600 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
            + Add line
          </Button>
        </div>

        {/* Balance indicator */}
        <div
          className={[
            'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
            balanced
              ? 'border-success-200 bg-success-50 dark:border-success-800 dark:bg-success-900/20'
              : 'border-warning-200 bg-warning-50 dark:border-warning-800 dark:bg-warning-900/20',
          ].join(' ')}
        >
          <div className="flex gap-6">
            <span>
              Debit <NairaPrice amount={totalDebitMinor / 100} className="ml-1 font-semibold text-app-fg" />
            </span>
            <span>
              Credit <NairaPrice amount={totalCreditMinor / 100} className="ml-1 font-semibold text-app-fg" />
            </span>
          </div>
          <span className={balanced ? 'font-semibold text-success-700 dark:text-success-300' : 'font-semibold text-warning-700 dark:text-warning-300'}>
            {balanced ? '✓ Balanced' : `Off by ${((totalDebitMinor - totalCreditMinor) / 100).toLocaleString('en-US')}`}
          </span>
        </div>

        {fetcher.data?.error && <p className="text-sm text-danger-600">{fetcher.data.error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => navigate('/admin/finance/journal-entries')}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {fetcher.state !== 'idle' ? 'Posting…' : 'Post entry'}
          </Button>
        </div>
      </div>
    </>
  );
}
