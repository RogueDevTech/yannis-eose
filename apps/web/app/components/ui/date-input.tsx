import { forwardRef } from 'react';
import { TextInput } from './text-input';

type TextInputProps = React.ComponentProps<typeof TextInput>;
type DateInputKind = 'date' | 'time' | 'datetime-local';

interface DateInputProps extends Omit<TextInputProps, 'type'> {
  /** Which native picker to render. Defaults to `date`. */
  kind?: DateInputKind;
}

/**
 * Wrapper for native `<input type="date|time|datetime-local">` that keeps the
 * field visually consistent with the rest of the design system on mobile.
 *
 * Why this exists: raw native date/time inputs on iOS Safari render with the
 * system font + chunky chrome, and any computed `font-size < 16px` triggers a
 * zoom-on-focus. The result is rows where a date field looks 2x heavier than
 * the dropdowns next to it. We can't kill the native picker (Apple owns it),
 * but we can:
 *   1. Lock the displayed text to `text-sm` (14px) at rest — matches the
 *      surrounding form labels regardless of `controlSize`.
 *   2. Bump to `text-base` (16px) at the `sm:` breakpoint and below so iOS
 *      doesn't zoom on focus. Desktop keeps the compact 14px look.
 *   3. Apply `appearance-none` so iOS at least strips the spinner / inner
 *      shadow on date-style inputs where it can.
 *
 * Routes every date filter / range picker through the same primitive so a
 * future styling tweak lands everywhere at once.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  ({ kind = 'date', className = '', ...rest }, ref) => {
    return (
      <TextInput
        ref={ref}
        type={kind}
        // text-base on mobile (no iOS zoom), text-sm on desktop (matches
        // surrounding form chrome at the compact admin density).
        className={`appearance-none text-base sm:text-sm ${className}`}
        {...rest}
      />
    );
  },
);
DateInput.displayName = 'DateInput';
