import { useEffect, useMemo, useState } from 'react';
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

export function LocalExportModal({ open, onClose, title, description, rows, columns, defaultColumns, filenamePrefix }: Props) {
  const [format, setFormat] = useState<'csv' | 'pdf' | 'xlsx'>('csv');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(defaultColumns);

  useEffect(() => {
    if (!open) return;
    setFormat('csv');
    setSelectedColumns(defaultColumns);
  }, [open, defaultColumns]);

  const selectedColumnDefs = useMemo(
    () => columns.filter((c) => selectedColumns.includes(c.key)),
    [columns, selectedColumns],
  );

  const canGenerate = selectedColumnDefs.length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    const csv = buildCsv(rows, selectedColumnDefs);
    const date = new Date().toISOString().split('T')[0] ?? 'export';
    const filename = `${filenamePrefix}-${date}.csv`;
    if (format === 'csv') {
      downloadCsv(filename, csv);
      onClose();
      return;
    }
    if (format === 'pdf') {
      downloadPdf(filename, csv);
      onClose();
      return;
    }
    await downloadXlsx(filename, csv);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" contentClassName="p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-app-fg">{title}</h3>
        {description ? <p className="text-sm text-app-fg-muted mt-1">{description}</p> : null}
      </div>

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

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="primary" disabled={!canGenerate} onClick={handleGenerate}>
          Generate report
        </Button>
      </div>
    </Modal>
  );
}
