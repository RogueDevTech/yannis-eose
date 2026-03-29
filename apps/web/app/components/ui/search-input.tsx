/**
 * SearchInput — a text input pre-configured with a search icon.
 * Supports debounced onChange and clear button.
 *
 * Usage (controlled with debounce):
 *   <SearchInput value={q} onChange={setQ} debounceMs={300} placeholder="Search orders..." />
 *
 * Usage (form submit):
 *   <SearchInput name="q" defaultValue={q} placeholder="Search..." />
 */

import { useEffect, useRef, useState } from 'react';

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  onChange?: (value: string) => void;
  /** Debounce delay in ms — only fires onChange after the delay */
  debounceMs?: number;
  /** Show a clear (×) button when the input has a value */
  clearable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  wrapperClassName?: string;
}

const sizeClasses = {
  sm: 'h-8 pl-7 pr-3 text-xs',
  md: 'h-9 pl-8 pr-3 text-sm',
  lg: 'h-10 pl-9 pr-3 text-base',
};

const iconSizeClasses = {
  sm: 'left-2 w-3.5 h-3.5',
  md: 'left-2.5 w-4 h-4',
  lg: 'left-3 w-4.5 h-4.5',
};

export function SearchInput({
  onChange,
  debounceMs,
  clearable = true,
  size = 'md',
  wrapperClassName = '',
  className = '',
  value: controlledValue,
  defaultValue,
  ...rest
}: SearchInputProps) {
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

  return (
    <div className={['relative', wrapperClassName].filter(Boolean).join(' ')}>
      <span
        className={[
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-app-fg-muted',
          iconSizeClasses[size],
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

      <input
        type="search"
        value={displayValue as string}
        onChange={handleChange}
        className={[
          'w-full rounded-lg border transition-colors',
          'bg-app-canvas text-app-fg placeholder:text-app-fg-muted',
          'border-app-border focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
          sizeClasses[size],
          clearable && hasValue ? 'pr-7' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />

      {clearable && hasValue && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-app-fg-muted hover:text-app-fg transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </div>
  );
}
