import { useEffect, useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
import { Spinner } from '~/components/ui/spinner';
import { TextInput } from '~/components/ui/text-input';
import type { CashLedgerStatement } from '~/features/finance/cash-statement-types';
import {
  buildCashStatementCsvBlob,
  buildCashStatementXlsxBlob,
  cashStatementFilenameBase,
  downloadCashStatementCsv,
  downloadCashStatementXlsx,
  downloadCashStatementZip,
} from '~/lib/cash-statement-export';
import {
  buildCashStatementPdfBlob,
  downloadCashStatementPdf,
} from '~/lib/cash-statement-pdf';
import { formatNaira } from '~/lib/format-amount';

function moneyLabel(value: string): string {
  return formatNaira(Number(value) || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type ExportProgress = {
  label: string;
  /** 0–100 */
  percent: number;
  current: number;
  total: number;
};

/** Let React paint between heavy export steps. */
function yieldUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export type CashStatementLocationOption = {
  id: string;
  name: string;
  providerId?: string | null;
  providerName?: string | null;
};

type StatementApiResponse =
  | { ok: true; statement: CashLedgerStatement; error: null }
  | { ok: false; statement: null; error: string };

type Props = {
  open: boolean;
  onClose: () => void;
  locations: CashStatementLocationOption[];
  /** When set, modal opens in partner scope with this provider preselected. */
  initialProviderId?: string | null;
  /** When set, modal opens in location scope with this location preselected. */
  initialLocationId?: string | null;
  startDate?: string;
  endDate?: string;
  periodAllTime?: boolean;
  dateScope?: 'createdAt' | 'deliveredAt';
};

type SelectOption = { id: string; label: string };

export function CashStatementExportModal({
  open,
  onClose,
  locations,
  initialProviderId = null,
  initialLocationId = null,
  startDate = '',
  endDate = '',
  periodAllTime = false,
  dateScope = 'createdAt',
}: Props) {
  const partners = useMemo((): SelectOption[] => {
    const map = new Map<string, string>();
    for (const loc of locations) {
      if (loc.providerId) map.set(loc.providerId, loc.providerName?.trim() || 'Partner');
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [locations]);

  const locationOptions = useMemo(
    (): SelectOption[] =>
      locations
        .map((loc) => ({
          id: loc.id,
          label: loc.providerName ? `${loc.name} · ${loc.providerName}` : loc.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [locations],
  );

  const [scope, setScope] = useState<'location' | 'partner'>(
    initialProviderId && !initialLocationId ? 'partner' : 'location',
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [listQuery, setListQuery] = useState('');
  const [localDateScope, setLocalDateScope] = useState<'createdAt' | 'deliveredAt'>(dateScope);
  const [busyAction, setBusyAction] = useState<'csv' | 'xlsx' | 'pdf' | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastStatements, setLastStatements] = useState<CashLedgerStatement[]>([]);

  // Reset selection/UI when the modal opens or entry-point prefill changes.
  // Date range comes from the page URL via DateFilterBar — do not reset on date prop churn.
  useEffect(() => {
    if (!open) return;
    const nextScope = initialProviderId && !initialLocationId ? 'partner' : 'location';
    setScope(nextScope);
    if (initialLocationId) setSelectedIds([initialLocationId]);
    else if (initialProviderId) setSelectedIds([initialProviderId]);
    else setSelectedIds([]);
    setListQuery('');
    setLocalDateScope(dateScope);
    setBusyAction(null);
    setProgress(null);
    setActionError(null);
    setLastStatements([]);
  }, [open, initialProviderId, initialLocationId, dateScope]);

  const options = scope === 'location' ? locationOptions : partners;
  const filteredOptions = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, listQuery]);

  const allFilteredSelected =
    filteredOptions.length > 0 && filteredOptions.every((o) => selectedIds.includes(o.id));

  function toggleId(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setLastStatements([]);
  }

  function toggleSelectAllFiltered() {
    setLastStatements([]);
    if (allFilteredSelected) {
      const remove = new Set(filteredOptions.map((o) => o.id));
      setSelectedIds((prev) => prev.filter((id) => !remove.has(id)));
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const o of filteredOptions) next.add(o.id);
      return [...next];
    });
  }

  function buildUrl(id: string): string {
    const params = new URLSearchParams();
    if (scope === 'location') params.set('logisticsLocationId', id);
    else params.set('providerId', id);
    if (!periodAllTime) {
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
    }
    params.set('dateScope', localDateScope);
    return `/api/finance/cash-statement?${params.toString()}`;
  }

  async function handleDownload(kind: 'csv' | 'xlsx' | 'pdf') {
    if (selectedIds.length === 0) return;
    const ids = selectedIds;
    const multi = ids.length > 1;
    // load each + package each + optional zip step
    const totalSteps = ids.length * 2 + (multi ? 1 : 0);
    let step = 0;

    const report = async (label: string, current: number, total: number) => {
      step += 1;
      const percent = Math.min(99, Math.round((step / Math.max(totalSteps, 1)) * 100));
      setProgress({ label, percent, current, total });
      await yieldUi();
    };

    setBusyAction(kind);
    setActionError(null);
    setProgress({
      label: multi ? `Exporting ${ids.length} statements…` : 'Preparing download…',
      percent: 2,
      current: 0,
      total: ids.length,
    });
    await yieldUi();

    try {
      const statements: CashLedgerStatement[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        await report(`Loading statement ${i + 1} of ${ids.length}…`, i + 1, ids.length);
        const res = await fetch(buildUrl(id), { credentials: 'same-origin' });
        const json = (await res.json()) as StatementApiResponse;
        if (!json.ok || !json.statement) {
          throw new Error(json.error || `Failed to load statement ${i + 1}`);
        }
        statements.push(json.statement);
      }
      setLastStatements(statements);

      if (!multi) {
        await report('Building file…', 1, 1);
        const statement = statements[0]!;
        const base = cashStatementFilenameBase(statement);
        if (kind === 'csv') await downloadCashStatementCsv(statement, `${base}.csv`);
        else if (kind === 'xlsx') await downloadCashStatementXlsx(statement, `${base}.xlsx`);
        else await downloadCashStatementPdf(statement, `${base}.pdf`);
        setProgress({ label: 'Download ready', percent: 100, current: 1, total: 1 });
        await yieldUi();
        return;
      }

      const files: Array<{ filename: string; blob: Blob }> = [];
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i]!;
        await report(`Packaging file ${i + 1} of ${statements.length}…`, i + 1, statements.length);
        const base = cashStatementFilenameBase(statement);
        if (kind === 'csv') {
          files.push({ filename: `${base}.csv`, blob: buildCashStatementCsvBlob(statement) });
        } else if (kind === 'xlsx') {
          files.push({
            filename: `${base}.xlsx`,
            blob: await buildCashStatementXlsxBlob(statement),
          });
        } else {
          files.push({
            filename: `${base}.pdf`,
            blob: await buildCashStatementPdfBlob(statement),
          });
        }
      }

      await report(`Building ZIP (${statements.length} files)…`, statements.length, statements.length);
      const start = periodAllTime ? 'all' : startDate || 'start';
      const end = periodAllTime ? 'time' : endDate || 'end';
      const zipName = `cash-statements-${scope}-${start}-${end}-${statements.length}.zip`;
      await downloadCashStatementZip(files, zipName);
      setProgress({
        label: `ZIP ready (${statements.length} statements)`,
        percent: 100,
        current: statements.length,
        total: statements.length,
      });
      await yieldUi();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Download failed');
      setProgress(null);
    } finally {
      setBusyAction(null);
      // Keep the completed bar briefly so the user sees 100%, then clear.
      window.setTimeout(() => {
        setProgress((prev) => (prev?.percent === 100 ? null : prev));
      }, 1200);
    }
  }

  const busy = !!busyAction;

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} maxWidth="max-w-lg" contentClassName="p-0">
      <div className="px-5 py-4 border-b border-app-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-app-fg">Cash statement</h2>
          <p className="text-xs text-app-fg-muted mt-0.5">
            Select one or more locations/partners. Multiple downloads are packed into a ZIP.
          </p>
        </div>
        <button
          type="button"
          onClick={busy ? undefined : onClose}
          className="text-app-fg-muted hover:text-app-fg shrink-0 disabled:opacity-50"
          aria-label="Close"
          disabled={busy}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="space-y-4 px-5 py-4 max-h-[75dvh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setScope('location');
              setSelectedIds(initialLocationId ? [initialLocationId] : []);
              setLastStatements([]);
              setListQuery('');
            }}
            className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              scope === 'location'
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                : 'border-app-border bg-app-elevated text-app-fg hover:border-brand-400'
            }`}
          >
            <span className="font-medium">Location</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setScope('partner');
              setSelectedIds(initialProviderId && !initialLocationId ? [initialProviderId] : []);
              setLastStatements([]);
              setListQuery('');
            }}
            className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
              scope === 'partner'
                ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30 text-brand-700 dark:text-brand-300'
                : 'border-app-border bg-app-elevated text-app-fg hover:border-brand-400'
            }`}
          >
            <span className="font-medium">Partner</span>
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <TextInput
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder={scope === 'location' ? 'Search locations…' : 'Search partners…'}
              className="flex-1"
              disabled={busy}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={busy || filteredOptions.length === 0}
              onClick={toggleSelectAllFiltered}
            >
              {allFilteredSelected ? 'Clear' : 'Select all'}
            </Button>
          </div>
          <div className="rounded-lg border border-app-border max-h-48 overflow-y-auto divide-y divide-app-border">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-sm text-app-fg-muted">No matches.</p>
            ) : (
              filteredOptions.map((opt) => {
                const checked = selectedIds.includes(opt.id);
                return (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-app-fg hover:bg-app-hover/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggleId(opt.id)}
                    />
                    <span className="min-w-0 truncate">{opt.label}</span>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs text-app-fg-muted">
            {selectedIds.length} selected
            {selectedIds.length > 1 ? ' · downloads as ZIP' : ''}
          </p>
        </div>

        <div className="space-y-2">
          <DateFilterBar
            startDate={startDate || undefined}
            endDate={endDate || undefined}
            periodAllTime={periodAllTime}
            chrome="pill"
          />
          <FormSelect
            value={localDateScope}
            onChange={(e) => setLocalDateScope(e.target.value as 'createdAt' | 'deliveredAt')}
            disabled={busy}
          >
            <option value="createdAt">By order date</option>
            <option value="deliveredAt">By delivery date</option>
          </FormSelect>
        </div>

        {actionError && (
          <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
        )}

        {progress && (
          <div
            className="space-y-2 rounded-md border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-800 dark:bg-brand-900/20"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {progress.percent < 100 ? (
                  <Spinner size="sm" className="shrink-0 text-brand-600 dark:text-brand-400" />
                ) : null}
                <p className="truncate text-sm font-medium text-app-fg">{progress.label}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 tabular-nums">
                {progress.percent}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-app-border overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-200 ease-out"
                style={{ width: `${progress.percent}%` }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.percent}
              />
            </div>
            {progress.total > 1 && (
              <p className="text-xs text-app-fg-muted tabular-nums">
                {progress.current} of {progress.total}
              </p>
            )}
          </div>
        )}

        {lastStatements.length === 1 && !progress && (
          <div className="rounded-lg border border-app-border bg-app-hover/40 px-3 py-3 space-y-2 text-sm">
            <div className="font-medium text-app-fg">
              {lastStatements[0]!.header.scope === 'location'
                ? `${lastStatements[0]!.header.providerName} · ${lastStatements[0]!.header.locationName}`
                : `${lastStatements[0]!.header.providerName} (${lastStatements[0]!.locations.length} locations)`}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-app-fg-muted">
              <span>Awaiting</span>
              <span className="text-right text-app-fg">
                {moneyLabel(lastStatements[0]!.summary.awaitingCash)} ({lastStatements[0]!.summary.awaitingCount})
              </span>
              <span>Pending</span>
              <span className="text-right text-app-fg">
                {moneyLabel(lastStatements[0]!.summary.pendingCash)} ({lastStatements[0]!.summary.pendingCount})
              </span>
              <span>Remitted</span>
              <span className="text-right text-app-fg">
                {moneyLabel(lastStatements[0]!.summary.remittedCash)} ({lastStatements[0]!.summary.remittedCount})
              </span>
              <span>Net owed</span>
              <span className="text-right font-medium text-app-fg">
                {moneyLabel(lastStatements[0]!.summary.netOwedToFinance)}
              </span>
            </div>
          </div>
        )}

        {lastStatements.length > 1 && !progress && (
          <div className="rounded-lg border border-app-border bg-app-hover/40 px-3 py-3 text-sm text-app-fg-muted">
            Last export: {lastStatements.length} statements packed into a ZIP.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={selectedIds.length === 0 || busy}
            onClick={() => void handleDownload('csv')}
          >
            {busyAction === 'csv'
              ? 'Exporting…'
              : selectedIds.length > 1
                ? 'Download CSV ZIP'
                : 'Download CSV'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={selectedIds.length === 0 || busy}
            onClick={() => void handleDownload('xlsx')}
          >
            {busyAction === 'xlsx'
              ? 'Exporting…'
              : selectedIds.length > 1
                ? 'Download XLSX ZIP'
                : 'Download XLSX'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={selectedIds.length === 0 || busy}
            onClick={() => void handleDownload('pdf')}
          >
            {busyAction === 'pdf'
              ? 'Exporting…'
              : selectedIds.length > 1
                ? 'Download PDF ZIP'
                : 'Download PDF'}
          </Button>
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
