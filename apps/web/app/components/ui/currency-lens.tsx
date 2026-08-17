import { useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { useCurrenciesCatalog, useHasMultipleCurrencies, useBaseCurrency } from '~/contexts/currencies-catalog-context';

/**
 * Currency-lens control for AGGREGATE pages (dashboards, overviews) whose money
 * numbers can span multiple currencies.
 *
 * Three modes, driven by the `curLens` search param:
 *   - `base`  (default) — show only the base-currency (₦) slice. Identical to
 *     today's single-currency world; this is the value when the param is absent.
 *   - `<CODE>` — show only that currency's slice (e.g. `GHS`).
 *   - `merged` — combine every currency into a base-equivalent total by
 *     converting each with its `fxRateToBase`. Rendered as "<base> + FX".
 *
 * Presents a pill trigger (matching secondary buttons like Refresh) that opens a
 * card-style picker modal with a short description under each option — mirroring
 * the "Stats date scope" modal.
 *
 * Renders NOTHING when the company has a single active currency (feature
 * dormant), so it is a safe drop-in on any aggregate page.
 */
export function CurrencyLens({
  className,
  /**
   * Hide the "<base> + FX" merged option. Set on pages that drive a server-side
   * single-currency FILTER (e.g. Finance Overview) rather than FX-converting
   * client-side — those pages can't truly merge, so the option would mislead.
   */
  allowMerged = true,
}: {
  className?: string;
  allowMerged?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currencies = useCurrenciesCatalog();
  const multi = useHasMultipleCurrencies();
  const base = useBaseCurrency();
  const [open, setOpen] = useState(false);

  const current = searchParams.get('curLens') || 'base';

  const options = useMemo(() => {
    const nonBase = currencies.filter((c) => c.active && !c.isDefault);
    return [
      {
        value: 'base',
        label: `${base.symbol} ${base.code} only`,
        description: `Show only ${base.code} figures.`,
      },
      ...nonBase.map((c) => ({
        value: c.code,
        label: `${c.symbol} ${c.code} only`,
        description: `Show only ${c.countryName || c.code} (${c.code}) figures.`,
      })),
      ...(allowMerged
        ? [
            {
              value: 'merged',
              label: `${base.symbol} ${base.code} + FX`,
              // Explain that other currencies are converted INTO the base currency.
              description: `Combine everything into ${base.code}: other currencies are converted using their FX rate.`,
            },
          ]
        : []),
    ];
  }, [currencies, base, allowMerged]);

  if (!multi) return null;

  const active = options.find((o) => o.value === current) ?? options[0];

  const select = (value: string) => {
    setOpen(false);
    setSearchParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (!value || value === 'base') n.delete('curLens');
        else n.set('curLens', value);
        return n;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Currency view"
        title="Currency view"
        className={[
          'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-app-border bg-app-hover px-3 text-sm font-medium text-app-fg transition-colors hover:opacity-90',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="truncate">{active?.label}</span>
        <svg className="h-4 w-4 shrink-0 opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidth="max-w-xs" contentClassName="p-5 space-y-3">
        <h3 className="text-base font-semibold text-app-fg">Currency view</h3>
        <p className="text-sm text-app-fg-muted">Choose which currency the figures on this page show.</p>
        <div className="space-y-2">
          {options.map((o) => {
            const isActive = o.value === current;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => select(o.value)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  isActive
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                    : 'border-app-border bg-app-elevated hover:border-brand-400'
                }`}
              >
                <span className={`block text-sm font-medium ${isActive ? 'text-brand-700 dark:text-brand-300' : 'text-app-fg'}`}>
                  {o.label}
                </span>
                <span className="mt-0.5 block text-xs text-app-fg-muted">{o.description}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}

export type CurrencyLensMode =
  | { kind: 'base' }
  | { kind: 'single'; code: string }
  | { kind: 'merged' };

/** Read the active lens mode from the URL. `base` when absent or dormant. */
export function useCurrencyLensMode(): CurrencyLensMode {
  const [searchParams] = useSearchParams();
  const multi = useHasMultipleCurrencies();
  const raw = searchParams.get('curLens') || 'base';
  return useMemo(() => {
    if (!multi || raw === 'base') return { kind: 'base' };
    if (raw === 'merged') return { kind: 'merged' };
    return { kind: 'single', code: raw.toUpperCase() };
  }, [multi, raw]);
}
