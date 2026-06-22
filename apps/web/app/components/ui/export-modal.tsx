import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import jsPDF from 'jspdf';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { FormSelect } from './form-select';
import { Modal } from './modal';
import { SearchableSelect } from './searchable-select';
import { TextInput } from './text-input';
import { useToast } from './toast';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { EXPORT_DATE_PRESET_OPTIONS, type ExportConfig } from '~/lib/export-config';
import type { ExportReportActionData } from '~/lib/export-report.server';

export type ExportModalPicklists = {
  csClosers?: Array<{ id: string; name: string }>;
  mediaBuyers?: Array<{ id: string; name: string }>;
  products?: Array<{ id: string; name: string }>;
  campaigns?: Array<{ id: string; name: string }>;
  recipients?: Array<{ id: string; name: string }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  config: ExportConfig;
  initialFilters?: Record<string, unknown>;
  /** Optional per-page picklists used by advanced report filters (merged with initialFilters). */
  picklists?: Partial<ExportModalPicklists>;
};

function triggerCsvDownload(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
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

function toPdfFromCsv(filename: string, csvContent: string) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const lines = csvContent.split('\n');
  let y = 16;
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  for (const line of lines) {
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

async function toXlsxFromCsv(filename: string, csvContent: string) {
  const xlsx = await import('xlsx');
  const wb = xlsx.read(csvContent, { type: 'string' });
  const xlsxBytes = xlsx.write(wb, { type: 'array', bookType: 'xlsx' });
  triggerBlobDownload(
    filename.replace(/\.csv$/i, '.xlsx'),
    new Blob([xlsxBytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

export function ExportModal({ open, onClose, config, initialFilters = {}, picklists }: Props) {
  const fetcher = useFetcher<ExportReportActionData>();
  const exportSurface = useFetcherActionSurface(fetcher);
  const { toast } = useToast();
  const [format, setFormat] = useState<'csv' | 'pdf' | 'xlsx'>('csv');
  const [selectedColumns, setSelectedColumns] = useState<string[]>(config.defaultColumns);
  const [preset, setPreset] = useState<(typeof EXPORT_DATE_PRESET_OPTIONS)[number]['value']>('this_month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeCurrentFilters, setIncludeCurrentFilters] = useState(true);
  const [exportMediaBuyerId, setExportMediaBuyerId] = useState('');
  const [exportProductId, setExportProductId] = useState('');
  const [exportCampaignId, setExportCampaignId] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [exportMinAmount, setExportMinAmount] = useState('');
  const [exportMaxAmount, setExportMaxAmount] = useState('');
  const [exportAssignedCsId, setExportAssignedCsId] = useState('');
  const [exportReceiverId, setExportReceiverId] = useState('');
  const [exportRole, setExportRole] = useState('');
  const [exportMinRate, setExportMinRate] = useState('');
  const [inventoryStatus, setInventoryStatus] = useState('');
  const [inventoryMaxAvailable, setInventoryMaxAvailable] = useState('');
  const [exportDuplicateType, setExportDuplicateType] = useState('');
  const [exportSearch, setExportSearch] = useState('');
  const lastHandledFetcherData = useRef<unknown>(null);

  // Preview state — null = config step, data = preview step
  const [preview, setPreview] = useState<{ filename: string; csvContent: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormat('csv');
    setSelectedColumns(config.defaultColumns);
    setPreset('this_month');
    setStartDate('');
    setEndDate('');
    setIncludeCurrentFilters(true);
    setExportMediaBuyerId('');
    setExportProductId('');
    setExportCampaignId('');
    setExportStatus('');
    setExportMinAmount('');
    setExportMaxAmount('');
    setExportAssignedCsId('');
    setExportReceiverId('');
    setExportRole('');
    setExportMinRate('');
    setInventoryStatus('');
    setInventoryMaxAvailable('');
    setExportDuplicateType('');
    setExportSearch('');
    setPreview(null);
    // Mark any stale fetcher.data as already handled so re-opening the modal
    // doesn't re-trigger a download from a previous export.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    lastHandledFetcherData.current = fetcher.data ?? null;
  }, [open, config.defaultColumns, config.reportKey]); // intentionally excludes fetcher.data

  const columnsJson = useMemo(() => JSON.stringify(selectedColumns), [selectedColumns]);

  const filtersJson = useMemo(() => {
    const base: Record<string, unknown> = includeCurrentFilters ? { ...initialFilters } : {};
    const parsedMinAmount = Number.parseFloat(exportMinAmount);
    const parsedMaxAmount = Number.parseFloat(exportMaxAmount);
    const parsedMinRate = Number.parseFloat(exportMinRate);
    if (Number.isFinite(parsedMinAmount) && parsedMinAmount >= 0) base.minAmount = parsedMinAmount;
    if (Number.isFinite(parsedMaxAmount) && parsedMaxAmount >= 0) base.maxAmount = parsedMaxAmount;
    if (Number.isFinite(parsedMinRate) && parsedMinRate >= 0) base.minRate = parsedMinRate;
    if (exportStatus) base.status = exportStatus;
    if (exportAssignedCsId) base.assignedCsId = exportAssignedCsId;
    if (exportReceiverId) base.receiverId = exportReceiverId;
    if (exportRole) base.role = exportRole;

    if (config.reportKey === 'marketing_orders') {
      if (exportProductId) base.productId = exportProductId;
      if (exportCampaignId) base.campaignId = exportCampaignId;
      if (exportMediaBuyerId) base.mediaBuyerId = exportMediaBuyerId;
    }
    if (config.reportKey === 'cross_funnel') {
      if (exportProductId) base.productId = exportProductId;
      if (exportCampaignId) base.campaignId = exportCampaignId;
      if (exportMediaBuyerId) base.mediaBuyerId = exportMediaBuyerId;
      if (exportDuplicateType) base.duplicateType = exportDuplicateType;
      if (exportSearch) base.search = exportSearch;
    }
    if (config.reportKey === 'logistics_partners') {
      if (exportProductId) base.productId = exportProductId;
    }
    if (config.reportKey === 'inventory') {
      if (inventoryStatus) base.status = inventoryStatus;
      const parsedMax = Number.parseInt(inventoryMaxAvailable, 10);
      if (Number.isFinite(parsedMax) && parsedMax >= 0) base.maxAvailable = parsedMax;
    }
    return JSON.stringify(base);
  }, [
    includeCurrentFilters,
    initialFilters,
    config.reportKey,
    exportProductId,
    exportCampaignId,
    exportMediaBuyerId,
    exportStatus,
    exportMinAmount,
    exportMaxAmount,
    exportAssignedCsId,
    exportReceiverId,
    exportRole,
    exportMinRate,
    inventoryStatus,
    inventoryMaxAvailable,
    exportDuplicateType,
    exportSearch,
  ]);

  const isExporting = fetcher.state === 'submitting' || fetcher.state === 'loading';

  // Simulated progress — smoothly fills while the server generates the report.
  const [simulatedPct, setSimulatedPct] = useState(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearProgressInterval = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  }, []);

  useEffect(() => {
    if (isExporting) {
      setSimulatedPct(0);
      clearProgressInterval();
      progressInterval.current = setInterval(() => {
        setSimulatedPct((prev) => {
          // Fast to 60%, slow to 85%, crawl to 95% — never reaches 100% until server responds
          if (prev < 60) return prev + 3;
          if (prev < 85) return prev + 1;
          if (prev < 95) return prev + 0.3;
          return prev;
        });
      }, 200);
    } else {
      clearProgressInterval();
      if (simulatedPct > 0) setSimulatedPct(100);
    }
    return clearProgressInterval;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExporting, clearProgressInterval]);

  // When fetcher returns data, show preview instead of auto-downloading
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data === lastHandledFetcherData.current) return;
    lastHandledFetcherData.current = fetcher.data;
    const d = fetcher.data;
    if (d.ok) {
      setPreview({ filename: d.filename, csvContent: d.csvContent });
    } else if (!open) {
      toast.error('Export failed', d.error);
    }
  }, [fetcher.state, fetcher.data, toast, open]);

  const handleDownload = () => {
    if (!preview) return;
    if (format === 'csv') {
      triggerCsvDownload(preview.filename, preview.csvContent);
    } else if (format === 'pdf') {
      toPdfFromCsv(preview.filename, preview.csvContent);
    } else {
      toXlsxFromCsv(preview.filename, preview.csvContent).catch(() => {
        toast.error('Export failed', 'Could not generate XLSX file');
      });
    }
    onClose();
  };

  const mediaBuyerOptions = useMemo(() => {
    if (!picklists?.mediaBuyers) return [];
    return [{ value: '', label: 'Use page filter / all' }, ...picklists.mediaBuyers.map((u) => ({ value: u.id, label: u.name }))];
  }, [picklists?.mediaBuyers]);

  const productOptions = useMemo(() => {
    if (!picklists?.products) return [];
    return [{ value: '', label: 'Any product' }, ...picklists.products.map((p) => ({ value: p.id, label: p.name }))];
  }, [picklists?.products]);

  const campaignOptions = useMemo(() => {
    if (!picklists?.campaigns) return [];
    return [{ value: '', label: 'Any campaign' }, ...picklists.campaigns.map((c) => ({ value: c.id, label: c.name }))];
  }, [picklists?.campaigns]);

  const csCloserOptions = useMemo(() => {
    if (!picklists?.csClosers) return [];
    return [{ value: '', label: 'Use page filter / all' }, ...picklists.csClosers.map((c) => ({ value: c.id, label: c.name }))];
  }, [picklists?.csClosers]);

  const recipientOptions = useMemo(() => {
    if (!picklists?.recipients) return [];
    return [{ value: '', label: 'Use page filter / all' }, ...picklists.recipients.map((r) => ({ value: r.id, label: r.name }))];
  }, [picklists?.recipients]);

  // Preview step — compact summary
  if (preview) {
    const totalRows = preview.csvContent.split('\n').filter((l) => l.trim()).length - 1;
    const columnCount = selectedColumns.length;
    const fileSizeKb = Math.round(new Blob([preview.csvContent]).size / 1024);
    return (
      <Modal open={open} onClose={onClose} maxWidth="max-w-sm" contentClassName="p-6 space-y-5">
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-success-100 dark:bg-success-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-success-600 dark:text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-app-fg">Report Ready</h3>
          <p className="text-sm text-app-fg-muted">{preview.filename}</p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 text-center">
            <p className="text-lg font-bold tabular-nums text-app-fg">{totalRows.toLocaleString()}</p>
            <p className="text-micro font-medium uppercase tracking-wider text-app-fg-muted mt-0.5">Rows</p>
          </div>
          <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 text-center">
            <p className="text-lg font-bold tabular-nums text-app-fg">{columnCount}</p>
            <p className="text-micro font-medium uppercase tracking-wider text-app-fg-muted mt-0.5">Columns</p>
          </div>
          <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 text-center">
            <p className="text-lg font-bold tabular-nums text-app-fg">{fileSizeKb < 1 ? '<1' : fileSizeKb}</p>
            <p className="text-micro font-medium uppercase tracking-wider text-app-fg-muted mt-0.5">KB</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => setPreview(null)}>
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
              Download {format.toUpperCase()}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" contentClassName="p-6 space-y-4 max-h-[85dvh] overflow-y-auto">
      <div>
        <h3 className="text-lg font-semibold text-app-fg">{config.title}</h3>
        <p className="text-sm text-app-fg-muted mt-1">{config.description}</p>
      </div>

      <ModalFetcherInlineError message={exportSurface.errorMatchingIntent('exportReport')} />

      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="exportReport" />
        <input type="hidden" name="reportKey" value={config.reportKey} />
        <input type="hidden" name="columns" value={columnsJson} />
        <input type="hidden" name="filters" value={filtersJson} />

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
          <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Date range</p>
          <FormSelect
            value={preset}
            onChange={(e) => setPreset(e.target.value as (typeof EXPORT_DATE_PRESET_OPTIONS)[number]['value'])}
            options={EXPORT_DATE_PRESET_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          {preset === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <TextInput
                type="date"
                label="Start date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <TextInput
                type="date"
                label="End date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          )}
        </div>

        {config.reportKey === 'cs_orders' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">CS order filters (optional)</p>
            <FormSelect
              label="Status"
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
              options={[
                { value: '', label: 'Any status' },
                { value: 'UNPROCESSED', label: 'Unassigned' },
                { value: 'CS_ASSIGNED', label: 'Assigned' },
                { value: 'CS_ENGAGED', label: 'Unconfirmed' },
                { value: 'CONFIRMED', label: 'Confirmed' },
                { value: 'AGENT_ASSIGNED', label: 'Agent assigned' },
                { value: 'DELIVERED', label: 'Delivered' },
                { value: 'REMITTED', label: 'Cash Remitted' },
                { value: 'DELETED', label: 'Deleted' },
              ]}
            />
            {csCloserOptions.length > 0 && (
              <SearchableSelect
                label="Assigned closer"
                value={exportAssignedCsId}
                onChange={setExportAssignedCsId}
                options={csCloserOptions}
                placeholder="Use page filter / all"
                controlSize="sm"
              />
            )}
            <TextInput
              type="number"
              min={0}
              label="Min amount (N)"
              value={exportMinAmount}
              onChange={(e) => setExportMinAmount(e.target.value)}
              placeholder="Leave blank for no minimum"
            />
          </div>
        )}

        {config.reportKey === 'marketing_orders' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Marketing order filters (optional)</p>
            <SearchableSelect
              label="Media buyer"
              value={exportMediaBuyerId}
              onChange={setExportMediaBuyerId}
              options={mediaBuyerOptions}
              placeholder="Use page filter / all"
              controlSize="sm"
            />
            <SearchableSelect
              label="Product"
              value={exportProductId}
              onChange={setExportProductId}
              options={productOptions}
              placeholder="Any product"
              controlSize="sm"
            />
            <SearchableSelect
              label="Campaign"
              value={exportCampaignId}
              onChange={setExportCampaignId}
              options={campaignOptions}
              placeholder="Any campaign"
              controlSize="sm"
            />
            <TextInput
              type="number"
              min={0}
              label="Min amount (N)"
              value={exportMinAmount}
              onChange={(e) => setExportMinAmount(e.target.value)}
              placeholder="Leave blank for no minimum"
            />
          </div>
        )}

        {config.reportKey === 'cross_funnel' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Filters (optional)</p>
            <FormSelect
              label="Duplicate type"
              value={exportDuplicateType}
              onChange={(e) => setExportDuplicateType(e.target.value)}
              options={[
                { value: '', label: 'All types' },
                { value: 'resubmission', label: 'Resubmission' },
                { value: 'same-mb', label: 'Same MB' },
                { value: 'cross-funnel', label: 'Cross-funnel' },
              ]}
            />
            {mediaBuyerOptions.length > 0 && (
              <SearchableSelect
                label="Media buyer"
                value={exportMediaBuyerId}
                onChange={setExportMediaBuyerId}
                options={mediaBuyerOptions}
                placeholder="All media buyers"
                controlSize="sm"
              />
            )}
            {productOptions.length > 0 && (
              <SearchableSelect
                label="Product"
                value={exportProductId}
                onChange={setExportProductId}
                options={productOptions}
                placeholder="All products"
                controlSize="sm"
              />
            )}
            {campaignOptions.length > 0 && (
              <SearchableSelect
                label="Form"
                value={exportCampaignId}
                onChange={setExportCampaignId}
                options={campaignOptions}
                placeholder="All forms"
                controlSize="sm"
              />
            )}
          </div>
        )}

        {config.reportKey === 'cs_team' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Sales team filters (optional)</p>
            <TextInput
              type="number"
              min={0}
              max={100}
              label="Min confirmation rate (%)"
              value={exportMinRate}
              onChange={(e) => setExportMinRate(e.target.value)}
              placeholder="Leave blank for no threshold"
            />
          </div>
        )}

        {config.reportKey === 'marketing_team' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Marketing team filters (optional)</p>
            <FormSelect
              label="Role"
              value={exportRole}
              onChange={(e) => setExportRole(e.target.value)}
              options={[
                { value: '', label: 'Any role' },
                { value: 'MEDIA_BUYER', label: 'Media buyer' },
                { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
              ]}
            />
            <TextInput
              type="number"
              min={0}
              label="Min balance (N)"
              value={exportMinAmount}
              onChange={(e) => setExportMinAmount(e.target.value)}
              placeholder="Leave blank for no threshold"
            />
            <TextInput
              type="number"
              min={0}
              label="Min True ROAS (x)"
              value={exportMaxAmount}
              onChange={(e) => setExportMaxAmount(e.target.value)}
              placeholder="Leave blank for no threshold"
            />
          </div>
        )}

        {config.reportKey === 'finance_invoices' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Invoice filters (optional)</p>
            <FormSelect
              label="Invoice status"
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
              options={[
                { value: '', label: 'Any status' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'SENT', label: 'Sent' },
                { value: 'PAID', label: 'Paid' },
                { value: 'OVERDUE', label: 'Overdue' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
            <TextInput
              type="number"
              min={0}
              label="Min amount (N)"
              value={exportMinAmount}
              onChange={(e) => setExportMinAmount(e.target.value)}
              placeholder="Leave blank for no minimum"
            />
            <TextInput
              type="number"
              min={0}
              label="Max amount (N)"
              value={exportMaxAmount}
              onChange={(e) => setExportMaxAmount(e.target.value)}
              placeholder="Leave blank for no maximum"
            />
          </div>
        )}

        {config.reportKey === 'disbursements' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Disbursement filters (optional)</p>
            <FormSelect
              label="Status"
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
              options={[
                { value: '', label: 'Any status' },
                { value: 'SENT', label: 'Pending' },
                { value: 'COMPLETED', label: 'Received' },
                { value: 'DISPUTED', label: 'Disputed' },
              ]}
            />
            {recipientOptions.length > 0 && (
              <SearchableSelect
                label="Receiver"
                value={exportReceiverId}
                onChange={setExportReceiverId}
                options={recipientOptions}
                placeholder="Use page filter / all"
                controlSize="sm"
              />
            )}
            <TextInput
              type="number"
              min={0}
              label="Min amount (N)"
              value={exportMinAmount}
              onChange={(e) => setExportMinAmount(e.target.value)}
              placeholder="Leave blank for no minimum"
            />
          </div>
        )}

        {config.reportKey === 'inventory' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Inventory filters (optional)</p>
            <FormSelect
              label="Stock status"
              value={inventoryStatus}
              onChange={(e) => setInventoryStatus(e.target.value)}
              options={[
                { value: '', label: 'Any status' },
                { value: 'AVAILABLE', label: 'Available' },
                { value: 'RESERVED', label: 'Reserved' },
                { value: 'ALLOCATED_TO_3PL', label: 'Allocated to logistics company' },
                { value: 'IN_TRANSIT', label: 'In transit' },
                { value: 'DELIVERED', label: 'Delivered' },
                { value: 'RETURNED', label: 'Returned' },
                { value: 'WRITTEN_OFF', label: 'Written off' },
              ]}
            />
            <TextInput
              type="number"
              min={0}
              label="Max available stock (e.g. 50)"
              value={inventoryMaxAvailable}
              onChange={(e) => setInventoryMaxAvailable(e.target.value)}
              placeholder="Leave blank for no threshold"
            />
          </div>
        )}

        {config.reportKey === 'logistics_partners' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Logistics filters (optional)</p>
            <FormSelect
              label="Status"
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
              options={[
                { value: '', label: 'Any status' },
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
            />
            {productOptions.length > 0 && (
              <SearchableSelect
                label="Product"
                value={exportProductId}
                onChange={setExportProductId}
                options={productOptions}
                placeholder="All products"
                controlSize="sm"
              />
            )}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Columns</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {config.columns.map((col) => {
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

        <input type="hidden" name="datePreset" value={preset} />
        <input type="hidden" name="startDate" value={startDate} />
        <input type="hidden" name="endDate" value={endDate} />

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={includeCurrentFilters} onChange={() => setIncludeCurrentFilters((v) => !v)} />
          <span className="text-sm text-app-fg">Include current page filters</span>
        </label>

        {isExporting && (
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

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isExporting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={selectedColumns.length === 0 || isExporting}
            loading={isExporting}
            loadingText="Generating…"
            className="bg-gradient-to-r from-brand-600 to-brand-500 border border-brand-700/30 shadow-md shadow-brand-900/20 hover:from-brand-500 hover:to-brand-400"
          >
            Generate report
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
