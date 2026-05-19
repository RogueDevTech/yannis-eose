import type { ButtonHTMLAttributes } from 'react';
import { useRevalidator } from '@remix-run/react';

interface PageRefreshButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick'> {
  label?: string;
  /** Icon only — hides visible label; uses `label` for `title` and `aria-label`. */
  iconOnly?: boolean;
}

export function PageRefreshButton({
  label = 'Refresh',
  iconOnly = false,
  className = '',
  disabled,
  title,
  ...rest
}: PageRefreshButtonProps) {
  const { revalidate, state } = useRevalidator();
  const isLoading = state === 'loading';

  // Match the kebab's chrome (CEO 2026-05-19) — grey fill + soft `app-border`
  // rim with a brand hover edge. Mirrors `.btn` so refresh and the mobile
  // tools trigger render identically on the same row.
  const mergedClassName = [
    iconOnly
      ? 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-app-border bg-surface-100 dark:bg-surface-800 p-0 text-app-fg-muted transition-colors duration-150 hover:border-brand-500/40 hover:bg-surface-200 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-surface-400 focus:ring-offset-2 dark:hover:border-brand-400/45 dark:hover:bg-surface-700 disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border-2 border-app-border bg-surface-100 dark:bg-surface-800 text-xs font-medium text-app-fg-muted hover:border-brand-500/40 hover:bg-surface-200 hover:text-brand-600 dark:hover:border-brand-400/45 dark:hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const accessibleName = title ?? label;

  return (
    <button
      type="button"
      onClick={() => revalidate()}
      disabled={isLoading || disabled}
      title={accessibleName}
      aria-label={iconOnly ? accessibleName : undefined}
      className={mergedClassName}
      {...rest}
    >
      <svg
        className={`w-4 h-4 shrink-0 ${isLoading ? 'animate-spin' : ''}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* Refresh / reload icon */}
        <path d="M3 4v6h6" />
        <path d="M21 20v-6h-6" />
        <path d="M5.64 19.36A9 9 0 0 1 4 12a9 9 0 0 1 9-9c2.39 0 4.57.94 6.17 2.47" />
        <path d="M18.36 4.64A9 9 0 0 1 20 12a9 9 0 0 1-9 9c-2.39 0-4.57-.94-6.17-2.47" />
      </svg>
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}

