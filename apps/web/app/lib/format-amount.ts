/**
 * Format and parse amount/price strings with thousand separators.
 * Used by AmountInput for display and form submission.
 */

/**
 * Strips any non-numeric characters except decimal point and optional minus.
 * Used to validate and sanitize user input — only numbers allowed.
 */
export function sanitizeNumericInput(
  value: string,
  allowNegative = false
): string {
  if (value === '') return '';
  let s = value.replace(/,/g, '');
  let neg = '';
  if (allowNegative && s.startsWith('-')) {
    neg = '-';
    s = s.slice(1);
  }
  s = s.replace(/-/g, '').replace(/[^\d.]/g, '');
  const parts = s.split('.');
  if (parts.length > 1) {
    s = parts[0] + '.' + parts.slice(1).join('').replace(/\./g, '');
  }
  return neg + s;
}

/**
 * Strips commas from a formatted display string for submission.
 * e.g. "1,000,000.50" -> "1000000.50"
 */
export function parseAmountRaw(display: string): string {
  return display.replace(/,/g, '');
}

/**
 * Formats a raw numeric string with thousand separators (en-NG locale).
 * Max 2 decimal places. Handles empty, partial input, and decimals.
 * e.g. "1000000" -> "1,000,000", "1000000.5" -> "1,000,000.5"
 */
export function formatAmountDisplay(raw: string): string {
  if (raw === '' || raw === '-') return raw;
  const sanitized = sanitizeNumericInput(raw, raw.startsWith('-'));
  if (sanitized === '' || sanitized === '-') return sanitized;

  const parts = sanitized.split('.');
  const intPart = parts[0] ?? '';
  const decPart = (parts[1] ?? '').replace(/\D/g, '').slice(0, 2);

  const isNegative = intPart.startsWith('-');
  const digits = (isNegative ? intPart.slice(1) : intPart).replace(/\D/g, '') || '0';
  const formatted = parseInt(digits, 10).toLocaleString('en-NG');
  const withSign = isNegative ? '-' + formatted : formatted;

  if (decPart) return `${withSign}.${decPart}`;
  if (parts.length > 1) return `${withSign}.`;
  return withSign;
}
