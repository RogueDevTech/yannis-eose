/**
 * FormField — wraps any input with a label, hint, and error message.
 * Use this when you need a custom input that doesn't fit TextInput/FormSelect/Textarea
 * but still needs consistent label + error layout.
 *
 * For standard inputs prefer TextInput, FormSelect, Textarea, or AmountInput
 * which already include built-in label/hint/error support.
 */

interface FormFieldProps {
  /** Plain text or rich content (e.g. an inline spinner + status chip). */
  label?: React.ReactNode;
  /** Plain text or rich content (e.g. an inline link) rendered under the input. */
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  /** htmlFor — passed to the label's `for` attribute */
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ label, hint, error, required, htmlFor, children, className = '' }: FormFieldProps) {
  const hasError = Boolean(error);

  return (
    <div className={['flex flex-col gap-1', className].filter(Boolean).join(' ')}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-app-fg-muted"
        >
          {label}
          {required && <span className="ml-0.5 text-danger-500">*</span>}
        </label>
      )}

      {children}

      {(error || hint) && (
        <p className={['text-xs', hasError ? 'text-danger-500' : 'text-app-fg-muted'].join(' ')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
