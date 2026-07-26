import { useMemo, useState, useCallback } from 'react';
import { Link, useFetcher, useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { DateInput } from '~/components/ui/date-input';
import { NumberInput } from '~/components/ui/number-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherToast } from '~/components/ui/toast';

export interface JournalEntryCreatePageProps {
  accounts: Array<{ id: string; code: string; name: string; isGroup: boolean }>;
}

interface LineDraft {
  key: string;
  accountId: string;
  debit: number | null;
  credit: number | null;
}

const toMinor = (v: number | null) => Math.round((v ?? 0) * 100);
let lineSeq = 0;
const newLine = (): LineDraft => ({ key: `l${lineSeq++}`, accountId: '', debit: null, credit: null });

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
        .map((a) => ({
          value: a.id,
          label: `${a.code} · ${a.name.replace(/\s*[—–]\s*/g, ' · ')}`,
        })),
    [accounts],
  );

  const totalDebitMinor = lines.reduce((s, l) => s + toMinor(l.debit), 0);
  const totalCreditMinor = lines.reduce((s, l) => s + toMinor(l.credit), 0);
  const balanced = totalDebitMinor === totalCreditMinor && totalDebitMinor > 0;
  const allLinesValid = lines.every(
    (l) => l.accountId && (toMinor(l.debit) > 0) !== (toMinor(l.credit) > 0),
  );
  const busy = fetcher.state !== 'idle';
  const canSubmit = balanced && allLinesValid && lines.length >= 2 && !!description.trim() && !busy;

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
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
      })),
    };
    fetcher.submit(
      { intent: 'createEntry', payload: JSON.stringify(payload) },
      { method: 'post' },
    );
  };

  const blockingIssues: string[] = [];
  if (!description.trim()) blockingIssues.push('Enter a description');
  if (lines.length < 2) blockingIssues.push('Add at least two lines');
  if (!allLinesValid) {
    blockingIssues.push('Each line needs an account and either a debit or a credit (not both)');
  }
  if (totalDebitMinor > 0 || totalCreditMinor > 0) {
    if (!balanced) {
      blockingIssues.push(
        `Debits and credits must match (off by ${((Math.abs(totalDebitMinor - totalCreditMinor)) / 100).toLocaleString('en-US')})`,
      );
    }
  } else {
    blockingIssues.push('Enter debit and credit amounts');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Journal Entry"
        description="Post a balanced entry to the general ledger."
        backTo="/admin/finance/journal-entries"
      />

      <div className="card space-y-4">
        <h2 className="text-lg font-semibold text-app-fg">Entry details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DateInput
            label="Posting date"
            value={postingDate}
            onChange={(e) => setPostingDate(e.target.value)}
            required
          />
          <TextInput
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Agent remittance batch AP-2026-06-00001"
            required
          />
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-app-fg">Lines</h2>
          <span className="text-xs text-app-fg-muted">
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="space-y-3">
          <div className="hidden sm:grid grid-cols-[1fr_140px_140px_40px] gap-2 text-xs font-semibold uppercase tracking-wide text-app-fg-muted px-1">
            <span>Account</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
            <span />
          </div>

          {lines.map((line, index) => (
            <div
              key={line.key}
              className="rounded-lg border border-app-border bg-app-canvas/40 p-3 sm:border-0 sm:bg-transparent sm:p-0"
            >
              <p className="mb-2 text-xs font-medium text-app-fg-muted sm:hidden">Line {index + 1}</p>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_40px] gap-2 items-end sm:items-center">
                <div>
                  <span className="mb-1 block text-sm font-medium text-app-fg-muted sm:hidden">Account</span>
                  <SearchableSelect
                    value={line.accountId}
                    onChange={(v) => setLine(line.key, { accountId: v })}
                    options={accountOptions}
                    placeholder="Select account"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-sm font-medium text-app-fg-muted sm:hidden">Debit</span>
                  <NumberInput
                    value={line.debit}
                    onValueChange={(v) => setLine(line.key, { debit: v, credit: null })}
                    onValueCleared={() => setLine(line.key, { debit: null })}
                    coerce="decimal"
                    commitOnChange
                    allowEmpty
                    useGrouping
                    min={0}
                    placeholder="0.00"
                    className="text-right tabular-nums"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-sm font-medium text-app-fg-muted sm:hidden">Credit</span>
                  <NumberInput
                    value={line.credit}
                    onValueChange={(v) => setLine(line.key, { credit: v, debit: null })}
                    onValueCleared={() => setLine(line.key, { credit: null })}
                    coerce="decimal"
                    commitOnChange
                    allowEmpty
                    useGrouping
                    min={0}
                    placeholder="0.00"
                    className="text-right tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length <= 2}
                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                  className="inline-flex h-10 md:h-9 w-full sm:w-10 items-center justify-center rounded-lg text-app-fg-muted hover:bg-danger-50 hover:text-danger-600 disabled:opacity-30 dark:hover:bg-danger-900/20"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, newLine()])}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-lg border-2 border-dashed border-brand-300 dark:border-brand-700 bg-brand-50/50 dark:bg-brand-900/10 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add line
          </button>
        </div>

        <div
          className={[
            'rounded-md px-3 py-2 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4',
            balanced
              ? 'bg-success-50 dark:bg-success-900/20'
              : 'bg-app-hover',
          ].join(' ')}
        >
          <div className="flex flex-col">
            <span className="text-mini uppercase tracking-wide text-app-fg-muted">Total debit</span>
            <span className="text-base font-semibold tabular-nums">
              <NairaPrice amount={totalDebitMinor / 100} />
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-mini uppercase tracking-wide text-app-fg-muted">Total credit</span>
            <span className="text-base font-semibold tabular-nums">
              <NairaPrice amount={totalCreditMinor / 100} />
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-mini uppercase tracking-wide text-app-fg-muted">Status</span>
            <span
              className={[
                'text-base font-semibold',
                balanced
                  ? 'text-success-700 dark:text-success-300'
                  : 'text-warning-700 dark:text-warning-300',
              ].join(' ')}
            >
              {balanced
                ? 'Balanced'
                : `Off by ${((Math.abs(totalDebitMinor - totalCreditMinor)) / 100).toLocaleString('en-US')}`}
            </span>
          </div>
        </div>
      </div>

      {fetcher.data?.error && (
        <p className="text-sm text-danger-600 dark:text-danger-400">{fetcher.data.error}</p>
      )}

      {!canSubmit && !busy && blockingIssues.length > 0 && (
        <div className="rounded-md border border-warning-300 dark:border-warning-700/50 bg-warning-50 dark:bg-warning-900/20 px-3 py-2 text-sm text-warning-800 dark:text-warning-300 space-y-0.5">
          <p className="font-semibold">Cannot post yet:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {blockingIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
        <Link
          to="/admin/finance/journal-entries"
          className="btn-secondary w-full sm:w-auto inline-flex items-center justify-center"
        >
          Cancel
        </Link>
        <Button
          type="button"
          variant="primary"
          className="w-full sm:w-auto"
          onClick={submit}
          disabled={!canSubmit}
          loading={busy}
          loadingText="Posting…"
        >
          Post entry
        </Button>
      </div>
    </div>
  );
}
