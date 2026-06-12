import { forwardRef } from 'react';
import { Link } from '@remix-run/react';
import type { LinkProps } from '@remix-run/react';

/**
 * Compact action affordance for in-table action columns.
 *
 * Sizing rule (locked — see CLAUDE.md → "Table Action Buttons"):
 * - Border: 1px (`border`), NOT the 2px `btn-*` border. Heavy borders inflate
 *   row height past the text-only cells in the same row, breaking compact
 *   table density.
 * - Padding: `px-2 py-0.5`. Total button height ≈ 22px — fits inside the
 *   table's `py-3` cell padding without forcing the row to grow.
 * - Text: `text-xs font-medium leading-none`.
 *
 * Variant rule:
 * - `primary` (blue) — the row's main affordance. Use for `View` / `Open` /
 *   `Edit` / `Approve` / `Confirm`. **When a row has only one action, it
 *   should always be `primary`** so the cell has clear weight.
 * - `neutral` (grey) — secondary actions paired with a primary one
 *   (e.g. `Add stock` next to `View`). Quieter visual rank.
 * - `danger` (red) — destructive / negative actions: `Remove`, `Delete`,
 *   `Cancel`, `Reject`, `Dispute`, `Deactivate`. Uses warm danger-50 hover
 *   so the user can distinguish from neutral on focus/hover.
 *
 * Usage:
 * ```tsx
 * <TableActionButton to={`/admin/inventory/${level.id}`} variant="primary">View</TableActionButton>
 * <TableActionButton onClick={() => openAdjust(level, 'decrease')} variant="danger">Remove</TableActionButton>
 * <TableActionButton onClick={() => openAdjust(level, 'increase')} variant="neutral">Add</TableActionButton>
 * ```
 */
export type TableActionVariant = 'primary' | 'neutral' | 'danger' | 'success';

const SHARED_BASE =
  'inline-flex min-h-10 items-center justify-center px-3 py-2 rounded-lg text-sm font-medium leading-none transition-colors focus:outline-none focus-visible:ring-1 disabled:opacity-50 disabled:cursor-not-allowed md:min-h-0 md:px-0 md:py-0 md:rounded md:text-xs';

const VARIANT_CLASSES: Record<TableActionVariant, string> = {
  primary:
    'text-brand-600 hover:text-brand-700 hover:bg-brand-50 focus-visible:ring-brand-500 dark:text-brand-400 dark:hover:text-brand-300 dark:hover:bg-brand-900/20',
  neutral:
    'text-app-fg-muted hover:text-app-fg hover:bg-app-hover focus-visible:ring-surface-400',
  danger:
    'text-danger-600 hover:text-danger-700 hover:bg-danger-50 focus-visible:ring-danger-500 dark:text-danger-400 dark:hover:text-danger-300 dark:hover:bg-danger-900/20',
  success:
    'text-success-600 hover:text-success-700 hover:bg-success-50 focus-visible:ring-success-500 dark:text-success-400 dark:hover:text-success-300 dark:hover:bg-success-900/20',
};

export function tableActionClass(variant: TableActionVariant, extra?: string): string {
  return [SHARED_BASE, VARIANT_CLASSES[variant], extra].filter(Boolean).join(' ');
}

interface BaseProps {
  variant?: TableActionVariant;
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

interface ButtonProps extends BaseProps, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'disabled' | 'children'> {
  /** Optional. Either `onClick` (interactive button) or `type="submit"`
   *  (inside a `<fetcher.Form>` / `<Form>`) is the typical use. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Distinguishes the union — `as="button"` is the implicit default. */
  as?: 'button';
  to?: never;
  /** When true, render as a non-interactive `<span>` styled like the variant.
   * Use for optimistic-row View placeholders that mustn't navigate. */
  inert?: boolean;
}

interface LinkActionProps extends BaseProps, Omit<LinkProps, 'className' | 'children'> {
  /** Routes to a Remix `<Link>`. Pass `to` (relative or absolute Remix path). */
  to: LinkProps['to'];
  as?: 'link';
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  inert?: boolean;
}

interface InertProps extends BaseProps {
  /** Render a non-interactive placeholder (used for in-flight optimistic rows). */
  inert: true;
  to?: never;
  onClick?: never;
  as?: never;
}

export type TableActionButtonProps = ButtonProps | LinkActionProps | InertProps;

/**
 * The component itself — discriminated union on `to` (Link) vs `inert` vs default (button).
 * Use a forwardRef so consumers can attach refs (e.g. for keyboard shortcuts on rows).
 */
export const TableActionButton = forwardRef<
  HTMLButtonElement | HTMLAnchorElement | HTMLSpanElement,
  TableActionButtonProps
>(function TableActionButton(props, ref) {
  const { variant = 'primary', className, children } = props;
  const classes = tableActionClass(variant, className);

  if ('inert' in props && props.inert) {
    return (
      <span
        ref={ref as React.Ref<HTMLSpanElement>}
        className={`${classes} opacity-50 cursor-not-allowed`}
        aria-disabled
      >
        {children}
      </span>
    );
  }

  if ('to' in props && props.to) {
    const { to, prefetch = 'intent', replace, state, reloadDocument, preventScrollReset, relative, onClick } = props as LinkActionProps;
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        to={to}
        prefetch={prefetch}
        replace={replace}
        state={state}
        reloadDocument={reloadDocument}
        preventScrollReset={preventScrollReset}
        relative={relative}
        onClick={onClick}
        className={classes}
      >
        {children}
      </Link>
    );
  }

  const { onClick, disabled, type = 'button', ...rest } = props as ButtonProps;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={classes}
      {...rest}
    >
      {children}
    </button>
  );
});
