import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { InlineNotification } from '~/components/ui/inline-notification';
import { NairaPrice } from '~/components/ui/naira-price';
import { BankPayPreviewModal } from '~/components/ui/bank-pay-preview-modal';
import {
  downloadBankPayPdf,
  formatBankPayPeriod,
  generateBankPayPdfBytes,
  type BankPayBatchSection,
  type BankPayPdfInput,
} from '~/lib/bank-pay-pdf';
import { bankPayUploadCsv, downloadBankPayUploadCsv } from '~/lib/bank-pay-csv';
import { createZipStoreBlob } from '~/lib/zip-store';
import { batchScopeLabel, batchBranchLabel } from './payroll-constants';
import type { BranchOption, MonthlyPayrollGroup, PayrollBatch } from './types';

type ExportMode = 'one_file' | 'by_batch';
type ExportFormat = 'pdf' | 'csv';

type ExportFetcherData =
  | { ok: true; batches: BankPayBatchSection[]; error: null }
  | { ok: false; batches: BankPayBatchSection[]; error: string };

function isExportable(status: string): boolean {
  return status === 'PENDING_FINANCE' || status === 'PAID';
}

function batchFilename(batch: BankPayBatchSection, ext: 'pdf' | 'csv'): string {
  const month = String(batch.periodMonth).slice(0, 7);
  // Null-scope batches have no department/branch — fall back to the scope label.
  const dept = (batch.department ?? batch.scopeType ?? 'payroll').toLowerCase();
  const branch = (batch.branchName ?? 'org-wide').replace(/\s+/g, '-').toLowerCase().slice(0, 24);
  return `bank-pay-${month}-${dept}-${branch}.${ext}`;
}

export function PayrollBankPayExportModal({
  open,
  onClose,
  monthlyPayrolls,
  branches,
}: {
  open: boolean;
  onClose: () => void;
  monthlyPayrolls: MonthlyPayrollGroup[];
  branches: BranchOption[];
}) {
  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const flatBatches = useMemo(() => {
    const rows: Array<PayrollBatch & { branchName: string; monthLabel: string }> = [];
    for (const group of monthlyPayrolls) {
      for (const b of group.items) {
        rows.push({
          ...b,
          branchName: batchBranchLabel(
            b.branchId ? branchById.get(b.branchId) : null,
            b.branchId,
            b.scopeType,
          ),
          monthLabel: formatBankPayPeriod(b.periodMonth),
        });
      }
    }
    return rows;
  }, [monthlyPayrolls, branchById]);

  // Month filter (YYYY-MM). Distinct months present, newest first, each with its
  // display label for the picker.
  const monthOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of flatBatches) {
      const ym = String(b.periodMonth).slice(0, 7);
      if (!map.has(ym)) map.set(ym, formatBankPayPeriod(b.periodMonth));
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([value, label]) => ({ value, label }));
  }, [flatBatches]);

  // Default to the CURRENT month when it has batches; else the most recent month.
  const currentYm = new Date().toISOString().slice(0, 7);
  const defaultMonth =
    monthOptions.find((m) => m.value === currentYm)?.value ?? monthOptions[0]?.value ?? 'ALL';
  const [monthFilter, setMonthFilter] = useState<string>(defaultMonth);

  const visibleBatches = useMemo(
    () => (monthFilter === 'ALL' ? flatBatches : flatBatches.filter((b) => String(b.periodMonth).slice(0, 7) === monthFilter)),
    [flatBatches, monthFilter],
  );

  const exportableIds = useMemo(
    () => visibleBatches.filter((b) => isExportable(b.status)).map((b) => b.id),
    [visibleBatches],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ExportMode>('one_file');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [previewDoc, setPreviewDoc] = useState<BankPayPdfInput | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const exportFetcher = useFetcher<ExportFetcherData>();

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setPreviewDoc(null);
      setMode('one_file');
      setFormat('csv');
    } else {
      // On open, snap the month filter to the current month (or most recent).
      setMonthFilter(defaultMonth);
    }
    // defaultMonth is derived from monthOptions; re-run when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || requestKey === 0) return;
    if (exportFetcher.state !== 'idle' || !exportFetcher.data) return;
    if (!exportFetcher.data.ok) return;
    setPreviewDoc({
      title: 'BANK PAY LIST',
      generatedAt: new Date().toISOString(),
      batches: exportFetcher.data.batches,
    });
  }, [open, requestKey, exportFetcher.state, exportFetcher.data]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const busy = exportFetcher.state === 'loading' || exportFetcher.state === 'submitting';
  const fetchError =
    exportFetcher.state === 'idle' && exportFetcher.data && !exportFetcher.data.ok
      ? exportFetcher.data.error
      : null;

  const handlePreviewClick = () => {
    if (!selected.size) return;
    setPreviewDoc(null);
    const params = new URLSearchParams();
    for (const id of selected) params.append('batchId', id);
    setRequestKey((k) => k + 1);
    void exportFetcher.load(`/api/hr-bank-pay-export?${params.toString()}`);
  };

  const handleDownload = async () => {
    if (!previewDoc) return;
    setDownloading(true);
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      const ext: 'pdf' | 'csv' = format === 'csv' ? 'csv' : 'pdf';
      const downloadZip = (files: Array<{ name: string; data: Uint8Array }>, name: string) => {
        const url = URL.createObjectURL(createZipStoreBlob(files));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      };

      if (mode === 'one_file') {
        if (format === 'csv') {
          downloadBankPayUploadCsv(previewDoc, `bank-pay-${stamp}.csv`);
        } else {
          await downloadBankPayPdf(previewDoc, `bank-pay-${stamp}.pdf`);
        }
      } else {
        const files: Array<{ name: string; data: Uint8Array }> = [];
        for (const batch of previewDoc.batches) {
          const single = {
            title: 'BANK PAY LIST',
            generatedAt: previewDoc.generatedAt,
            batches: [batch],
          };
          const data =
            format === 'csv'
              ? new TextEncoder().encode(bankPayUploadCsv(single))
              : await generateBankPayPdfBytes(single);
          files.push({ name: batchFilename(batch, ext), data });
        }
        downloadZip(files, `bank-pay-batches-${stamp}.zip`);
      }
    } finally {
      setDownloading(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <Modal
        open={!previewDoc}
        onClose={onClose}
        maxWidth="max-w-xl"
        contentClassName="p-5 space-y-4"
      >
        <div>
          <h2 className="text-base font-semibold text-app-fg">Export bank pay</h2>
          <p className="mt-1 text-sm text-app-fg-muted">
            Select batches to include, choose one file or by batch, then preview.
          </p>
        </div>

        {/* Month filter — defaults to the current month so the list isn't the
            whole all-time history. Only shown when more than one month exists. */}
        {monthOptions.length > 1 ? (
          <FormSelect
            label="Month"
            value={monthFilter}
            onChange={(e) => {
              setMonthFilter(e.target.value);
              setSelected(new Set()); // reset selection when the filter changes
            }}
            options={[{ value: 'ALL', label: 'All months' }, ...monthOptions]}
            wrapperClassName="w-full sm:w-56"
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set(exportableIds))}>
            Select all ready
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border border-app-border divide-y divide-app-border">
          {visibleBatches.length === 0 ? (
            <p className="p-3 text-sm text-app-fg-muted">No batches for the selected month.</p>
          ) : (
            visibleBatches.map((batch) => {
              const ready = isExportable(batch.status);
              const checked = selected.has(batch.id);
              return (
                <label
                  key={batch.id}
                  className={`flex items-start gap-3 px-3 py-2.5 text-sm ${
                    ready ? 'cursor-pointer hover:bg-app-hover' : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!ready}
                    checked={checked}
                    onChange={() => toggle(batch.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-app-fg">
                        {batchScopeLabel(batch.department, batch.scopeType)} · {batch.monthLabel}
                      </span>
                      <StatusBadge status={batch.status} />
                    </div>
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      {batch.branchName} · {batch.staffCount} staff ·{' '}
                      <NairaPrice amount={Number(batch.totalAmount)} />
                    </p>
                    {!ready ? (
                      <p className="text-xs text-app-fg-muted mt-0.5">
                        Only Pending Finance or Paid batches can be exported.
                      </p>
                    ) : null}
                  </div>
                </label>
              );
            })
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-app-fg">File format</legend>
          <label className="flex items-start gap-2 text-sm text-app-fg cursor-pointer">
            <input
              type="radio"
              name="bankPayFormat"
              className="mt-1"
              checked={format === 'csv'}
              onChange={() => setFormat('csv')}
            />
            <span>
              Bank upload (CSV)
              <span className="block text-xs text-app-fg-muted">
                Bank code, account number, beneficiary name, net amount, narration. Ready for direct upload.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-app-fg cursor-pointer">
            <input
              type="radio"
              name="bankPayFormat"
              className="mt-1"
              checked={format === 'pdf'}
              onChange={() => setFormat('pdf')}
            />
            <span>
              Printable document (PDF)
              <span className="block text-xs text-app-fg-muted">For review, records, or sign-off.</span>
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-app-fg">File packaging</legend>
          <label className="flex items-center gap-2 text-sm text-app-fg cursor-pointer">
            <input
              type="radio"
              name="bankPayMode"
              checked={mode === 'one_file'}
              onChange={() => setMode('one_file')}
            />
            One file (single {format === 'csv' ? 'CSV' : 'PDF'} for all selected)
          </label>
          <label className="flex items-center gap-2 text-sm text-app-fg cursor-pointer">
            <input
              type="radio"
              name="bankPayMode"
              checked={mode === 'by_batch'}
              onChange={() => setMode('by_batch')}
            />
            By batch (ZIP with one {format === 'csv' ? 'CSV' : 'PDF'} per batch)
          </label>
        </fieldset>

        {fetchError ? <InlineNotification variant="danger" message={fetchError} /> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!selected.size || busy}
            loading={busy}
            loadingText="Loading…"
            onClick={handlePreviewClick}
          >
            Preview
          </Button>
        </div>
      </Modal>

      <BankPayPreviewModal
        doc={previewDoc}
        title={
          previewDoc
            ? `Bank pay · ${previewDoc.batches.length} batch${previewDoc.batches.length === 1 ? '' : 'es'}`
            : undefined
        }
        downloading={downloading}
        downloadLabel={
          mode === 'by_batch' ? 'Download ZIP' : format === 'csv' ? 'Download CSV' : 'Download PDF'
        }
        onDownload={() => void handleDownload()}
        onClose={() => setPreviewDoc(null)}
      />
    </>
  );
}
