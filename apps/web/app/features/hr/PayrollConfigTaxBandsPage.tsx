import { useCallback, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { useFetcherToast } from '~/components/ui/toast';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { PayePreviewResult, TaxBandConfig, PayeBandRow } from './payroll-prd-types';

interface PayrollConfigTaxBandsPageProps {
  configs: TaxBandConfig[];
  canWrite: boolean;
  createOpen?: boolean;
  onCreateClose?: () => void;
}

type BandDraft = { fromAmount: string; toAmount: string; rate: string };

function formatBandsSummary(bands: PayeBandRow[], threshold: string): string {
  const th = Number(threshold);
  const parts = bands.slice(0, 3).map((b) => {
    const to = b.toAmount != null ? `₦${Number(b.toAmount).toLocaleString('en-NG')}` : '∞';
    return `₦${Number(b.fromAmount).toLocaleString('en-NG')}-${to} @ ${b.rate}%`;
  });
  const suffix = bands.length > 3 ? ` +${bands.length - 3} more` : '';
  return `Free: ₦${th.toLocaleString('en-NG')} · ${parts.join(' · ')}${suffix}`;
}

export function PayrollConfigTaxBandsPage({ configs, canWrite, createOpen, onCreateClose }: PayrollConfigTaxBandsPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; preview?: PayePreviewResult }>();
  const previewFetcher = useFetcher<{ preview?: PayePreviewResult; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [editConfig, setEditConfig] = useState<TaxBandConfig | null>(null);
  const [modalReadOnly, setModalReadOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const isCreateOpen = showCreate || !!createOpen;

  const [previewGross, setPreviewGross] = useState('250000');
  const [previewTaxStatus, setPreviewTaxStatus] = useState('STANDARD_PAYE');
  const [previewSubsidy, setPreviewSubsidy] = useState('');

  const openView = useCallback((row: TaxBandConfig) => {
    setModalReadOnly(true);
    setEditConfig(row);
  }, []);
  const openEdit = useCallback((row: TaxBandConfig) => {
    setModalReadOnly(false);
    setEditConfig(row);
  }, []);

  useFetcherToast(fetcher.data, {
    successMessage: 'Tax band config saved',
    skipErrorToast: showCreate || !!editConfig,
  });

  const handleSaveSuccess = useCallback(() => {
    setShowCreate(false);
    setEditConfig(null);
    setModalReadOnly(false);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSaveSuccess, { intent: 'saveTaxBandConfig' });

  const previewResult = previewFetcher.data?.preview ?? null;

  const columns: CompactTableColumn<TaxBandConfig>[] = useMemo(
    () => [
      {
        key: 'label',
        header: 'Label',
        hideable: false,
        minWidth: 'min-w-[140px]',
        cellClassName: 'max-w-[220px]',
        render: (row) => (
          <span className="font-medium text-app-fg truncate block" title={row.label}>
            {row.label}
          </span>
        ),
      },
      {
        key: 'bands',
        header: 'Bands',
        minWidth: 'min-w-[160px]',
        cellClassName: 'max-w-[280px]',
        cellTitle: (row) => formatBandsSummary(row.bands, row.taxFreeThreshold),
        render: (row) => (
          <span className="text-xs text-app-fg-muted truncate block">
            {formatBandsSummary(row.bands, row.taxFreeThreshold)}
          </span>
        ),
      },
      {
        key: 'effective',
        header: 'Effective from',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">
            {new Date(row.effectiveFrom).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) => (
          <div className="flex items-center justify-end gap-1.5">
            <CompactTableActionButton onClick={() => openView(row)}>View</CompactTableActionButton>
            {canWrite ? (
              <CompactTableActionButton tone="brand" onClick={() => openEdit(row)}>
                Edit
              </CompactTableActionButton>
            ) : null}
          </div>
        ),
      },
    ],
    [canWrite, openView, openEdit],
  );

  const showSubsidyField = previewTaxStatus === 'EMPLOYER_SUBSIDIZED_PAYE';

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-app-fg">PAYE preview calculator</h3>
          <p className="text-xs text-app-fg-muted mt-0.5">
            Uses the default band engine on the server. Confirm thresholds against official FIRS
            publications before go-live.
          </p>
        </div>
        <previewFetcher.Form
          method="post"
          className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3"
        >
          <input type="hidden" name="intent" value="previewPaye" />
          <div className="w-full sm:w-44 min-w-0">
            <label className="block text-sm font-medium text-app-fg-muted mb-1">Monthly gross (₦)</label>
            <AmountInput
              name="monthlyGross"
              className="input w-full"
              value={previewGross}
              onChange={setPreviewGross}
            />
          </div>
          <div className="w-full sm:w-52 min-w-0">
            <FormSelect
              label="Tax status"
              name="taxStatus"
              value={previewTaxStatus}
              onChange={(e) => setPreviewTaxStatus(e.target.value)}
              options={[
                { value: 'STANDARD_PAYE', label: 'Standard PAYE' },
                { value: 'EMPLOYER_SUBSIDIZED_PAYE', label: 'Employer subsidized' },
                { value: 'GROSS_NO_DEDUCTION', label: 'Gross, no deduction' },
              ]}
            />
          </div>
          {showSubsidyField ? (
            <div className="w-full sm:w-40 min-w-0">
              <TextInput
                label="Employer subsidy %"
                name="employerSubsidyPercent"
                type="number"
                min={0}
                max={100}
                value={previewSubsidy}
                onChange={(e) => setPreviewSubsidy(e.target.value)}
              />
            </div>
          ) : (
            <input type="hidden" name="employerSubsidyPercent" value="" />
          )}
          <div className="w-full sm:w-auto shrink-0">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="w-full sm:w-auto"
              loading={previewFetcher.state === 'submitting'}
              loadingText="Calculating…"
            >
              Preview PAYE
            </Button>
          </div>
        </previewFetcher.Form>

        {previewFetcher.data?.error ? (
          <p className="text-sm text-danger-600 dark:text-danger-400">{previewFetcher.data.error}</p>
        ) : null}

        {previewResult ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-3 border-t border-app-border">
            <PreviewStat label="Monthly gross" value={<NairaPrice amount={previewResult.monthlyGross} />} />
            <PreviewStat label="Annual tax" value={<NairaPrice amount={previewResult.annualTax} />} />
            <PreviewStat label="Monthly PAYE" value={<NairaPrice amount={previewResult.monthlyPaye} />} />
            <PreviewStat label="Employee PAYE" value={<NairaPrice amount={previewResult.employeePaye} />} />
          </div>
        ) : null}
      </div>

      {configs.length === 0 ? (
        <EmptyState
          title="No tax band configs"
          description={
            canWrite
              ? 'Create a versioned PAYE configuration for payroll runs.'
              : 'Tax band configs will appear here once payroll administrators set them up.'
          }
        />
      ) : (
        <CompactTable<TaxBandConfig>
          columnVisibilityKey="hr.payroll.config.tax-bands"
          columns={columns}
          rows={configs}
          rowKey={(r) => r.id}
          emptyTitle="No configs"
          emptyDescription=""
          renderMobileCard={(row) => (
            <div className="space-y-1">
              <p className="text-sm font-semibold text-app-fg leading-snug">{row.label}</p>
              <p className="text-xs text-app-fg-muted">
                {row.bands.length} {row.bands.length === 1 ? 'band' : 'bands'} · Free ₦
                {Number(row.taxFreeThreshold).toLocaleString('en-NG')}
              </p>
              <p className="text-xs text-app-fg-muted">
                From{' '}
                {new Date(row.effectiveFrom).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            </div>
          )}
        />
      )}

      {(isCreateOpen || editConfig) && (
        <TaxBandConfigModal
          config={editConfig}
          readOnly={showCreate ? false : modalReadOnly || !canWrite}
          submitting={fetcher.state === 'submitting'}
          error={surface.errorMatchingIntent('saveTaxBandConfig') ?? undefined}
          fetcher={fetcher}
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowCreate(false);
            setEditConfig(null);
            setModalReadOnly(false);
            onCreateClose?.();
          }}
        />
      )}
    </div>
  );
}

function PreviewStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-app-hover px-3 py-2">
      <p className="text-2xs text-app-fg-muted uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-app-fg mt-0.5">{value}</p>
    </div>
  );
}

function TaxBandConfigModal({
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
