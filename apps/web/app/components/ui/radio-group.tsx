interface RadioOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

type RadioGroupLayout = 'vertical' | 'horizontal' | 'card';

interface RadioGroupProps<T extends string = string> {
  name: string;
  options: RadioOption<T>[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  layout?: RadioGroupLayout;
  className?: string;
}

export function RadioGroup<T extends string = string>({
  name,
  options,
  value,
  defaultValue,
  onChange,
  label,
  hint,
  error,
  required,
  layout = 'vertical',
  className = '',
}: RadioGroupProps<T>) {
  const hasError = Boolean(error);

  const containerClass = {
    vertical: 'flex flex-col gap-2',
    horizontal: 'flex flex-wrap gap-3',
    card: 'grid grid-cols-1 gap-2 sm:grid-cols-2',
  }[layout];

  return (
    <fieldset className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label && (
        <legend className="text-xs font-medium text-app-fg-muted">
          {label}
          {required && <span className="ml-0.5 text-danger-500">*</span>}
        </legend>
      )}

      <div className={containerClass}>
        {options.map((opt) => {
          const isChecked = value !== undefined ? value === opt.value : undefined;

          if (layout === 'card') {
            return (
              <label
                key={opt.value}
                className={[
                  'relative flex cursor-pointer rounded-lg border p-3 transition-colors',
                  isChecked
                    ? 'border-brand-500 bg-brand-500/5'
                    : 'border-app-border bg-app-canvas hover:bg-app-hover',
                  opt.disabled ? 'cursor-not-allowed opacity-50' : '',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name={name}
                  value={opt.value}
                  checked={isChecked}
                  defaultChecked={defaultValue === opt.value}
                  disabled={opt.disabled}
                  required={required}
                  onChange={() => onChange?.(opt.value)}
                  className="sr-only"
                />
                <div className="flex w-full items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-app-fg">{opt.label}</p>
                    {opt.description && (
                      <p className="mt-0.5 text-xs text-app-fg-muted">{opt.description}</p>
                    )}
                  </div>
                  <span
                    className={[
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      isChecked ? 'border-brand-500' : 'border-app-border-strong',
                    ].join(' ')}
                  >
                    {isChecked && (
                      <span className="h-2 w-2 rounded-full bg-brand-500" />
                    )}
                  </span>
                </div>
              </label>
            );
          }

          return (
            <label
              key={opt.value}
              className={[
                'flex cursor-pointer items-start gap-2.5',
                opt.disabled ? 'cursor-not-allowed opacity-50' : '',
              ].join(' ')}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={isChecked}
                defaultChecked={defaultValue === opt.value}
                disabled={opt.disabled}
                required={required}
                onChange={() => onChange?.(opt.value)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-500"
              />
              <div>
                <p className="text-sm text-app-fg">{opt.label}</p>
                {opt.description && (
                  <p className="text-xs text-app-fg-muted">{opt.description}</p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {(error || hint) && (
        <p className={['text-xs', hasError ? 'text-danger-500' : 'text-app-fg-muted'].join(' ')}>
          {error ?? hint}
        </p>
      )}
    </fieldset>
  );
}
