/**
 * NairaPrice — formats a numeric value as ₦ currency (default), or in another
 * currency when `currencyCode` is a non-NGN code (multi-currency orders).
 * Always uses tabular-nums for alignment in tables.
 *
 * Usage:
 *   <NairaPrice amount={150000} />                    → ₦150,000
 *   <NairaPrice amount={150000.5} decimals={2} />     → ₦150,000.50
 *   <NairaPrice amount={-5000} colorize />            → red/green by sign
 *   <NairaPrice amount={1500} currencyCode="GHS" />   → GH₵1,500
 */
import { useCurrenciesCatalog } from '~/contexts/currencies-catalog-context';

interface NairaPriceProps {
  amount: number | string | null | undefined;
  /** Decimal places (default 0) */
  decimals?: number;
  /** Apply green/red coloring based on sign */
  colorize?: boolean;
  /** Show a dash instead of ₦0 for zero values */
  zeroAsDash?: boolean;
  /** Text size class override */
  className?: string;
  /** Wrapper element (default span) */
  as?: 'span' | 'p' | 'div' | 'td';
  /** Frozen currency of the amount. NGN/absent → ₦ (unchanged); else that currency's symbol. */
  currencyCode?: string | null;
}

export function NairaPrice({
  amount,
  decimals = 0,
  colorize = false,
  zeroAsDash = false,
  className = '',
  as: Tag = 'span',
  currencyCode,
}: NairaPriceProps) {
  const currencies = useCurrenciesCatalog();
  const numeric = amount === null || amount === undefined ? null : Number(amount);

  if (numeric === null || isNaN(numeric)) {
    return <Tag className={['tabular-nums text-app-fg-muted', className].filter(Boolean).join(' ')}>—</Tag>;
  }

  if (zeroAsDash && numeric === 0) {
    return <Tag className={['tabular-nums text-app-fg-muted', className].filter(Boolean).join(' ')}>—</Tag>;
  }

  // Use en-US digit grouping to avoid narrow no-break spaces (U+202F) and other
  // locale-specific separators that read as "garbage" before the amount.
  const formatted = Math.abs(numeric).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const sign = numeric < 0 ? '-' : '';
  // Default \u20A6; if a non-NGN currency is given, use its configured symbol.
  const code = (currencyCode || 'NGN').toUpperCase();
  const currencyInfo = code === 'NGN' ? undefined : currencies.find((c) => c.code.toUpperCase() === code);
  const symbol = code === 'NGN' ? '\u20A6' : currencyInfo?.symbol ?? code;

  const colorClass = colorize
    ? numeric > 0
      ? 'text-success-600 dark:text-success-400'
      : numeric < 0
        ? 'text-danger-600 dark:text-danger-400'
        : 'text-app-fg-muted'
    : '';

  // Tint non-base amounts in the currency's accent colour (base stays neutral).
  // `colorize` (signed green/red) takes precedence \u2014 never override it.
  const accent = !colorize && currencyInfo && !currencyInfo.isDefault ? currencyInfo.color ?? null : null;

  return (
    <Tag
      className={['tabular-nums', colorClass, className].filter(Boolean).join(' ')}
      style={accent ? { color: accent } : undefined}
    >
      {sign}
      {symbol}
      {formatted}
    </Tag>
  );
}
