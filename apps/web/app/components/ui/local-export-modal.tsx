import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import jsPDF from 'jspdf';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { FormSelect } from './form-select';
import { Modal } from './modal';

type LocalExportColumn = { key: string; label: string };

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  rows: Array<Record<string, unknown>>;
  columns: LocalExportColumn[];
  defaultColumns: string[];
  filenamePrefix: string;
  /** When provided, fetches all rows on export instead of using the `rows` prop.
   *  Use when `rows` is paginated and the export should include everything. */
  fetchAllRows?: () => Promise<Array<Record<string, unknown>>>;
  /** Total row count for display when fetchAllRows is provided. */
  totalRows?: number;
  /** Optional filter controls rendered above the format/columns section. The
   *  page owns this UI and its state, and should wire the chosen values into
   *  `fetchAllRows` so the export reflects them. */
  filters?: ReactNode;
};

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(rows: Array<Record<string, unknown>>, columns: LocalExportColumn[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(','));
  return [header, ...body].join('\n');
}

function triggerBlobDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, csv: string) {
  triggerBlobDownload(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

function downloadPdf(filename: string, csv: string) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = 16;
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  for (const line of csv.split('\n')) {
    const safeLine = line.length > 220 ? `${line.slice(0, 220)}...` : line;
    if (y > 192) {
      doc.addPage();
      y = 16;
    }
    doc.text(safeLine, margin, y, { maxWidth: pageWidth - margin * 2 });
    y += 5;
  }
  doc.save(filename.replace(/\.csv$/i, '.pdf'));
}

async function downloadXlsx(filename: string, csv: string) {
  const xlsx = await import('xlsx');
  const wb = xlsx.read(csv, { type: 'string' });
  const bytes = xlsx.write(wb, { type: 'array', bookType: 'xlsx' });
  triggerBlobDownload(
    filename.replace(/\.csv$/i, '.xlsx'),
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

/** Ready-to-download report, held between the "Generate" and "Download" steps. */
type ExportPreview = {
  filename: string;
  csv: string;
  format: 'csv' | 'pdf' | 'xlsx';
  rowCount: number;
  columnCount: number;
};

export function LocalExportModal({ open, onClose, title, description, rows, columns, defaultColumns, filenamePrefix, fetchAllRows, totalRows, filters }: Props) {
  const [format, setFormat] = useState<'csv' | 'pdf' | 'xlsx'>('csv');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(defaultColumns);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fake, eased progress: the work is client-side (fetch → build CSV) with no
  // real byte-level signal, so we crawl toward 95% and snap to 100% on finish.
  const [simulatedPct, setSimulatedPct] = useState(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ready report, shown on the "Report Ready" step before the actual download.
  const [preview, setPreview] = useState<ExportPreview | null>(null);

  const clearProgressInterval = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setFormat('csv');
    setSelectedColumns(defaultColumns);
    setExporting(false);
    setError(null);
    setPreview(null);
    setSimulatedPct(0);
    clearProgressInterval();
  }, [open, defaultColumns, clearProgressInterval]);

  useEffect(() => () => clearProgressInterval(), [clearProgressInterval]);

  const selectedColumnDefs = useMemo(
    () => columns.filter((c) => selectedColumns.includes(c.key)),
    [columns, selectedColumns],
  );

  const canGenerate = selectedColumnDefs.length > 0 && !exporting;

  const startSimulatedProgress = () => {
    setSimulatedPct(0);
    clearProgressInterval();
    progressInterval.current = setInterval(() => {
      setSimulatedPct((prev) => {
        if (prev < 60) return prev + 3;
        if (prev < 85) return prev + 1;
        if (prev < 95) return prev + 0.3;
        return prev;
      });
    }, 200);
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setExporting(true);
    setError(null);
    startSimulatedProgress();
    try {
      const exportRows = fetchAllRows ? await fetchAllRows() : rows;
      const csv = buildCsv(exportRows, selectedColumnDefs);
      const date = new Date().toISOString().split('T')[0] ?? 'export';
      const filename = `${filenamePrefix}-${date}.csv`;
      clearProgressInterval();
      setSimulatedPct(100);
      // Show the "Report Ready" step (stats + download) instead of auto-downloading.
      setPreview({ filename, csv, format, rowCount: exportRows.length, columnCount: selectedColumnDefs.length });
    } catch (err) {
      // Surface the failure instead of silently doing nothing (the old bare
      // try/finally swallowed fetch/serialization errors, so the button just
      // reset and no file downloaded).
      clearProgressInterval();
      setSimulatedPct(0);
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownload = async () => {
    if (!preview) return;
    try {
      if (preview.format === 'csv') {
        downloadCsv(preview.filename, preview.csv);
      } else if (preview.format === 'pdf') {
        downloadPdf(preview.filename, preview.csv);
      } else {
        await downloadXlsx(preview.filename, preview.csv);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    }
  };

  // Report Ready step — compact summary before the actual download.
  if (preview) {
    const fileSizeKb = Math.round(new Blob([preview.csv]).size / 1024);
    return (
      <Modal open={open} onClose={onClose} maxWidth="max-w-sm" contentClassName="p-6 space-y-5">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-success-100 dark:bg-success-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-success-600 dark:text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-app-fg">Report Ready</h3>
          <p className="text-sm text-app-fg-muted">
            {preview.filename.replace(/\.csv$/i, preview.format === 'csv' ? '.csv' : `.${preview.format}`)}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 text-center">
            <p className="text-lg font-bold tabular-nums text-app-fg">{preview.rowCount.toLocaleString()}</p>
            <p className="text-micro font-medium uppercase tracking-wider text-app-fg-muted mt-0.5">Rows</p>
          </div>
          <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 text-center">
            <p className="text-lg font-bold tabular-nums text-app-fg">{preview.columnCount}</p>
            <p className="text-micro font-medium uppercase tracking-wider text-app-fg-muted mt-0.5">Columns</p>
          </div>
          <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 text-center">
            <p className="text-lg font-bold tabular-nums text-app-fg">{fileSizeKb < 1 ? '<1' : fileSizeKb}</p>
            <p className="text-micro font-medium uppercase tracking-wider text-app-fg-muted mt-0.5">KB</p>
          </div>
        </div>

        {error ? <p className="text-sm text-danger-600 dark:text-danger-400 text-center">{error}</p> : null}

        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => { setPreview(null); setError(null); }}>
            ← Back
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleDownload}
              className="bg-gradient-to-r from-brand-600 to-brand-500 border border-brand-700/30 shadow-md shadow-brand-900/20 hover:from-brand-500 hover:to-brand-400"
            >
              Download {preview.format.toUpperCase()}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" contentClassName="p-6 space-y-4 max-h-[85dvh] overflow-y-auto">
      <div>
        <h3 className="text-lg font-semibold text-app-fg">{title}</h3>
        {description ? <p className="text-sm text-app-fg-muted mt-1">{description}</p> : null}
      </div>

      {filters ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Filters</p>
          {filters}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Format</p>
        <FormSelect
          value={format}
          onChange={(e) => setFormat(e.target.value as 'csv' | 'pdf' | 'xlsx')}
          options={[
            { value: 'csv', label: 'CSV' },
            { value: 'pdf', label: 'PDF' },
            { value: 'xlsx', label: 'XLSX (Excel)' },
          ]}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Columns</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {columns.map((col) => {
            const checked = selectedColumns.includes(col.key);
            return (
              <label key={col.key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={checked}
                  onChange={() => {
                    setSelectedColumns((prev) => {
                      if (checked) return prev.filter((k) => k !== col.key);
                      return [...prev, col.key];
                    });
                  }}
                />
                <span className="text-sm text-app-fg">{col.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {error ? (
        <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>
      ) : null}

      {exporting && (
        <div className="space-y-2 rounded-md border border-brand-200 bg-brand-50/50 p-3 dark:border-brand-800 dark:bg-brand-900/20">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-app-fg">Generating report…</p>
            <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
              Processing
            </span>
          </div>
          <div className="h-2.5 w-full rounded-full bg-app-hover overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-300 ease-out"
              style={{ width: `${Math.round(simulatedPct)}%` }}
            />
          </div>
          <p className="text-xs text-app-fg-muted text-right tabular-nums">{Math.round(simulatedPct)}%</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {totalRows != null && totalRows > rows.length ? (
          <span className="text-xs text-app-fg-muted">{totalRows.toLocaleString()} rows total</span>
        ) : fetchAllRows && totalRows == null ? (
          // The export re-fetches everything matching the chosen filters, so the
          // upfront count is unknown — don't show a misleading page-derived number.
          <span className="text-xs text-app-fg-muted">All matching rows</span>
        ) : (
          <span className="text-xs text-app-fg-muted">{rows.length.toLocaleString()} rows</span>
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={exporting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canGenerate}
            loading={exporting}
            loadingText="Generating…"
            onClick={handleGenerate}
            className="bg-gradient-to-r from-brand-600 to-brand-500 border border-brand-700/30 shadow-md shadow-brand-900/20 hover:from-brand-500 hover:to-brand-400"
          >
            Generate report
          </Button>
        </div>
      </div>
    </Modal>
  );
}
