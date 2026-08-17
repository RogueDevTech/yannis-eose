import { Link } from '@remix-run/react';
import { formatMoney, currencyByCode, toBaseAmount } from '@yannis/shared';
import { useCurrenciesCatalog, useBaseCurrency } from '~/contexts/currencies-catalog-context';
import { useCurrencyLensMode, type CurrencyLensMode } from '~/components/ui/currency-lens';

/** A per-currency money map, e.g. { NGN: 1200000, GHS: 4500 }. Keys are ISO codes. */
export type MoneyByCurrency = Record<string, number>;

interface Props {
  /** Amount per currency code. Absent/empty renders the base zero. */
  amounts: MoneyByCurrency | null | undefined;
  /** Override the lens mode; defaults to the URL-driven mode. */
  mode?: CurrencyLensMode;
  className?: string;
  /** Round to whole units (default true — matches the dashboards' glance value). */
  round?: boolean;
}

/**
 * Renders a per-currency money map under the active currency lens:
 *   - base:   just the base-currency slice (₦…), exactly like today.
 *   - single: just that currency's slice (GH₵…), or the base symbol + 0 if none.
 *   - merged: every currency converted to base via fxRateToBase and summed into
 *             one ₦-equivalent total. Any currency WITHOUT a rate can't be
 *             converted — it's shown separately with a "Set FX rate" link so no
 *             money is silently dropped.
 *
 * Single-currency companies always pass `{ NGN: x }` and mode `base`, so this is
 * a no-op wrapper around the usual ₦ render for them.
 */
export function LensedMoney({ amounts, mode, className, round = true }: Props) {
  const currencies = useCurrenciesCatalog();
  const base = useBaseCurrency();
  const urlMode = useCurrencyLensMode();
  const active = mode ?? urlMode;
  const map = amounts ?? {};

  const fmt = (amount: number, code: string) =>
    formatMoney(round ? Math.round(amount) : amount, currencyByCode(currencies, code));

  if (active.kind === 'base') {
    return <span className={className}>{fmt(map[base.code] ?? 0, base.code)}</span>;
  }

  if (active.kind === 'single') {
    return <span className={className}>{fmt(map[active.code] ?? 0, active.code)}</span>;
  }

  // merged: convert each currency to base; split off unconvertible (rate unset).
  let convertibleBaseTotal = 0;
  const unconvertible: Array<{ code: string; amount: number }> = [];
  for (const [code, amount] of Object.entries(map)) {
    if (!amount) continue;
    // Only a KNOWN catalog currency can be converted. currencyByCode() returns a
    // synthetic base-like row (isDefault:true) for unknown/deactivated codes,
    // which would otherwise be summed 1:1 into the base total — instead surface
    // it as unconvertible so no money is silently mis-rated.
    const info = currencies.find((c) => c.code.toUpperCase() === code.toUpperCase());
    const inBase = info ? toBaseAmount(amount, info) : null; // null → unset rate OR unknown code
    if (inBase == null) unconvertible.push({ code, amount });
    else convertibleBaseTotal += inBase;
  }

  return (
    <span className={className}>
      {fmt(convertibleBaseTotal, base.code)}
      {unconvertible.map((u) => (
        <span key={u.code} className="ml-2 whitespace-nowrap text-xs text-app-fg-muted">
          + {fmt(u.amount, u.code)}{' '}
          <Link to="/admin/settings/currencies" className="text-brand-500 hover:text-brand-600 underline">
            Set FX rate
          </Link>
        </span>
      ))}
    </span>
  );
}
