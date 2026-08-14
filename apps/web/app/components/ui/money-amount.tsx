import { NairaPrice } from '~/components/ui/naira-price';
import { formatMoney } from '~/lib/format-amount';
import { useCurrenciesCatalog } from '~/contexts/currencies-catalog-context';

interface Props {
  amount: number | string | null | undefined;
  /** The record's frozen currency code. Defaults to base/NGN. */
  currencyCode?: string | null;
  className?: string;
  /** Fraction digits (defaults to 0, matching NairaPrice/formatNaira). */
  maximumFractionDigits?: number;
}

/**
 * Currency-aware money display. Renders identically to <NairaPrice> for NGN /
 * base currency (so single-currency surfaces are unchanged), and uses the
 * currency's symbol via `formatMoney` for any other currency. Drop-in wherever
 * a record carries a frozen `currencyCode` (orders, remittances, etc.).
 */
export function MoneyAmount({ amount, currencyCode, className, maximumFractionDigits }: Props) {
  const currencies = useCurrenciesCatalog();
  const num = amount == null ? null : typeof amount === 'number' ? amount : Number(amount);

  // Resolve the currency; default to base (NGN). NGN → keep the exact NairaPrice
  // rendering (symbol + any special formatting/theming it applies).
  const code = (currencyCode || 'NGN').toUpperCase();
  const info = currencies.find((c) => c.code.toUpperCase() === code);
  const isBase = !info || info.isDefault || code === 'NGN';

  if (isBase) {
    return <NairaPrice amount={num} className={className} />;
  }
  if (num == null || Number.isNaN(num)) {
    return <span className={className}>—</span>;
  }
  return <span className={className}>{formatMoney(num, info, { maximumFractionDigits })}</span>;
}
