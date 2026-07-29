import { Fragment, useCallback, useMemo, useState } from 'react';
import { Link } from '@remix-run/react';
import { useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { EmptyState } from '~/components/ui/empty-state';
import { useFetcherToast } from '~/components/ui/toast';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { ProductTierConfig, ProductTierRow } from './payroll-prd-types';

interface PayrollConfigProductsPageProps {
  configs: ProductTierConfig[];
  products?: Array<{ id: string; name: string }>;
  canWrite: boolean;
  /** Controlled create modal state from parent. */
  createOpen?: boolean;
  onCreateClose?: () => void;
}

type TierDraft = { fromPct: string; toPct: string; ratePerOrder: string };

function formatTierSummary(rows: ProductTierRow[]): string {
  if (!rows.length) return 'No tiers';
  return rows
    .map((r) => {
      const to = r.toPct != null ? `${r.toPct}%` : '∞';
      return `${r.fromPct}-${to}: ₦${Number(r.ratePerOrder).toLocaleString('en-NG')}/order`;
    })
    .join(' · ');
}

function formatEffective(from: string, to: string | null): string {
  const fromLabel = new Date(from).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!to) return `${fromLabel}: Ongoing`;
  const toLabel = new Date(to).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fromLabel}: ${toLabel}`;
}

export function PayrollConfigProductsPage({ configs, products = [], canWrite, createOpen, onCreateClose }: PayrollConfigProductsPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [editConfig, setEditConfig] = useState<ProductTierConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const isCreateOpen = showCreate || !!createOpen;

  useFetcherToast(fetcher.data, {
    successMessage: 'Product tier config saved',
    skipErrorToast: showCreate || !!editConfig,
  });

  const handleSaveSuccess = useCallback(() => {
    setShowCreate(false);
    setEditConfig(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSaveSuccess, { intent: 'saveProductTierConfig' });

  const columns: CompactTableColumn<ProductTierConfig>[] = useMemo(
    () => [
      {
        key: 'product',
        header: 'Product',
        hideable: false,
        render: (row) => (
          <Fragment>
            <span className="font-medium text-app-fg">{row.productName}</span>
            {!row.active ? (
              <span className="ml-2 badge-danger text-2xs">Inactive</span>
            ) : null}
          </Fragment>
        ),
      },
      {
        key: 'tiers',
        header: 'Tier rules',
        minWidth: 'min-w-[200px]',
        cellClassName: 'max-w-[320px]',
        cellTitle: (row) => formatTierSummary(row.tierRows),
        render: (row) => (
          <span className="text-xs text-app-fg-muted truncate block">{formatTierSummary(row.tierRows)}</span>
        ),
      },
      {
        key: 'effective',
        header: 'Effective',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">{formatEffective(row.effectiveFrom, row.effectiveTo)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        hideable: false,
        render: (row) =>
          canWrite ? (
            <CompactTableActionButton tone="brand" onClick={() => setEditConfig(row)}>
              Edit
            </CompactTableActionButton>
          ) : (
            <CompactTableActionButton onClick={() => setEditConfig(row)}>View</CompactTableActionButton>
          ),
      },
    ],
    [canWrite],
  );

  return (
    <div className="space-y-4">
      {configs.length === 0 ? (
        <EmptyState
          title="No product tier configs for this company"
          description={
            canWrite
              ? 'Create a config to define DR-based bonus rates per product.'
              : 'Configs will appear here once payroll administrators set them up.'
          }
        />
      ) : (
        <CompactTable<ProductTierConfig>
          columnVisibilityKey="hr.payroll.config.products"
          columns={columns}
          rows={configs}
          rowKey={(r) => r.id}
          emptyTitle="No configs"
          emptyDescription=""
          renderMobileCard={(row) => (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-app-fg leading-snug">{row.productName}</p>
                {!row.active ? (
                  <span className="badge-danger text-2xs">Inactive</span>
                ) : null}
              </div>
              <p className="text-xs text-app-fg-muted">
                {row.tierRows.length} {row.tierRows.length === 1 ? 'tier' : 'tiers'}
              </p>
              <p className="text-xs text-app-fg-muted truncate">
                {formatEffective(row.effectiveFrom, row.effectiveTo)}
              </p>
            </div>
          )}
        />
      )}

      {(isCreateOpen || editConfig) && (
        <ProductTierConfigModal
          config={editConfig}
          products={products}
          readOnly={!canWrite}
          submitting={fetcher.state === 'submitting'}
          error={surface.errorMatchingIntent('saveProductTierConfig') ?? undefined}
          fetcher={fetcher}
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowCreate(false);
            setEditConfig(null);
            onCreateClose?.();
          }}
        />
      )}
    </div>
  );
}

function ProductTierConfigModal({
  config,
  products,
  readOnly,
  submitting,
  error,
  fetcher,
  onClose,
}: {
  config: ProductTierConfig | null;
  products: Array<{ id: string; name: string }>;
  readOnly: boolean;
  submitting: boolean;
  error?: string;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
}) {
  const [selectedProductId, setSelectedProductId] = useState(config?.productId ?? '');
  const selectedProductName = products.find((p) => p.id === selectedProductId)?.name ?? config?.productName ?? '';

  const [tierRows, setTierRows] = useState<TierDraft[]>(() =>
    (config?.tierRows ?? [{ fromPct: 0, toPct: 100, ratePerOrder: 0 }]).map((r) => ({
      fromPct: String(r.fromPct),
      toPct: r.toPct != null ? String(r.toPct) : '',
      ratePerOrder: String(r.ratePerOrder),
    })),
  );

  const tierRowsJson = useMemo(() => {
    const normalized = tierRows
      .map((row) => ({
        fromPct: Math.max(0, Math.min(100, Number(row.fromPct) || 0)),
        toPct: row.toPct.trim() === '' ? null : Math.max(0, Math.min(100, Number(row.toPct) || 0)),
        ratePerOrder: Math.max(0, Number(row.ratePerOrder) || 0),
      }))
      .filter((r) => r.fromPct >= 0);
    return JSON.stringify(normalized.length ? normalized : [{ fromPct: 0, toPct: 100, ratePerOrder: 0 }]);
  }, [tierRows]);

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" backdropBlur contentClassName="p-6 sm:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-app-fg">
            {readOnly ? 'View product tiers' : config ? 'Edit product tiers' : 'New product tier config'}
          </h3>
          <p className="text-xs text-app-fg-muted mt-1">
            DR percentage slabs map to a per-order bonus rate for this product.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-app-fg-muted hover:text-app-fg p-1 -m-1" aria-label="Close">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <ModalFetcherInlineError message={error} />

      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="saveProductTierConfig" />
        <input type="hidden" name="tierRowsJson" value={tierRowsJson} />
        {config ? <input type="hidden" name="configId" value={config.id} /> : null}

        <input type="hidden" name="productId" value={selectedProductId} />
        <input type="hidden" name="productName" value={selectedProductName} />
        <SearchableSelect
          id="productTierProduct"
          label="Product"
          value={selectedProductId}
          onChange={setSelectedProductId}
          disabled={readOnly}
          placeholder="Select a product"
          searchPlaceholder="Search products..."
          options={products.map((p) => ({ value: p.id, label: p.name }))}
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-app-fg">Tier rows</p>
          {tierRows.map((row, idx) => (
            <div key={`tier-${idx}`} className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:items-end">
              <div className="sm:col-span-3">
                <TextInput
                  label="From DR %"
                  type="number"
                  min={0}
                  max={100}
                  readOnly={readOnly}
                  disabled={readOnly}
                  value={row.fromPct}
                  onChange={(e) =>
                    setTierRows((rows) => rows.map((r, i) => (i === idx ? { ...r, fromPct: e.target.value } : r)))
                  }
                />
              </div>
              <div className="sm:col-span-3">
                <TextInput
                  label="To DR % (optional)"
                  type="number"
                  min={0}
                  max={100}
                  readOnly={readOnly}
                  disabled={readOnly}
                  placeholder="∞"
                  value={row.toPct}
                  onChange={(e) =>
                    setTierRows((rows) => rows.map((r, i) => (i === idx ? { ...r, toPct: e.target.value } : r)))
                  }
                />
              </div>
              <div className="sm:col-span-4">
                <label className="block text-sm font-medium text-app-fg-muted mb-1">Rate per order (₦)</label>
                <AmountInput
                  className="input"
                  disabled={readOnly}
                  value={row.ratePerOrder}
                  onChange={(v) =>
                    setTierRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ratePerOrder: v } : r)))
                  }
                />
              </div>
              {!readOnly ? (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => setTierRows((rows) => rows.filter((_, i) => i !== idx))}
                  >
                    Remove
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
              onClick={() => setTierRows((rows) => [...rows, { fromPct: '0', toPct: '', ratePerOrder: '' }])}
            >
              + Add tier
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

        {config ? (
          <div className="rounded-lg bg-app-hover px-3 py-2 text-xs text-app-fg-muted">
            Saving creates a new version and closes the current effective row.
          </div>
        ) : null}

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

      {readOnly && config ? (
        <div className="text-xs text-app-fg-muted border-t border-app-border pt-3">
          Preview: {formatTierSummary(config.tierRows)} · Total tiers: {config.tierRows.length}
        </div>
      ) : null}
    </Modal>
  );
}
