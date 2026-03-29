import { forwardRef } from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Show character count (requires maxLength) */
  showCount?: boolean;
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      hint,
      error,
      showCount = false,
      wrapperClassName = '',
      className = '',
      required,
      id,
      maxLength,
      value,
      defaultValue,
      ...rest
    },
    ref
  ) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const hasError = Boolean(error);

    const currentLength =
      typeof value === 'string' ? value.length : typeof defaultValue === 'string' ? defaultValue.length : 0;

    const baseClass = [
      'input w-full rounded-lg border transition-colors resize-none',
      'bg-app-canvas text-app-fg placeholder:text-app-fg-muted',
      'border-app-border focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
      'px-3 py-2 text-sm',
      hasError ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500' : '',
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

        <textarea
          ref={ref}
          id={inputId}
          required={required}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          className={baseClass}
          rows={rest.rows ?? 4}
          {...rest}
        />

        <div className="flex items-start justify-between gap-2">
          {(error || hint) && (
            <p className={['text-xs', hasError ? 'text-danger-500' : 'text-app-fg-muted'].join(' ')}>
              {error ?? hint}
            </p>
          )}
          {showCount && maxLength && (
            <p
              className={[
                'ml-auto shrink-0 text-xs tabular-nums',
                currentLength >= maxLength ? 'text-danger-500' : 'text-app-fg-muted',
              ].join(' ')}
            >
              {currentLength}/{maxLength}
            </p>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
