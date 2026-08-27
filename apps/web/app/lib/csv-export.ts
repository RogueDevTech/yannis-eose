/**
 * CSV Export Utility
 * Converts arrays of objects to CSV and triggers browser download.
 */

type CsvRow = Record<string, string | number | boolean | null | undefined>;

/**
 * Force a numeric IDENTIFIER (phone, TIN, bank account/code) to stay TEXT when
 * the CSV is opened in Excel/Sheets. A long all-digit string like a `234...`
 * phone or a 10-digit account number is otherwise auto-parsed into scientific
 * notation (`2.34914E+12`) and its digits are lost. Wrapping it as `="<digits>"`
 * is the portable spreadsheet idiom for "treat this literally as text".
 *
 * Intended for identifier columns only — NOT free text. To avoid turning this
 * into a CSV-formula-injection sink, the `="..."` wrapper is applied only to
 * values that look like a phone/account/TIN (digits plus the usual separators
 * `+ - ( ) space`). Anything else is returned unchanged for `escapeField` to
 * handle as ordinary text. Empty values stay empty (no stray `=""`).
 */
export function asSpreadsheetText(value: string | number | null | undefined): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  // Only identifier-shaped values get the text-literal wrapper.
  if (!/^[\d+()\-\s]+$/.test(v)) return v;
  return `="${v}"`;
}

/**
 * Escape a CSV field value (handle commas, quotes, newlines).
 */
function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of objects to a CSV string.
 * @param data Array of flat objects
 * @param columns Column definitions: { key, label }
 */
export function toCsv(
  data: CsvRow[],
  columns: Array<{ key: string; label: string }>,
): string {
  const header = columns.map((c) => escapeField(c.label)).join(',');
  const rows = data.map((row) =>
    columns.map((c) => escapeField(row[c.key])).join(','),
  );
  return [header, ...rows].join('\n');
}

/**
 * Trigger a browser download of a CSV string.
 */
export function downloadCsv(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Shortcut: convert data to CSV and download.
 */
export function exportToCsv(
  data: CsvRow[],
  columns: Array<{ key: string; label: string }>,
  filename: string,
): void {
  const csv = toCsv(data, columns);
  downloadCsv(csv, filename);
}
