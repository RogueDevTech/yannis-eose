import { forwardRef, useEffect, useState } from 'react';
import { TextInput } from './text-input';

type TextInputProps = React.ComponentProps<typeof TextInput>;

type Coerce = 'integer' | 'decimal';

interface NumberInputProps
  extends Omit<TextInputProps, 'value' | 'onChange' | 'defaultValue' | 'type' | 'inputMode'> {
  /** Current numeric value. `null` renders as an empty field. */
  value: number | null;
  /**
   * Fired with the final clamped numeric value once the user has finished editing
   * (on blur, on Enter, or after a programmatic clamp). Never fires mid-typing
   * with a half-typed value — the displayed text can be empty without forcing
   * the parent state to snap back.
   */
  onValueChange: (value: number) => void;
  /** Fired when the field commits to an empty value and `allowEmpty` is enabled. */
  onValueCleared?: () => void;
  /** Minimum accepted value. Clamped on blur. */
  min?: number;
  /** Maximum accepted value. Clamped on blur. */
  max?: number;
  /**
   * Value to use if the user blurs an empty / invalid field.
   * Defaults to `min` (or `0` when no min is set).
   */
  fallbackValue?: number;
  /** When true, an empty commit stays empty instead of snapping to a fallback value. */
  allowEmpty?: boolean;
  /** Integer (default) or decimal. Decimal allows `.` while typing. */
  coerce?: Coerce;
  /**
   * Fire `onValueChange` on every keystroke (as soon as the text parses to a
   * number) instead of waiting for blur/Enter. The displayed text is left
   * untouched while typing — no mid-type clamp or reformat — so callers that
   * want a live reaction (e.g. SmartPick) get one without the field snapping.
   * Blur/Enter still run the usual clamp + format pass.
   */
  commitOnChange?: boolean;
  /**
   * Number of decimals when rendering a decimal value back to the field
   * (only used after blur / external change). Default: max 4 fraction digits.
   */
  maxFractionDigits?: number;
  /** Show thousand-separator commas in the displayed value. Default false. */
  useGrouping?: boolean;
}

/**
 * Drop-in replacement for `<TextInput type="number">` that **does not** force
 * the field back to a fallback value on every keystroke.
 *
 * Why this exists: the old pattern
 *
 * ```ts
 * onChange={(e) => {
 *   const n = parseInt(e.target.value, 10);
 *   setQty(Number.isFinite(n) && n > 0 ? n : 1);
 * }}
 * ```
 *
 * snaps the displayed value back to `1` the instant the user clears the field
 * (because `parseInt('', 10)` is `NaN`). The visible workaround was "type a
 * digit first, then delete the leading 1." NumberInput keeps an internal
 * string state and only commits a parsed number on blur/Enter/programmatic
 * change, so an empty input stays empty while the user is editing.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onValueChange,
      onValueCleared,
      min,
      max,
      fallbackValue,
      allowEmpty = false,
      coerce = 'integer',
      maxFractionDigits = 4,
      commitOnChange = false,
      useGrouping = false,
      onBlur,
      onKeyDown,
      ...rest
    },
    ref,
  ) => {
    const formatNumber = (n: number | null): string => {
      if (n === null) return '';
      if (!Number.isFinite(n)) return '';
      if (coerce === 'integer') {
        const s = String(Math.trunc(n));
        return useGrouping ? addThousandSeparators(s) : s;
      }
      // Avoid scientific notation + trailing zeros the user didn't type.
      const fixed = n.toFixed(maxFractionDigits);
      const clean = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
      if (!useGrouping) return clean;
      const [intPart, decPart] = clean.split('.');
      return decPart != null
        ? `${addThousandSeparators(intPart)}.${decPart}`
        : addThousandSeparators(intPart);
    };

    const [text, setText] = useState<string>(() => formatNumber(value));

    // Sync display when `value` changes from outside (parent reset, programmatic
    // clamp, optimistic update). We only resync if the parsed text differs from
    // the new value — preserves trailing decimals and leading zeros while typing.
    useEffect(() => {
      const parsed = parseFinite(text.replace(/,/g, ''), coerce);
      if ((parsed === null && value !== null) || (parsed !== null && parsed !== value)) {
        setText(formatNumber(value));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- formatNumber + parseFinite are stable
    }, [value, coerce]);

    const commit = (raw: string) => {
      const parsed = parseFinite(raw.replace(/,/g, ''), coerce);
      if (parsed === null && allowEmpty) {
        setText('');
        if (value !== null) onValueCleared?.();
        return;
      }
      const fb = fallbackValue ?? min ?? 0;
      let next = parsed === null ? fb : parsed;
      if (typeof min === 'number' && next < min) next = min;
      if (typeof max === 'number' && next > max) next = max;
      // Round to integer if integer mode (in case the user typed "3.7" in an int field).
      if (coerce === 'integer') next = Math.trunc(next);
      setText(formatNumber(next));
      if (next !== value) onValueChange(next);
    };

    return (
      <TextInput
        ref={ref}
        {...rest}
        type="text"
        inputMode={coerce === 'integer' ? 'numeric' : 'decimal'}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          // Allow empty + typing — only filter characters that can never be
          // part of a number for the chosen mode. We don't validate here;
          // commit() does the clamp/coerce on blur.
          // When useGrouping is on, allow commas in input and strip them for the stored text.
          const allowed =
            coerce === 'integer'
              ? raw.replace(useGrouping ? /[^\d,-]/g : /[^\d-]/g, '').replace(/,/g, '')
              : raw.replace(useGrouping ? /[^\d.,-]/g : /[^\d.\-]/g, '').replace(/,/g, '');
          setText(useGrouping ? addThousandSeparators(allowed) : allowed);
          // Eager mode: report the parsed value immediately so callers can
          // react on type. Text is left as-is (no clamp/format) so the user
          // can keep typing — blur still runs the full commit pass.
          if (commitOnChange) {
            const parsed = parseFinite(allowed, coerce);
            if (parsed === null) {
              if (allowEmpty && value !== null) onValueCleared?.();
            } else if (parsed !== value) {
              onValueChange(parsed);
            }
          }
        }}
        onBlur={(e) => {
          commit(e.currentTarget.value);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
          }
          onKeyDown?.(e);
        }}
      />
    );
  },
);
NumberInput.displayName = 'NumberInput';

function parseFinite(raw: string, coerce: Coerce): number | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.') return null;
  const n = coerce === 'integer' ? parseInt(trimmed, 10) : parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function addThousandSeparators(s: string): string {
  if (!s) return s;
  const negative = s.startsWith('-');
  const abs = negative ? s.slice(1) : s;
  const [intPart, ...decParts] = abs.split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const result = decParts.length > 0 ? `${formatted}.${decParts.join('')}` : formatted;
  return negative ? `-${result}` : result;
}
