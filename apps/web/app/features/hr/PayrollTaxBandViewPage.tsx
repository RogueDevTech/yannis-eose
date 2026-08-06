import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { NairaPrice } from '~/components/ui/naira-price';
import { useFetcherToast } from '~/components/ui/toast';
import { useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { PayePreviewCalculator } from './PayePreviewCalculator';
import type { TaxBandConfig, PayeBandRow, PayeReliefRow } from './payroll-prd-types';
import { TaxBandConfigModal } from './TaxBandConfigModal';

interface PayrollTaxBandViewPageProps {
  config: TaxBandConfig;
  canWrite: boolean;
}

function formatBandRange(band: PayeBandRow): string {
  const from = `₦${Number(band.fromAmount).toLocaleString('en-NG')}`;
  const to = band.toAmount != null ? `₦${Number(band.toAmount).toLocaleString('en-NG')}` : '∞';
  return `${from} to ${to}`;
}

export function PayrollTaxBandViewPage({ config, canWrite }: PayrollTaxBandViewPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const [showEdit, setShowEdit] = useState(false);

  useFetcherToast(fetcher.data, {
    successMessage: 'Tax band config saved',
    skipErrorToast: showEdit,
  });
  useCloseOnFetcherSuccess(fetcher, () => setShowEdit(false), { intent: 'saveTaxBandConfig' });

  const effectiveFrom = new Date(config.effectiveFrom).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const effectiveTo = config.effectiveTo
    ? new Date(config.effectiveTo).toLocaleDateString('en-NG', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Ongoing';

  return (
    <div className="space-y-4">
      <PageHeader
        title={config.label}
        backTo="/hr/payroll/config/roles?tab=tax"
        mobileInlineActions
        description={`Effective ${effectiveFrom}: ${effectiveTo}`}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Tax band toolbar"
            desktopActions
            desktopActionsLabel="Actions"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
              </div>
            }
            sheet={({ closeSheet }) =>
              canWrite ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="h-12 w-full"
                  onClick={() => {
                    closeSheet();
                    setShowEdit(true);
                  }}
                >
                  Edit bands
                </Button>
              ) : null
            }
          />
        }
      />

      <MobileDateFilterRow hideDate />

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-app-fg">How this config works</h3>
        <p className="text-sm text-app-fg-muted">
          Annual income up to{' '}
          <span className="font-medium text-app-fg tabular-nums">
            <NairaPrice amount={Number(config.taxFreeThreshold)} />
          </span>{' '}
          is tax-free. Amounts above that are taxed using the progressive bands below.
        </p>
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-app-fg-muted">Tax-free threshold (annual)</dt>
            <dd className="font-medium tabular-nums text-app-fg">
              <NairaPrice amount={Number(config.taxFreeThreshold)} />
            </dd>
          </div>
          <div>
            <dt className="text-app-fg-muted">Bands</dt>
            <dd className="font-medium text-app-fg">{config.bands.length}</dd>
          </div>
        </dl>
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-app-fg">Progressive bands</h3>
        {config.bands.length === 0 ? (
          <p className="text-sm text-app-fg-muted">No bands configured.</p>
        ) : (
          <ul className="space-y-2">
            {config.bands.map((band, idx) => (
              <li
                key={`band-${idx}`}
                className="rounded-lg border border-app-border bg-app-hover/30 px-3 py-2 text-sm text-app-fg"
              >
                <span className="text-xs font-semibold text-app-fg-muted mr-2">#{idx + 1}</span>
                Tax <span className="font-medium tabular-nums">{band.rate}%</span> on income from{' '}
                <span className="font-medium tabular-nums">{formatBandRange(band)}</span>.
              </li>
            ))}
          </ul>
        )}
      </div>

      {config.reliefs.length > 0 ? (
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-app-fg">Reliefs</h3>
          <ul className="space-y-2">
            {config.reliefs.map((relief: PayeReliefRow, idx) => (
              <li
                key={`relief-${idx}`}
                className="rounded-lg border border-app-border bg-app-hover/30 px-3 py-2 text-sm text-app-fg"
              >
                <span className="font-medium">{relief.name}</span>
                <span className="text-app-fg-muted">
                  {' · '}
                  {relief.basis.replace(/_/g, ' ').toLowerCase()}
                  {relief.rate != null ? ` · ${relief.rate}%` : ''}
                  {relief.amount != null ? ` · ₦${Number(relief.amount).toLocaleString('en-NG')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PayePreviewCalculator />

      <p className="text-xs text-app-fg-muted px-0.5">
        Back to{' '}
        <Link to="/hr/payroll/config/roles?tab=tax" className="text-brand-600 dark:text-brand-400 hover:underline">
          Tax bands list
        </Link>
        .
      </p>

      {showEdit ? (
        <TaxBandConfigModal
          config={config}
          readOnly={false}
          submitting={fetcher.state === 'submitting'}
          error={surface.errorMatchingIntent('saveTaxBandConfig') ?? undefined}
          fetcher={fetcher}
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowEdit(false);
          }}
        />
      ) : null}
    </div>
  );
}
