import { useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import type { TaxBandConfig } from './payroll-prd-types';

type BandDraft = { fromAmount: string; toAmount: string; rate: string };

export function TaxBandConfigModal({
  config,
  readOnly,
  submitting,
  error,
  fetcher,
  onClose,
}: {
  config: TaxBandConfig | null;
  readOnly: boolean;
  submitting: boolean;
  error?: string;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const [bandRows, setBandRows] = useState<BandDraft[]>(() =>
    (config?.bands ?? [{ fromAmount: 0, toAmount: null, rate: 7 }]).map((b) => ({
      fromAmount: String(b.fromAmount),
      toAmount: b.toAmount != null ? String(b.toAmount) : '',
      rate: String(b.rate),
    })),
  );

  const bandsJson = useMemo(() => {
    const normalized = bandRows.map((row) => ({
      fromAmount: Math.max(0, Number(row.fromAmount) || 0),
      toAmount: row.toAmount.trim() === '' ? null : Math.max(0, Number(row.toAmount) || 0),
      rate: Math.max(0, Math.min(100, Number(row.rate) || 0)),
    }));
    return JSON.stringify(normalized.length ? normalized : [{ fromAmount: 0, toAmount: null, rate: 7 }]);
  }, [bandRows]);

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" backdropBlur contentClassName="p-6 sm:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-app-fg">
            {readOnly ? 'View tax bands' : config ? 'Edit tax bands' : 'New tax band config'}
          </h3>
        </div>
        <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg p-1 -m-1" aria-label="Close">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <ModalFetcherInlineError message={error} />

      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="saveTaxBandConfig" />
        <input type="hidden" name="bandsJson" value={bandsJson} />
        <input type="hidden" name="reliefsJson" value={JSON.stringify(config?.reliefs ?? [])} />
        {config ? <input type="hidden" name="configId" value={config.id} /> : null}

        <TextInput label="Label" name="label" required readOnly={readOnly} defaultValue={config?.label ?? 'Default PAYE'} />
        <TextInput
          label="Tax-free threshold (annual ₦)"
          name="taxFreeThreshold"
          type="number"
          min={0}
          required
          readOnly={readOnly}
          defaultValue={config ? String(Number(config.taxFreeThreshold)) : '800000'}
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-app-fg">Progressive bands</p>
          {bandRows.map((row, idx) => (
            <div key={`band-${idx}`} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:items-end">
              <div className="sm:col-span-4">
                <TextInput
                  label="From (₦)"
                  type="text"
                  inputMode="numeric"
                  readOnly={readOnly}
                  value={row.fromAmount ? Number(row.fromAmount).toLocaleString('en-NG') : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setBandRows((rows) => rows.map((r, i) => (i === idx ? { ...r, fromAmount: raw } : r)));
                  }}
                />
              </div>
              <div className="sm:col-span-4">
                <TextInput
                  label="To (₦, optional)"
                  type="text"
                  inputMode="numeric"
                  readOnly={readOnly}
                  placeholder="∞"
                  value={row.toAmount ? Number(row.toAmount).toLocaleString('en-NG') : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '');
                    setBandRows((rows) => rows.map((r, i) => (i === idx ? { ...r, toAmount: raw } : r)));
                  }}
                />
              </div>
              <div className="sm:col-span-3">
                <TextInput
                  label="Rate %"
                  type="number"
                  min={0}
                  max={100}
                  readOnly={readOnly}
                  value={row.rate}
                  onChange={(e) =>
                    setBandRows((rows) => rows.map((r, i) => (i === idx ? { ...r, rate: e.target.value } : r)))
                  }
                />
              </div>
              {!readOnly ? (
                <div className="sm:col-span-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setBandRows((rows) => rows.filter((_, i) => i !== idx))}
                  >
                    ×
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {!readOnly ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setBandRows((rows) => [...rows, { fromAmount: '0', toAmount: '', rate: '7' }])}
            >
              + Add band
            </Button>
          ) : null}
        </div>

        <TextInput
          label="Effective from"
          name="effectiveFrom"
          type="date"
          required
          readOnly={readOnly}
          defaultValue={
            config
              ? new Date(config.effectiveFrom).toISOString().slice(0, 10)
              : new Date().toISOString().slice(0, 10)
          }
        />

        <div className="flex gap-2 pt-1">
          {!readOnly ? (
            <Button type="submit" variant="primary" size="sm" loading={submitting} loadingText="Saving…">
              Save config
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
