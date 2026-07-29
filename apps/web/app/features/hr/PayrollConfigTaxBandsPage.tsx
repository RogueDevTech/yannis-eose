import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { EmptyState } from '~/components/ui/empty-state';
import { useFetcherToast } from '~/components/ui/toast';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { TaxBandConfig, PayeBandRow } from './payroll-prd-types';
import { TaxBandConfigModal } from './TaxBandConfigModal';

interface PayrollConfigTaxBandsPageProps {
  configs: TaxBandConfig[];
  canWrite: boolean;
  createOpen?: boolean;
  onCreateClose?: () => void;
}

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
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const isCreateOpen = showCreate || !!createOpen;

  useFetcherToast(fetcher.data, {
    successMessage: 'Tax band config saved',
    skipErrorToast: isCreateOpen,
  });

  const handleSaveSuccess = useCallback(() => {
    setShowCreate(false);
    onCreateClose?.();
  }, [onCreateClose]);
  useCloseOnFetcherSuccess(fetcher, handleSaveSuccess, { intent: 'saveTaxBandConfig' });

  const columns: CompactTableColumn<TaxBandConfig>[] = useMemo(
    () => [
      {
        key: 'label',
        header: 'Label',
        hideable: false,
        minWidth: 'min-w-[140px]',
        cellClassName: 'max-w-[220px]',
        render: (row) => (
          <Link
            to={`/hr/payroll/config/tax-bands/${row.id}`}
            className="font-medium text-app-fg hover:underline truncate block"
            title={row.label}
          >
            {row.label}
          </Link>
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
          <CompactTableActionButton to={`/hr/payroll/config/tax-bands/${row.id}`} tone="brand">
            View
          </CompactTableActionButton>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
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
            <Link
              to={`/hr/payroll/config/tax-bands/${row.id}`}
              prefetch="intent"
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
            >
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
            </Link>
          )}
        />
      )}

      {isCreateOpen && (
        <TaxBandConfigModal
          config={null}
          readOnly={false}
          submitting={fetcher.state === 'submitting'}
          error={surface.errorMatchingIntent('saveTaxBandConfig') ?? undefined}
          fetcher={fetcher}
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowCreate(false);
            onCreateClose?.();
          }}
        />
      )}
    </div>
  );
}
