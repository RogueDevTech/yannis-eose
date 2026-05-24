import { forwardRef } from 'react';
import { CONTROL_HEIGHT_CLASS } from './_control-heights';

type TextInputSize = 'sm' | 'md' | 'lg';

interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Label displayed above the input */
  label?: string;
  /** Helper text below the input */
  hint?: string;
  /** Error message — replaces hint when set */
  error?: string;
  /** Icon node rendered on the left side */
  leftIcon?: React.ReactNode;
  /** Icon node rendered on the right side */
  rightIcon?: React.ReactNode;
  /**
   * Interactive node rendered on the right side (e.g. show/hide password button).
   * Unlike `rightIcon`, this is pointer-events-enabled and won't bake in
   * `pointer-events-none`. Mutually exclusive with `rightIcon`.
   */
  rightAction?: React.ReactNode;
  /** Text/node rendered as a fixed left addon (e.g. "https://") */
  leftAddon?: React.ReactNode;
  /** Text/node rendered as a fixed right addon (e.g. ".com") */
  rightAddon?: React.ReactNode;
  /** Visual height — distinct from native HTML `input size` (width in chars) */
  controlSize?: TextInputSize;
  /** Wrapper className */
  wrapperClassName?: string;
  /** Required asterisk next to label */
  required?: boolean;
}

const sizeClasses: Record<TextInputSize, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: `${CONTROL_HEIGHT_CLASS} px-3 text-sm`,
  lg: 'h-10 px-3.5 text-base',
};

const iconSizeClasses: Record<TextInputSize, string> = {
  sm: 'left-2 w-3.5 h-3.5',
  md: 'left-2.5 w-4 h-4',
  lg: 'left-3 w-4.5 h-4.5',
};

const iconPaddingClasses: Record<TextInputSize, { left: string; right: string }> = {
  sm: { left: 'pl-7', right: 'pr-7' },
  md: { left: 'pl-8', right: 'pr-8' },
  lg: { left: 'pl-9', right: 'pr-9' },
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  (
    {
      label,
      hint,
      error,
      leftIcon,
      rightIcon,
      rightAction,
      leftAddon,
      rightAddon,
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

    const baseInputClass = [
      'input w-full rounded-lg border transition-colors',
      'bg-app-canvas text-app-fg placeholder:text-app-fg-muted',
      'border-app-border focus:border-brand-500 focus:ring-1 focus:ring-brand-500 focus:outline-none',
      hasError ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500' : '',
      leftAddon ? 'rounded-l-none' : '',
      rightAddon ? 'rounded-r-none' : '',
      leftIcon ? iconPaddingClasses[controlSize].left : '',
      rightIcon || rightAction ? iconPaddingClasses[controlSize].right : '',
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

        <div className="flex items-stretch">
          {leftAddon && (
            <span className="flex items-center rounded-l-lg border border-r-0 border-app-border bg-app-elevated px-3 text-sm text-app-fg-muted">
              {leftAddon}
            </span>
          )}

          <div className="relative flex-1">
            {leftIcon && (
              <span
                className={[
                  'pointer-events-none absolute top-1/2 -translate-y-1/2 text-app-fg-muted',
                  iconSizeClasses[controlSize],
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {leftIcon}
              </span>
            )}

            <input ref={ref} id={inputId} required={required} className={baseInputClass} {...rest} />

            {rightIcon && (
              <span
                className={[
                  'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-app-fg-muted',
                  controlSize === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {rightIcon}
              </span>
            )}

            {rightAction && !rightIcon && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center text-app-fg-muted">
                {rightAction}
              </span>
            )}
          </div>

          {rightAddon && (
            <span className="flex items-center rounded-r-lg border border-l-0 border-app-border bg-app-elevated px-3 text-sm text-app-fg-muted">
              {rightAddon}
            </span>
          )}
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

TextInput.displayName = 'TextInput';
