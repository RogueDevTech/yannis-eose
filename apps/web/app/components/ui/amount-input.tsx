import { useCallback, useState } from 'react';
import { formatAmountDisplay, sanitizeNumericInput } from '~/lib/format-amount';

interface AmountInputProps {
  /** For form submission (uncontrolled). Hidden input gets this name. */
  name?: string;
  id?: string;
  placeholder?: string;
  required?: boolean;
  /** Uncontrolled default value (raw, no commas) */
  defaultValue?: string;
  /** Controlled value (raw, no commas) */
  value?: string;
  /** Controlled onChange — receives raw value */
  onChange?: (rawValue: string) => void;
  className?: string;
  /** Optional prefix e.g. "₦" — rendered as sibling, not in value */
  prefix?: string;
  /** Allow negative values (e.g. HR adjustments) */
  allowNegative?: boolean;
}

export function AmountInput({
  name,
  id,
  placeholder,
  required,
  defaultValue = '',
  value: controlledValue,
  onChange,
  className = 'input',
  prefix,
  allowNegative = false,
}: AmountInputProps) {
  const isControlled = controlledValue !== undefined;
  const [internalRaw, setInternalRaw] = useState(() => {
    const initial = isControlled ? controlledValue : defaultValue;
    return initial ?? '';
  });

  const rawValue = isControlled ? controlledValue : internalRaw;
  const displayValue = formatAmountDisplay(rawValue ?? '');

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = sanitizeNumericInput(e.target.value, allowNegative);
      if (isControlled) {
        onChange?.(next);
      } else {
        setInternalRaw(next);
      }
    },
    [allowNegative, isControlled, onChange]
  );

  return (
    <div className={prefix ? 'relative' : undefined}>
      {prefix && (
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-app-fg-muted pointer-events-none">
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        id={id}
        placeholder={placeholder}
        required={required}
        value={displayValue}
        onChange={handleChange}
        className={prefix ? `${className} pl-12` : className}
        aria-label={name ? undefined : 'Amount'}
      />
      {name && (
        <input
          type="hidden"
          name={name}
          value={rawValue ?? ''}
          readOnly
          tabIndex={-1}
          aria-hidden
        />
      )}
    </div>
  );
}
