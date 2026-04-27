import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { FormSelect } from './form-select';
import { Modal } from './modal';
import { SearchableSelect } from './searchable-select';
import { TextInput } from './text-input';
import { useToast } from './toast';
import { EXPORT_DATE_PRESET_OPTIONS, type ExportConfig } from '~/lib/export-config';
import type { ExportReportActionData } from '~/lib/export-report.server';

export type MarketingExportPicklists = {
  mediaBuyers: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  config: ExportConfig;
  initialFilters?: Record<string, unknown>;
  /** Optional extra filters for marketing_orders CSV (export-only; merged with initialFilters). */
  marketingExportPicklists?: MarketingExportPicklists;
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

export function ExportModal({ open, onClose, config, initialFilters = {}, marketingExportPicklists }: Props) {
  const fetcher = useFetcher<ExportReportActionData>();
  const { toast } = useToast();
  const [selectedColumns, setSelectedColumns] = useState<string[]>(config.defaultColumns);
  const [preset, setPreset] = useState<(typeof EXPORT_DATE_PRESET_OPTIONS)[number]['value']>('this_month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeCurrentFilters, setIncludeCurrentFilters] = useState(true);
  const [exportMediaBuyerId, setExportMediaBuyerId] = useState('');
  const [exportProductId, setExportProductId] = useState('');
  const [exportCampaignId, setExportCampaignId] = useState('');
  const lastHandledFetcherData = useRef<unknown>(null);

  const isMarketing = config.reportKey === 'marketing_orders';
  const showMarketingExtras = isMarketing && marketingExportPicklists != null;

  useEffect(() => {
    if (!open) return;
    setSelectedColumns(config.defaultColumns);
    setPreset('this_month');
    setStartDate('');
    setEndDate('');
    setIncludeCurrentFilters(true);
    setExportMediaBuyerId('');
    setExportProductId('');
    setExportCampaignId('');
    lastHandledFetcherData.current = null;
  }, [open, config.defaultColumns, config.reportKey]);

  const columnsJson = useMemo(() => JSON.stringify(selectedColumns), [selectedColumns]);

  const filtersJson = useMemo(() => {
    const base: Record<string, unknown> = includeCurrentFilters ? { ...initialFilters } : {};
    if (showMarketingExtras) {
      if (exportProductId) base.productId = exportProductId;
      if (exportCampaignId) base.campaignId = exportCampaignId;
      if (exportMediaBuyerId) base.mediaBuyerId = exportMediaBuyerId;
    }
    return JSON.stringify(base);
  }, [
    includeCurrentFilters,
    initialFilters,
    showMarketingExtras,
    exportProductId,
    exportCampaignId,
    exportMediaBuyerId,
  ]);

  const isExporting = fetcher.state === 'submitting' || fetcher.state === 'loading';

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data === lastHandledFetcherData.current) return;
    lastHandledFetcherData.current = fetcher.data;
    const d = fetcher.data;
    if (d.ok) {
      triggerCsvDownload(d.filename, d.csvContent);
      onClose();
    } else {
      toast.error('Export failed', d.error);
    }
  }, [fetcher.state, fetcher.data, onClose, toast]);

  const mediaBuyerOptions = useMemo(() => {
    if (!marketingExportPicklists) return [];
    return [
      { value: '', label: 'Use page filter / all' },
      ...marketingExportPicklists.mediaBuyers.map((u) => ({ value: u.id, label: u.name })),
    ];
  }, [marketingExportPicklists]);

  const productOptions = useMemo(() => {
    if (!marketingExportPicklists) return [];
    return [{ value: '', label: 'Any product' }, ...marketingExportPicklists.products.map((p) => ({ value: p.id, label: p.name }))];
  }, [marketingExportPicklists]);

  const campaignOptions = useMemo(() => {
    if (!marketingExportPicklists) return [];
    return [
      { value: '', label: 'Any campaign' },
      ...marketingExportPicklists.campaigns.map((c) => ({ value: c.id, label: c.name })),
    ];
  }, [marketingExportPicklists]);

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

        {showMarketingExtras && (
          <div className="space-y-3 rounded-md border border-app-border bg-app-hover/40 p-3">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Report filters (optional)</p>
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
          <Button type="submit" variant="primary" disabled={selectedColumns.length === 0 || isExporting} loading={isExporting} loadingText="Exporting…">
            Export CSV
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
