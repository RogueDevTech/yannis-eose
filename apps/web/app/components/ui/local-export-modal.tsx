import { useEffect, useMemo, useState, type ReactNode } from 'react';
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

export function LocalExportModal({ open, onClose, title, description, rows, columns, defaultColumns, filenamePrefix, fetchAllRows, totalRows, filters }: Props) {
  const [format, setFormat] = useState<'csv' | 'pdf' | 'xlsx'>('csv');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(defaultColumns);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormat('csv');
    setSelectedColumns(defaultColumns);
    setExporting(false);
    setError(null);
  }, [open, defaultColumns]);

  const selectedColumnDefs = useMemo(
    () => columns.filter((c) => selectedColumns.includes(c.key)),
    [columns, selectedColumns],
  );

  const canGenerate = selectedColumnDefs.length > 0 && !exporting;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setExporting(true);
    setError(null);
    try {
      const exportRows = fetchAllRows ? await fetchAllRows() : rows;
      const csv = buildCsv(exportRows, selectedColumnDefs);
      const date = new Date().toISOString().split('T')[0] ?? 'export';
      const filename = `${filenamePrefix}-${date}.csv`;
      if (format === 'csv') {
        downloadCsv(filename, csv);
      } else if (format === 'pdf') {
        downloadPdf(filename, csv);
      } else {
        await downloadXlsx(filename, csv);
      }
      onClose();
    } catch (err) {
      // Surface the failure instead of silently doing nothing (the old bare
      // try/finally swallowed fetch/serialization errors, so the button just
      // reset and no file downloaded).
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

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
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canGenerate}
            onClick={handleGenerate}
            className="bg-gradient-to-r from-brand-600 to-brand-500 border border-brand-700/30 shadow-md shadow-brand-900/20 hover:from-brand-500 hover:to-brand-400"
          >
            {exporting ? 'Generating…' : 'Generate report'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
