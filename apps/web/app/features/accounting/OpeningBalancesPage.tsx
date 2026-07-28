import { useMemo, useState } from 'react';
import { Link, useFetcher, useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { DateInput } from '~/components/ui/date-input';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { NumberInput } from '~/components/ui/number-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherToast } from '~/components/ui/toast';

export interface OpeningBalancesPageProps {
  accounts: Array<{ id: string; code: string; name: string; isGroup: boolean; rootType: string }>;
  alreadyPosted?: boolean;
  postedDate?: string | null;
  postedLines?: Array<{ accountId: string; debit: number; credit: number }>;
}

interface AmountDraft {
  debit: number | null;
  credit: number | null;
}

const toMinor = (v: number | null) => Math.round((v ?? 0) * 100);

const ROOT_TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
const ROOT_TYPE_LABEL: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

function displayName(name: string) {
  return name.replace(/\s*[—–]\s*/g, ' · ');
}

export function OpeningBalancesPage({
  accounts,
  alreadyPosted = false,
  postedDate,
  postedLines = [],
}: OpeningBalancesPageProps) {
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data);

  const today = new Date().toISOString().slice(0, 10);
  const [postingDate, setPostingDate] = useState(postedDate ?? today);
  const [search, setSearch] = useState('');
  const [rootTypeFilter, setRootTypeFilter] = useState('');
  const [amounts, setAmounts] = useState<Record<string, AmountDraft>>(() => {
    // Pre-fill from posted lines if already posted
    const initial: Record<string, AmountDraft> = {};
    for (const line of postedLines) {
      if (line.debit > 0 || line.credit > 0) {
        initial[line.accountId] = { debit: line.debit || null, credit: line.credit || null };
      }
    }
    return initial;
  });
  const [showPostConfirm, setShowPostConfirm] = useState(false);

  useCloseOnFetcherSuccess(fetcher, () => {
    setShowPostConfirm(false);
    navigate('/admin/accounting/accounts');
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() =>
    alreadyPosted ? new Set(ROOT_TYPE_ORDER) : new Set(['ASSET']),
  );

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const [onlyWithValues, setOnlyWithValues] = useState(alreadyPosted);

  const postable = useMemo(() => accounts.filter((a) => !a.isGroup), [accounts]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, typeof postable>();
    for (const rt of ROOT_TYPE_ORDER) {
      if (rootTypeFilter && rt !== rootTypeFilter) continue;
      let list = postable.filter((a) => a.rootType === rt);
      if (q) list = list.filter((a) => `${a.code} ${a.name}`.toLowerCase().includes(q));
      if (onlyWithValues) list = list.filter((a) => (amounts[a.id]?.debit ?? 0) > 0 || (amounts[a.id]?.credit ?? 0) > 0);
      if (list.length > 0) map.set(rt, list);
    }
    return map;
  }, [postable, search, rootTypeFilter, onlyWithValues, amounts]);

  const totalDebitMinor = Object.values(amounts).reduce((s, a) => s + toMinor(a.debit), 0);
  const totalCreditMinor = Object.values(amounts).reduce((s, a) => s + toMinor(a.credit), 0);
  const residualMinor = totalDebitMinor - totalCreditMinor;
  const hasAny = totalDebitMinor > 0 || totalCreditMinor > 0;
  const lineCount = Object.values(amounts).filter((a) => (a.debit ?? 0) > 0 || (a.credit ?? 0) > 0).length;

  const setAmt = (id: string, side: 'debit' | 'credit', value: number | null) => {
    setAmounts((prev) => ({
      ...prev,
      [id]: side === 'debit' ? { debit: value, credit: null } : { debit: null, credit: value },
    }));
  };

  const submit = () => {
    const lines = Object.entries(amounts)
      .map(([accountId, a]) => ({ accountId, debit: a.debit ?? 0, credit: a.credit ?? 0 }))
      .filter((l) => l.debit > 0 || l.credit > 0);
    if (lines.length === 0) return;
    fetcher.submit(
      { intent: 'postOpening', payload: JSON.stringify({ postingDate, lines }) },
      { method: 'post' },
    );
    // Modal closes via useCloseOnFetcherSuccess on success, or stays open on error
  };

  /** Count entries for a group */
  const groupEntryCount = (rootType: string) => {
    const accts = grouped.get(rootType) ?? [];
    return accts.filter((a) => (amounts[a.id]?.debit ?? 0) > 0 || (amounts[a.id]?.credit ?? 0) > 0).length;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={alreadyPosted ? 'Opening Balances' : 'Post Opening Balances'}
        backTo="/admin/accounting/accounts"
        description={alreadyPosted ? 'Opening balances posted on ' + (postedDate ?? 'unknown date') + '.' : 'Enter each account\'s balance at go-live. Any residual posts to Opening Balance Equity.'}
        actions={
          alreadyPosted ? (
            <div className="hidden md:flex">
              <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/admin/accounting/accounts')}>
                Back to Accounts
              </Button>
            </div>
          ) : (
            <PageHeaderMobileTools
              sheetTitle="Actions"
              triggerAriaLabel="Opening balances tools"
              desktop={
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/admin/accounting/accounts')}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={() => setShowPostConfirm(true)} disabled={!hasAny || fetcher.state !== 'idle'}>
                    {fetcher.state !== 'idle' ? 'Posting…' : 'Post'}
                  </Button>
                </div>
              }
              sheet={
                <>
                  <Button type="button" className="w-full" variant="secondary" onClick={() => navigate('/admin/accounting/accounts')}>
                    Cancel
                  </Button>
                  <Button type="button" className="w-full" onClick={() => setShowPostConfirm(true)} disabled={!hasAny || fetcher.state !== 'idle'}>
                    {fetcher.state !== 'idle' ? 'Posting…' : 'Post Opening Balances'}
                  </Button>
                </>
              }
            />
          )
        }
      />

      {!alreadyPosted && <MobileDateFilterRow hideDate />}

      {alreadyPosted && (
        <div className="rounded-lg border border-success-200 dark:border-success-800 bg-success-50/60 dark:bg-success-900/20 px-4 py-3">
          <p className="text-sm font-medium text-success-800 dark:text-success-200">Opening balances posted (cutover date: {postedDate})</p>
          <p className="text-xs text-success-700 dark:text-success-300 mt-0.5">
            These values are read-only. If you need to correct them, find the "Opening balances (cutover)" entry in{' '}
            <Link to="/admin/accounting/journal-entries" className="underline font-medium">Journal Entries</Link>
            , reverse it, then post new opening balances.
          </p>
        </div>
      )}

      {/* Date + search + filter controls */}
      <div className="flex flex-wrap items-end gap-3">
        {!alreadyPosted && (
          <DateInput label="Cutover date" value={postingDate} onChange={(e) => setPostingDate(e.target.value)} wrapperClassName="w-44" />
        )}
        <FormSelect
          label="Account type"
          value={rootTypeFilter}
          onChange={(e) => setRootTypeFilter(e.target.value)}
          options={[
            { value: '', label: 'All types' },
            { value: 'ASSET', label: 'Assets' },
            { value: 'LIABILITY', label: 'Liabilities' },
            { value: 'EQUITY', label: 'Equity' },
            { value: 'INCOME', label: 'Income' },
            { value: 'EXPENSE', label: 'Expense' },
          ]}
          wrapperClassName="w-40"
        />
        <div className="flex-1 min-w-[10rem]">
          <TextInput label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code or name" />
        </div>
        <label className="flex items-center gap-2 text-sm text-app-fg cursor-pointer pb-2">
          <input
            type="checkbox"
            checked={onlyWithValues}
            onChange={(e) => setOnlyWithValues(e.target.checked)}
            className="rounded border-app-border text-brand-600 focus:ring-brand-500"
          />
          With values only
        </label>
      </div>

      {/* Grouped accordion */}
      <div className="space-y-2">
        {[...grouped.entries()].map(([rootType, accts]) => {
          const isExpanded = expandedGroups.has(rootType);
          const entryCount = groupEntryCount(rootType);
          return (
            <div key={rootType} className="card !p-0 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleGroup(rootType)}
                className="w-full flex items-center justify-between px-4 py-3 bg-app-hover/50 hover:bg-app-hover transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-4 h-4 text-app-fg-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <span className="text-sm font-semibold text-app-fg">
                    {ROOT_TYPE_LABEL[rootType] ?? rootType}
                  </span>
                  <span className="text-xs text-app-fg-muted">
                    {accts.length} account{accts.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {entryCount > 0 && (
                  <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
                    {entryCount} entered
                  </span>
                )}
              </button>

              {isExpanded && (
                <>
                  {/* Desktop table */}
                  <div className="hidden md:block">
                    <table className="w-full text-sm">
                      <thead className="bg-app-hover text-xs uppercase text-app-fg-muted">
                        <tr>
                          <th className="px-3 py-1.5 text-left">Account</th>
                          <th className="px-3 py-1.5 text-right w-36">Debit</th>
                          <th className="px-3 py-1.5 text-right w-36">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accts.map((a) => (
                          <tr key={a.id} className="border-t border-app-border">
                            <td className="px-3 py-1 text-xs">
                              <span className="font-mono text-app-fg-muted">{a.code}</span>{' '}
                              <span className="text-app-fg">{displayName(a.name)}</span>
                            </td>
                            <td className="px-3 py-1">
                              <NumberInput
                                value={amounts[a.id]?.debit ?? null}
                                onValueChange={(v) => setAmt(a.id, 'debit', v)}
                                onValueCleared={() => setAmt(a.id, 'debit', null)}
                                coerce="decimal" commitOnChange allowEmpty useGrouping min={0}
                                placeholder="₦ 0" controlSize="sm" className="text-right tabular-nums" wrapperClassName="ml-auto w-28"
                              />
                            </td>
                            <td className="px-3 py-1">
                              <NumberInput
                                value={amounts[a.id]?.credit ?? null}
                                onValueChange={(v) => setAmt(a.id, 'credit', v)}
                                onValueCleared={() => setAmt(a.id, 'credit', null)}
                                coerce="decimal" commitOnChange allowEmpty useGrouping min={0}
                                placeholder="₦ 0" controlSize="sm" className="text-right tabular-nums" wrapperClassName="ml-auto w-28"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile cards */}
                  <div className="md:hidden divide-y divide-app-border">
                    {accts.map((a) => (
                      <div key={a.id} className="px-4 py-2.5 space-y-2">
                        <p className="text-sm text-app-fg">
                          <span className="text-xs font-mono text-app-fg-muted">{a.code}</span>{' '}
                          {displayName(a.name)}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-app-fg-muted mb-0.5 block">Debit</label>
                            <NumberInput
                              value={amounts[a.id]?.debit ?? null}
                              onValueChange={(v) => setAmt(a.id, 'debit', v)}
                              onValueCleared={() => setAmt(a.id, 'debit', null)}
                              coerce="decimal" commitOnChange allowEmpty useGrouping min={0}
                              placeholder="₦ 0" controlSize="sm" className="text-right tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-app-fg-muted mb-0.5 block">Credit</label>
                            <NumberInput
                              value={amounts[a.id]?.credit ?? null}
                              onValueChange={(v) => setAmt(a.id, 'credit', v)}
                              onValueCleared={() => setAmt(a.id, 'credit', null)}
                              coerce="decimal" commitOnChange allowEmpty useGrouping min={0}
                              placeholder="₦ 0" controlSize="sm" className="text-right tabular-nums"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Totals bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-app-border bg-app-hover px-4 py-2.5 text-sm">
        <div className="flex gap-4">
          <span>Debit <NairaPrice amount={totalDebitMinor / 100} className="ml-1 font-semibold text-danger-600 dark:text-danger-400" /></span>
          <span>Credit <NairaPrice amount={totalCreditMinor / 100} className="ml-1 font-semibold text-success-600 dark:text-success-400" /></span>
        </div>
        <span className="text-xs text-app-fg-muted">
          {residualMinor === 0 ? 'Balanced' : `Residual ${(Math.abs(residualMinor) / 100).toLocaleString('en-US')} → Equity`}
        </span>
      </div>

      {fetcher.data?.error && <p className="text-sm text-danger-600">{fetcher.data.error}</p>}

      {/* Mobile post button */}
      {!alreadyPosted && (
        <div className="md:hidden">
          <Button type="button" className="w-full" onClick={() => setShowPostConfirm(true)} disabled={!hasAny || fetcher.state !== 'idle'}>
            {fetcher.state !== 'idle' ? 'Posting…' : 'Post Opening Balances'}
          </Button>
        </div>
      )}

      <ConfirmActionModal
        open={showPostConfirm}
        onClose={() => setShowPostConfirm(false)}
        title="Post opening balances"
        description={`Post ${lineCount} account line${lineCount === 1 ? '' : 's'} as of ${postingDate}? This creates a journal entry in the general ledger.`}
        details={
          <ul className="list-disc pl-4 space-y-1 text-sm">
            <li>Debit <NairaPrice amount={totalDebitMinor / 100} /> · Credit <NairaPrice amount={totalCreditMinor / 100} /></li>
            {residualMinor !== 0 ? (
              <li>Residual of {(Math.abs(residualMinor) / 100).toLocaleString('en-US')} posts to Opening Balance Equity</li>
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
