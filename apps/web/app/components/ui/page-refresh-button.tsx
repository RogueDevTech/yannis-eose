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

  const mergedClassName = [
    iconOnly
      ? 'btn-primary !px-0 !h-9 !min-h-0 w-9 shrink-0 md:bg-app-hover md:text-app-fg md:hover:opacity-90 md:focus:ring-surface-400'
      : 'btn-secondary btn-sm',
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

