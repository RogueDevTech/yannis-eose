import { useMemo, useState } from 'react';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { FormSelect } from './form-select';
import { Modal } from './modal';
import { TextInput } from './text-input';
import { EXPORT_DATE_PRESET_OPTIONS, type ExportConfig } from '~/lib/export-config';

type Props = {
  open: boolean;
  onClose: () => void;
  config: ExportConfig;
  initialFilters?: Record<string, unknown>;
};

export function ExportModal({ open, onClose, config, initialFilters = {} }: Props) {
  const [selectedColumns, setSelectedColumns] = useState<string[]>(config.defaultColumns);
  const [preset, setPreset] = useState<(typeof EXPORT_DATE_PRESET_OPTIONS)[number]['value']>('this_month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeCurrentFilters, setIncludeCurrentFilters] = useState(true);

  const columnsJson = useMemo(() => JSON.stringify(selectedColumns), [selectedColumns]);
  const filtersJson = useMemo(
    () => JSON.stringify(includeCurrentFilters ? initialFilters : {}),
    [includeCurrentFilters, initialFilters],
  );

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" contentClassName="p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-app-fg">{config.title}</h3>
        <p className="text-sm text-app-fg-muted mt-1">{config.description}</p>
      </div>

      <form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="exportReport" />
        <input type="hidden" name="reportKey" value={config.reportKey} />
        <input type="hidden" name="columns" value={columnsJson} />
        <input type="hidden" name="filters" value={filtersJson} />

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

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={selectedColumns.length === 0}>
            Export CSV
          </Button>
        </div>
      </form>
    </Modal>
  );
}

