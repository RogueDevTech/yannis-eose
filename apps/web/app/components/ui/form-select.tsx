import { forwardRef } from 'react';

type FormSelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface FormSelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  /** Flat options list */
  options?: SelectOption[];
  /** Grouped options — if provided, takes precedence over `options` */
  groups?: SelectGroup[];
  /** Placeholder option shown when no value is selected */
  placeholder?: string;
  /** Visual height — distinct from native HTML `select size` (row count) */
  controlSize?: FormSelectSize;
  wrapperClassName?: string;
}

const sizeClasses: Record<FormSelectSize, string> = {
  sm: 'h-8 px-2.5 pr-7 text-xs',
  md: 'h-9 px-3 pr-8 text-sm',
  lg: 'h-10 px-3.5 pr-9 text-base',
};

const chevronSizeClasses: Record<FormSelectSize, string> = {
  sm: 'right-2 w-3 h-3',
  md: 'right-2.5 w-3.5 h-3.5',
  lg: 'right-3 w-4 h-4',
};

const ChevronDownIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path
      fillRule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(
  (
    {
      label,
      hint,
      error,
      options,
      groups,
      placeholder,
      controlSize = 'md',
      wrapperClassName = '',
      className = '',
      required,
      id,
      ...rest
    },
    ref
  ) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const hasError = Boolean(error);

    const baseClass = [
      'w-full appearance-none rounded-lg border transition-colors cursor-pointer',
      'bg-app-canvas text-app-fg',
      'border-app-border focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
      hasError ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500' : '',
      sizeClasses[controlSize],
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={['flex flex-col gap-1', wrapperClassName].filter(Boolean).join(' ')}>
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-app-fg-muted">
            {label}
            {required && <span className="ml-0.5 text-danger-500">*</span>}
          </label>
        )}

        <div className="relative">
          <select ref={ref} id={inputId} required={required} className={baseClass} {...rest}>
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}

            {groups
              ? groups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((opt) => (
                      <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                ))
              : options?.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))}

            {rest.children}
          </select>

          <span
            className={[
              'pointer-events-none absolute top-1/2 -translate-y-1/2 text-app-fg-muted',
              chevronSizeClasses[controlSize],
            ].join(' ')}
          >
            <ChevronDownIcon className="w-full h-full" />
          </span>
        </div>

        {(error || hint) && (
          <p className={['text-xs', hasError ? 'text-danger-500' : 'text-app-fg-muted'].join(' ')}>
            {error ?? hint}
          </p>
        )}
      </div>
    );
  }
);

FormSelect.displayName = 'FormSelect';
