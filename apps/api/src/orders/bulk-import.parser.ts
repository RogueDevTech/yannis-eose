import ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse';
import type { Readable } from 'node:stream';

/**
 * Streaming row reader for large import files. Yields one record per DATA row
 * (header row excluded), keyed by header name, as an async iterator so the
 * caller never holds the whole file in memory. `rowIndex` is 0-based over data
 * rows (row 0 = first row after the header) — it IS the resume cursor space.
 *
 * Supports .xlsx via ExcelJS's streaming WorkbookReader and .csv via csv-parse's
 * streaming parser. Both read incrementally off a Node Readable.
 */
export async function* streamImportRows(
  stream: Readable,
  fileType: 'xlsx' | 'csv',
): AsyncGenerator<{ rowIndex: number; record: Record<string, unknown> }> {
  // Guard the SOURCE stream's 'error' event. The GCS/S3 readable can emit
  // 'error' asynchronously (e.g. a 404 "No such object" surfaces AFTER
  // createReadStream() returns). ExcelJS's WorkbookReader pipes this stream
  // through an internal unzip pipeline and, on an immediate/zero-byte error,
  // simply HANGS — its `for await (worksheet of reader)` never yields and never
  // rejects. Merely latching the error and checking it after the loop deadlocks
  // (we never get back to the check). So we RACE the parser against a promise
  // that rejects the instant the source stream errors, and reject fast. Without
  // this the import job sits in PROCESSING forever.
  let rejectOnError: (err: Error) => void = () => {};
  let streamError: Error | null = null;
  const errorPromise = new Promise<never>((_, reject) => {
    rejectOnError = (err: Error) => reject(err);
  });
  const onError = (err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    if (!streamError) streamError = e;
    rejectOnError(e);
  };
  stream.on('error', onError);
  // Swallow the unhandled-rejection warning if the race is won by the parser
  // side (nobody awaits errorPromise then).
  errorPromise.catch(() => undefined);

  const inner = fileType === 'csv' ? streamCsvRows(stream) : streamXlsxRows(stream);

  try {
    while (true) {
      // Race the next parsed row against a source-stream error. If the stream
      // errors (e.g. 404), errorPromise rejects and we break out immediately
      // instead of waiting on a parser that will never advance.
      const next = await Promise.race([inner.next(), errorPromise]);
      if (next.done) break;
      yield next.value;
    }
    // A late error can land after the parser's iterator ended (truncated-but-
    // valid prefix, then the socket errors). Surface it so the chunk is not
    // wrongly marked COMPLETED.
    if (streamError) throw streamError;
  } catch (err) {
    // Prefer the underlying transport error over a downstream parse symptom
    // (e.g. "invalid zip") — it's the actionable root cause.
    throw streamError ?? (err instanceof Error ? err : new Error(String(err)));
  } finally {
    stream.removeListener('error', onError);
    // Destroy the source FIRST. ExcelJS's WorkbookReader iterator can be parked
    // awaiting bytes that will never come (the stream errored); calling its
    // return() while it's parked would hang the teardown too. Destroying the
    // underlying stream unblocks that pipeline so return() can settle. We also
    // do NOT await return() — fire it best-effort so a stuck ExcelJS internal
    // can never re-hang the caller (drainChunk must always get control back to
    // mark the job PAUSED/FAILED).
    stream.destroy();
    void Promise.resolve(inner.return?.(undefined)).catch(() => undefined);
  }
}

async function* streamCsvRows(
  stream: Readable,
): AsyncGenerator<{ rowIndex: number; record: Record<string, unknown> }> {
  const parser = stream.pipe(
    csvParse({
      columns: true, // first row is the header → records keyed by header name
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }),
  );
  let rowIndex = 0;
  for await (const record of parser as AsyncIterable<Record<string, unknown>>) {
    yield { rowIndex, record };
    rowIndex += 1;
  }
}

async function* streamXlsxRows(
  stream: Readable,
): AsyncGenerator<{ rowIndex: number; record: Record<string, unknown> }> {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    entries: 'emit',
    sharedStrings: 'cache',
    worksheets: 'emit',
  });

  let header: string[] | null = null;
  let dataRowIndex = 0;
  let firstSheetDone = false;

  for await (const worksheet of workbookReader) {
    // Only the first worksheet is imported (matches the browser tool's behavior).
    if (firstSheetDone) break;
    for await (const row of worksheet) {
      const values = normalizeRowValues(row);
      if (header === null) {
        header = values.map((v, i) => {
          const s = stringifyScalar(v).trim();
          return s === '' ? `col_${i}` : s;
        });
        continue;
      }
      const record: Record<string, unknown> = {};
      for (let i = 0; i < header.length; i += 1) {
        const key = header[i] ?? `col_${i}`;
        record[key] = values[i] ?? '';
      }
      yield { rowIndex: dataRowIndex, record };
      dataRowIndex += 1;
    }
    firstSheetDone = true;
  }
}

/**
 * ExcelJS row.values is 1-based (index 0 is unused). Flatten to a 0-based array
 * and coerce cell objects (rich text, hyperlinks, dates) to plain scalars.
 */
function normalizeRowValues(row: ExcelJS.Row): unknown[] {
  const raw = row.values as unknown[];
  const out: unknown[] = [];
  // raw[0] is always empty in ExcelJS; start at 1.
  for (let i = 1; i < raw.length; i += 1) {
    out.push(coerceCell(raw[i]));
  }
  return out;
}

function coerceCell(value: unknown): unknown {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v['text'] === 'string') return v['text']; // hyperlink / rich text
    if (typeof v['result'] !== 'undefined') return v['result']; // formula result
    if (Array.isArray(v['richText'])) {
      return (v['richText'] as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    }
    return stringifyScalar(value);
  }
  return value;
}

/**
 * Safe scalar stringification for cell values. Objects (which `coerceCell`
 * should already have flattened) fall back to JSON rather than the useless
 * "[object Object]" default — keeps the linter happy and the output sane.
 */
function stringifyScalar(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * Excel stores a date as a SERIAL NUMBER: days since 1899-12-30. A column that
 * is text- or general-formatted comes back from ExcelJS as that bare number
 * (only a recognised date format yields a real `Date`), so the sheet shows
 * "25/05/2026" while the cell value is 46141.
 *
 * Passing that straight to `new Date()` is the trap: JS parses a bare numeric
 * STRING as a YEAR, so "46141" becomes +046141-01-01 — a valid Date object, so
 * an isNaN guard waves it through, and Postgres then rejects it with
 * "time zone displacement out of range". That failed every row of an import.
 *
 * Accepts serials in [MIN_EXCEL_SERIAL, MAX_EXCEL_SERIAL] (~1954-2064). Outside
 * that window a number is far likelier to be a stray figure than a date, so we
 * decline it rather than invent a timestamp.
 */
const MIN_EXCEL_SERIAL = 20000; // ~1954-10-03
const MAX_EXCEL_SERIAL = 60000; // ~2064-04-04
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);

export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  if (serial < MIN_EXCEL_SERIAL || serial > MAX_EXCEL_SERIAL) return null;
  // Whole days + fractional time-of-day. Rounded to the minute: Excel serials
  // carry float noise that would otherwise yield 23:59:59.9997.
  const ms = EXCEL_EPOCH_UTC_MS + Math.round(serial * 24 * 60) * 60 * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Normalise a date cell to an ISO string, whatever shape it arrived in:
 * an Excel serial, an ISO string, or a human date ("25/05/2026", "2026-05-25").
 * Returns null when the value is absent or cannot be read as a sane date, so
 * callers fail the row with a clear message instead of writing a bogus year.
 *
 * For a TEXT date, `format` says which of M/D/YYYY and D/M/YYYY the file uses:
 * the two are indistinguishable whenever both parts are <= 12 (05/06 is 5 June
 * or 6 May), so the operator confirms it at upload rather than us guessing.
 * Where one part is > 12 it can only be the day, and the value decides on its
 * own — a mis-set format still lands on the right calendar day.
 *
 * Excel SERIAL dates carry no format and ignore `format` entirely.
 */
export function normalizeImportDate(
  value: unknown,
  format: 'MDY' | 'DMY' = 'MDY',
): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : sanifyYear(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // A bare number (or numeric string) is an Excel serial, never a year.
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const asDate = excelSerialToDate(Number(raw));
    return asDate ? sanifyYear(asDate) : null;
  }

  // Two-part numeric date. Which part is the month comes from `format`, except
  // where a part > 12 settles it on its own.
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const [, aRaw, bRaw, yRaw] = slash;
    const a = Number(aRaw);
    const b = Number(bRaw);
    let month = format === 'DMY' ? b : a;
    let day = format === 'DMY' ? a : b;
    // A part > 12 can only be the day: trust the value over the declared format.
    if (a > 12 && b <= 12) {
      month = b;
      day = a;
    } else if (b > 12 && a <= 12) {
      month = a;
      day = b;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const parsed = new Date(Date.UTC(Number(yRaw), month - 1, day));
    // Reject a rolled-over date (e.g. 02/31/2026 becoming 3 March).
    if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return Number.isNaN(parsed.getTime()) ? null : sanifyYear(parsed);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : sanifyYear(parsed);
}

/**
 * Final backstop: reject a date that parsed cleanly but lands outside any year
 * an order could plausibly carry. This is what stops a year-46141 value from
 * reaching Postgres.
 */
function sanifyYear(d: Date): string | null {
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return d.toISOString();
}
