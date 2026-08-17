import { useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { useCurrenciesCatalog, useHasMultipleCurrencies, useBaseCurrency } from '~/contexts/currencies-catalog-context';

interface Props {
  /** The search-param key this filter drives. Defaults to 'currency'. */
  paramKey?: string;
  className?: string;
}

/**
 * Currency filter for order / finance LISTS. Renders NOTHING when the company
 * has a single active currency (feature dormant), so it's a safe drop-in.
 *
 * Presents a pill trigger (matching secondary buttons like Refresh) that opens a
 * card-style picker modal — mirroring the "Stats date scope" / currency-view
 * modals. It lists ONE card per active currency (no "All currencies" option) and
 * defaults to the base currency, syncing the `currency` search param (and
 * resetting `page`). Lists show a single currency at a time.
 */
export function CurrencyFilterSelect({ paramKey = 'currency', className }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const currencies = useCurrenciesCatalog();
  const multi = useHasMultipleCurrencies();
  const base = useBaseCurrency();
  const [open, setOpen] = useState(false);

  const options = useMemo(
    () =>
      currencies
        .filter((c) => c.active)
        .map((c) => ({
          value: c.code,
          label: `${c.symbol} ${c.code}`,
          description: `Show only ${c.countryName || c.code} (${c.code}) orders.`,
        })),
    [currencies],
  );

  if (!multi) return null;

  // No param → default to the base currency (the list loader defaults to base too).
  const current = (searchParams.get(paramKey) || base.code).toUpperCase();
  const active = options.find((o) => o.value.toUpperCase() === current) ?? options[0];

  const select = (code: string) => {
    setOpen(false);
    const next = new URLSearchParams(searchParams);
    next.set(paramKey, code);
    next.delete('page');
    setSearchParams(next, { preventScrollReset: true });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Currency"
        title="Currency"
        className={[
          'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-app-border bg-app-hover px-3 text-sm font-medium text-app-fg transition-colors hover:opacity-90',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="truncate">{active?.label ?? `${base.symbol} ${base.code}`}</span>
        <svg className="h-4 w-4 shrink-0 opacity-70" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidth="max-w-xs" contentClassName="p-5 space-y-3">
        <h3 className="text-base font-semibold text-app-fg">Currency</h3>
        <p className="text-sm text-app-fg-muted">Choose which currency's orders to show.</p>
        <div className="space-y-2">
          {options.map((o) => {
            const isActive = o.value.toUpperCase() === current;
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
