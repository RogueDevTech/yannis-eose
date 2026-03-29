import type { ButtonHTMLAttributes } from 'react';
import { useRevalidator } from '@remix-run/react';

interface PageRefreshButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick'> {
  label?: string;
}

export function PageRefreshButton({
  label = 'Refresh',
  className = '',
  disabled,
  title,
  ...rest
}: PageRefreshButtonProps) {
  const { revalidate, state } = useRevalidator();
  const isLoading = state === 'loading';

  const mergedClassName = [
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-app-fg-muted hover:text-brand-600 hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={() => revalidate()}
      disabled={isLoading || disabled}
      title={title ?? label}
      className={mergedClassName}
      {...rest}
    >
      <svg
        className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
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
      <span>{label}</span>
    </button>
  );
}

