/**
 * SearchInput — a text input pre-configured with a search icon.
 * Supports debounced onChange and clear button.
 *
 * Usage (controlled with debounce):
 *   <SearchInput value={q} onChange={setQ} debounceMs={300} placeholder="Search orders..." />
 *
 * Usage (form submit):
 *   <form onSubmit={...}>
 *     <SearchInput name="q" defaultValue={q} placeholder="Search..." withSubmitButton />
 *   </form>
 */

import { forwardRef, useEffect, useRef, useState } from 'react';
import { CONTROL_HEIGHT_CLASS } from './_control-heights';

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
  onChange?: (value: string) => void;
  /** Debounce delay in ms — only fires onChange after the delay */
  debounceMs?: number;
  /** Show a clear (×) button when the input has a value */
  clearable?: boolean;
  /** Visual height — distinct from native HTML `input size` */
  controlSize?: 'sm' | 'md' | 'lg';
  /** Applied to the input wrapper. */
  wrapperClassName?: string;
  /**
   * Renders a trailing submit button **inside the input** as a small arrow
   * icon (right edge). Parent must wrap in `<form onSubmit>`. The old behavior
   * was a full-width stacked "Search" button below the input on mobile —
   * replaced 2026-05-19 per CEO mobile-density directive. Omit inside
   * dropdowns / live client filters — use `withSubmitButton={false}` (default).
   */
  withSubmitButton?: boolean;
  /** Accessible label for the submit icon button (defaults to "Search"). */
  submitButtonLabel?: string;
  /** @deprecated kept for backwards compatibility — no longer used. */
  submitButtonClassName?: string;
}

const sizeClasses = {
  sm: 'h-8 pl-7 pr-3 text-xs placeholder:text-xs',
  md: `${CONTROL_HEIGHT_CLASS} pl-8 pr-3 text-sm placeholder:text-sm`,
  lg: 'h-10 pl-9 pr-3 text-base placeholder:text-base',
};

const iconSizeClasses = {
  sm: 'left-2 w-3.5 h-3.5',
  md: 'left-2.5 w-4 h-4',
  lg: 'left-3 w-4.5 h-4.5',
};

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      onChange,
      debounceMs,
      clearable = true,
      controlSize = 'md',
      wrapperClassName = '',
      withSubmitButton = false,
      submitButtonLabel = 'Search',
      submitButtonClassName = '',
      className = '',
      value: controlledValue,
      defaultValue,
      ...rest
    }: SearchInputProps,
    ref
  ) => {
    const isControlled = controlledValue !== undefined;
    const [internalValue, setInternalValue] = useState(defaultValue ?? '');
    const displayValue = isControlled ? controlledValue : internalValue;
    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      return () => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
      };
    }, []);

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const val = e.target.value;
      if (!isControlled) setInternalValue(val);

      if (!onChange) return;

      if (debounceMs) {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => onChange(val), debounceMs);
      } else {
        onChange(val);
      }
    }

    function handleClear() {
      if (!isControlled) setInternalValue('');
      onChange?.('');
    }

    const hasValue = String(displayValue ?? '').length > 0;

    // Left-edge icon doubles as the clear button when there's content
    // (CEO directive 2026-05-24): the typical right-side × was easy to miss, so
    // we now swap the leading search glyph for a red × that clears the input.
    const showClear = clearable && hasValue;

    // Right-side button accounting: only the submit button can sit on the right
    // edge now — clear lives on the left.
    const rightPaddingClass = withSubmitButton ? 'pr-12' : '';

    return (
      <div className={['relative md:min-w-[220px]', wrapperClassName].filter(Boolean).join(' ')}>
        {showClear ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className={[
              'absolute top-1/2 -translate-y-1/2 text-danger-600 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-danger-500/60 rounded-sm',
              iconSizeClasses[controlSize],
            ].join(' ')}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full" aria-hidden="true">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        ) : (
          <span
            className={[
              'pointer-events-none absolute top-1/2 -translate-y-1/2 text-app-fg-muted',
              iconSizeClasses[controlSize],
            ].join(' ')}
            aria-hidden="true"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full">
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        )}

        <input
          ref={ref}
          type="search"
          autoComplete="off"
          value={displayValue as string}
          onChange={handleChange}
          className={[
            'input w-full rounded-lg appearance-none transition-shadow',
            'text-app-fg placeholder:text-app-fg-muted',
            // Mobile: subtle shadow + inset ring (no border) for clear presence on small screens
            'border-0 bg-app-elevated shadow-sm ring-1 ring-inset ring-app-fg-muted/35',
            'hover:shadow hover:ring-app-fg-muted/55',
            'focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:shadow',
            // Desktop (md+): revert to subtle hairline border, no shadow/ring chrome
            'md:border md:border-app-border md:bg-app-canvas md:shadow-none md:ring-0',
            'md:hover:shadow-none md:hover:ring-0',
            'md:focus:border-brand-500 md:focus:ring-1 md:focus:ring-brand-500 md:focus:shadow-none',
            sizeClasses[controlSize],
            rightPaddingClass,
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...rest}
        />

        {withSubmitButton && (
          <button
            type="submit"
            aria-label={submitButtonLabel}
            title={submitButtonLabel}
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-7 w-9 items-center justify-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/50 bg-brand-500 text-white hover:bg-brand-600"
          >
            {/* Arrow-right "go" — iOS-style search submit. Compact, universally
                read as "execute the current input". */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </button>
        )}
      </div>
    );
  },
);

SearchInput.displayName = 'SearchInput';
