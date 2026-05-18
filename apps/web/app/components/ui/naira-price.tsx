/**
 * NairaPrice — formats a numeric value as ₦ currency.
 * Always uses tabular-nums for alignment in tables.
 *
 * Usage:
 *   <NairaPrice amount={150000} />              → ₦150,000
 *   <NairaPrice amount={150000.5} decimals={2} /> → ₦150,000.50
 *   <NairaPrice amount={-5000} colorize />       → red for negative, green for positive
 */

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
}

export function NairaPrice({
  amount,
  decimals = 0,
  colorize = false,
  zeroAsDash = false,
  className = '',
  as: Tag = 'span',
}: NairaPriceProps) {
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
  const naira = '\u20A6';

  const colorClass = colorize
    ? numeric > 0
      ? 'text-success-600 dark:text-success-400'
      : numeric < 0
        ? 'text-danger-600 dark:text-danger-400'
        : 'text-app-fg-muted'
    : '';

  return (
    <Tag className={['tabular-nums', colorClass, className].filter(Boolean).join(' ')}>
      {sign}
      {naira}
      {formatted}
    </Tag>
  );
}
