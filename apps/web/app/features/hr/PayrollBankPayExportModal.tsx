import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
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
import { createZipStoreBlob } from '~/lib/zip-store';
import { DEPT_LABEL } from './payroll-constants';
import type { BranchOption, MonthlyPayrollGroup, PayrollBatch } from './types';

type ExportMode = 'one_file' | 'by_batch';

type ExportFetcherData =
  | { ok: true; batches: BankPayBatchSection[]; error: null }
  | { ok: false; batches: BankPayBatchSection[]; error: string };

function isExportable(status: string): boolean {
  return status === 'PENDING_FINANCE' || status === 'PAID';
}

function batchFilename(batch: BankPayBatchSection): string {
  const month = String(batch.periodMonth).slice(0, 7);
  const dept = batch.department.toLowerCase();
  const branch = batch.branchName.replace(/\s+/g, '-').toLowerCase().slice(0, 24);
  return `bank-pay-${month}-${dept}-${branch}.pdf`;
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
          branchName: branchById.get(b.branchId) ?? b.branchId.slice(0, 8),
          monthLabel: formatBankPayPeriod(b.periodMonth),
        });
      }
    }
    return rows;
  }, [monthlyPayrolls, branchById]);

  const exportableIds = useMemo(
    () => flatBatches.filter((b) => isExportable(b.status)).map((b) => b.id),
    [flatBatches],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ExportMode>('one_file');
  const [previewDoc, setPreviewDoc] = useState<BankPayPdfInput | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [requestKey, setRequestKey] = useState(0);
  const exportFetcher = useFetcher<ExportFetcherData>();

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setPreviewDoc(null);
      setMode('one_file');
    }
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
    try {
      if (mode === 'one_file') {
        await downloadBankPayPdf(previewDoc, `bank-pay-${new Date().toISOString().slice(0, 10)}.pdf`);
      } else {
        const files: Array<{ name: string; data: Uint8Array }> = [];
        for (const batch of previewDoc.batches) {
          const bytes = await generateBankPayPdfBytes({
            title: 'BANK PAY LIST',
            generatedAt: previewDoc.generatedAt,
            batches: [batch],
          });
          files.push({ name: batchFilename(batch), data: bytes });
        }
        const zip = createZipStoreBlob(files);
        const url = URL.createObjectURL(zip);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bank-pay-batches-${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);
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

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set(exportableIds))}>
            Select all ready
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border border-app-border divide-y divide-app-border">
          {flatBatches.length === 0 ? (
            <p className="p-3 text-sm text-app-fg-muted">No batches in the current filters.</p>
          ) : (
            flatBatches.map((batch) => {
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
                        {DEPT_LABEL[batch.department]} · {batch.monthLabel}
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
          <legend className="text-sm font-medium text-app-fg">File packaging</legend>
          <label className="flex items-center gap-2 text-sm text-app-fg cursor-pointer">
            <input
              type="radio"
              name="bankPayMode"
              checked={mode === 'one_file'}
              onChange={() => setMode('one_file')}
            />
            One file (single PDF for all selected)
          </label>
          <label className="flex items-center gap-2 text-sm text-app-fg cursor-pointer">
            <input
              type="radio"
              name="bankPayMode"
              checked={mode === 'by_batch'}
              onChange={() => setMode('by_batch')}
            />
            By batch (ZIP with one PDF per batch)
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
        downloadLabel={mode === 'by_batch' ? 'Download ZIP' : 'Download PDF'}
        onDownload={() => void handleDownload()}
        onClose={() => setPreviewDoc(null)}
      />
    </>
  );
}
