/**
 * StatRow — a label + value pair in a horizontal layout.
 * Used in financial P&L waterfalls, summary panels, and detail cards.
 *
 * StatRowGroup stacks multiple StatRows with dividers.
 */

import { NairaPrice } from '~/components/ui/naira-price';

type StatRowVariant = 'default' | 'total' | 'subtotal' | 'deduction' | 'highlight';

interface StatRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Shortcut: pass a number and it renders as <NairaPrice> */
  amount?: number | null;
  /** Sign indicator prefix (+/-) */
  sign?: '+' | '-' | 'none';
  variant?: StatRowVariant;
  /** Indented (for nested line items) */
  indent?: boolean;
  className?: string;
}

const variantLabelClass: Record<StatRowVariant, string> = {
  default: 'text-sm text-app-fg-muted',
  total: 'text-sm font-bold text-app-fg',
  subtotal: 'text-sm font-semibold text-app-fg',
  deduction: 'text-sm text-danger-600 dark:text-danger-400',
  highlight: 'text-sm font-semibold text-brand-600 dark:text-brand-400',
};

const variantValueClass: Record<StatRowVariant, string> = {
  default: 'text-sm font-medium text-app-fg tabular-nums',
  total: 'text-sm font-bold text-app-fg tabular-nums',
  subtotal: 'text-sm font-semibold text-app-fg tabular-nums',
  deduction: 'text-sm font-medium text-danger-600 dark:text-danger-400 tabular-nums',
  highlight: 'text-sm font-semibold text-brand-600 dark:text-brand-400 tabular-nums',
};

export function StatRow({ label, value, amount, sign, variant = 'default', indent = false, className = '' }: StatRowProps) {
  const displayValue =
    amount !== undefined ? (
      <NairaPrice
        amount={amount}
        colorize={variant === 'default' || variant === 'deduction'}
      />
    ) : (
      value
    );

  const signLabel = sign === '+' ? '+ ' : sign === '-' ? '− ' : '';

  return (
    <div
      className={[
        'flex items-center justify-between gap-4 py-1.5',
        indent ? 'pl-4' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={variantLabelClass[variant]}>{label}</span>
      <span className={variantValueClass[variant]}>
        {signLabel}
        {displayValue}
      </span>
    </div>
  );
}

interface StatRowGroupProps {
  children: React.ReactNode;
  /** Separator lines between rows */
  divided?: boolean;
  /** Top border above the group (e.g. before a total row) */
  topBorder?: boolean;
  className?: string;
}

export function StatRowGroup({ children, divided = false, topBorder = false, className = '' }: StatRowGroupProps) {
  return (
    <div
      className={[
        'flex flex-col',
        divided ? 'divide-y divide-app-border' : '',
        topBorder ? 'border-t border-app-border pt-2 mt-2' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
