import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import jsPDF from 'jspdf';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { FormSelect } from './form-select';
import { Modal } from './modal';
import { SearchableSelect } from './searchable-select';
import { TextInput } from './text-input';
import { useToast } from './toast';
import { EXPORT_DATE_PRESET_OPTIONS, type ExportConfig } from '~/lib/export-config';
import type { ExportReportActionData } from '~/lib/export-report.server';

export type ExportModalPicklists = {
  csAgents?: Array<{ id: string; name: string }>;
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
  const lastHandledFetcherData = useRef<unknown>(null);

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
    lastHandledFetcherData.current = null;
  }, [open, config.defaultColumns, config.reportKey]);

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
  ]);

  const isExporting = fetcher.state === 'submitting' || fetcher.state === 'loading';

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data === lastHandledFetcherData.current) return;
    lastHandledFetcherData.current = fetcher.data;
    const d = fetcher.data;
    if (d.ok) {
      if (format === 'csv') {
        triggerCsvDownload(d.filename, d.csvContent);
      } else if (format === 'pdf') {
        toPdfFromCsv(d.filename, d.csvContent);
      } else {
        toXlsxFromCsv(d.filename, d.csvContent).catch(() => {
          toast.error('Export failed', 'Could not generate XLSX file');
        });
      }
      onClose();
    } else {
      toast.error('Export failed', d.error);
    }
  }, [fetcher.state, fetcher.data, format, onClose, toast]);

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

  const csAgentOptions = useMemo(() => {
    if (!picklists?.csAgents) return [];
    return [{ value: '', label: 'Use page filter / all' }, ...picklists.csAgents.map((c) => ({ value: c.id, label: c.name }))];
  }, [picklists?.csAgents]);

  const recipientOptions = useMemo(() => {
    if (!picklists?.recipients) return [];
    return [{ value: '', label: 'Use page filter / all' }, ...picklists.recipients.map((r) => ({ value: r.id, label: r.name }))];
  }, [picklists?.recipients]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" contentClassName="p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-app-fg">{config.title}</h3>
        <p className="text-sm text-app-fg-muted mt-1">{config.description}</p>
      </div>

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

        {config.reportKey === 'cs_orders' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">CS order filters (optional)</p>
            <FormSelect
              label="Status"
              value={exportStatus}
              onChange={(e) => setExportStatus(e.target.value)}
              options={[
                { value: '', label: 'Any status' },
                { value: 'UNPROCESSED', label: 'Unprocessed' },
                { value: 'CS_ASSIGNED', label: 'CS assigned' },
                { value: 'CS_ENGAGED', label: 'CS engaged' },
                { value: 'CONFIRMED', label: 'Confirmed' },
                { value: 'ALLOCATED', label: 'Allocated' },
                { value: 'DELIVERED', label: 'Delivered' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
            {csAgentOptions.length > 0 && (
              <SearchableSelect
                label="Assigned closer"
                value={exportAssignedCsId}
                onChange={setExportAssignedCsId}
                options={csAgentOptions}
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

        {config.reportKey === 'cs_team' && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">CS team filters (optional)</p>
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
                { value: 'ALLOCATED_TO_3PL', label: 'Allocated to 3PL' },
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
          <input type="hidden" name="datePreset" value={preset} />
          <input type="hidden" name="startDate" value={startDate} />
          <input type="hidden" name="endDate" value={endDate} />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={includeCurrentFilters} onChange={() => setIncludeCurrentFilters((v) => !v)} />
          <span className="text-sm text-app-fg">Include current page filters</span>
        </label>

        {isExporting && (
          <div className="space-y-1.5">
            <p className="text-xs text-app-fg-muted">Generating file…</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-border">
              <div className="h-full w-full max-w-[40%] animate-pulse rounded-full bg-brand-500" />
            </div>
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
