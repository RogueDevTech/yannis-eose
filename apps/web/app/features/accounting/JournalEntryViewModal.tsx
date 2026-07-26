import { useEffect, useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Spinner } from '~/components/ui/spinner';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { DateTimeText } from '~/components/ui/date-time-text';
import { formatDateOnly } from '~/lib/format-date';

export interface JournalEntryViewSummary {
  id: string;
  entryNumber: number;
  postingDate: string;
  createdAt?: string | null;
  description: string;
  totalDebit: string;
  status: string;
}

interface JournalEntryLine {
  id: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

interface JournalEntryDetail extends JournalEntryViewSummary {
  lines: JournalEntryLine[];
}

type TrpcEnvelope<T> = { result?: { data?: T } };

async function fetchJournalEntry(journalEntryId: string): Promise<JournalEntryDetail | null> {
  const base = getBrowserApiBaseUrl();
  if (!base) return null;
  const input = encodeURIComponent(JSON.stringify({ journalEntryId }));
  try {
    const res = await fetch(`${base}/trpc/generalLedger.getJournalEntry?input=${input}`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as TrpcEnvelope<JournalEntryDetail>;
    return json.result?.data ?? null;
  } catch {
    return null;
  }
}

export function JournalEntryViewModal({
  entry,
  onClose,
}: {
  entry: JournalEntryViewSummary | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<JournalEntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchJournalEntry(entry.id).then((data) => {
      if (cancelled) return;
      if (!data) {
        setError('Could not load journal entry details.');
        setLoading(false);
        return;
      }
      setDetail(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (!entry) return null;

  const lines = detail?.lines ?? [];
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-app-fg">
              Journal Entry #{entry.entryNumber}
            </h2>
            <p className="mt-0.5 text-sm text-app-fg-muted break-words">{entry.description}</p>
          </div>
          <StatusBadge status={entry.status} />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-app-fg-muted">Posting date</dt>
            <dd className="font-medium text-app-fg">{formatDateOnly(entry.postingDate)}</dd>
          </div>
          <div>
            <dt className="text-app-fg-muted">Recorded</dt>
            <dd className="font-medium">
              <DateTimeText at={entry.createdAt ?? detail?.createdAt} />
            </dd>
          </div>
          <div>
            <dt className="text-app-fg-muted">Amount</dt>
            <dd className="font-medium text-app-fg">
              <NairaPrice amount={entry.totalDebit} />
            </dd>
          </div>
          <div>
            <dt className="text-app-fg-muted">Lines</dt>
            <dd className="font-medium text-app-fg">{loading ? '…' : lines.length}</dd>
          </div>
        </dl>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-app-fg-muted">
            <Spinner size="sm" /> Loading lines…
          </div>
        )}

        {error && <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}

        {!loading && !error && (
          <div className="overflow-x-auto rounded-lg border border-app-border">
            <table className="w-full text-sm">
              <thead className="bg-app-hover text-xs uppercase text-app-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Account</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-app-fg-muted">
                      No lines found.
                    </td>
                  </tr>
                ) : (
                  lines.map((line) => (
                    <tr key={line.id} className="border-t border-app-border">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-app-fg-muted">{line.accountCode}</span>
                        <span className="ml-2 text-app-fg">
                          {line.accountName.replace(/\s*[—–]\s*/g, ' · ')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(line.debit) > 0 ? <NairaPrice amount={line.debit} /> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(line.credit) > 0 ? <NairaPrice amount={line.credit} /> : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-app-border font-semibold">
                    <td className="px-3 py-2 text-app-fg-muted">Total</td>
                    <td className="px-3 py-2 text-right">
                      <NairaPrice amount={totalDebit} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <NairaPrice amount={totalCredit} />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
