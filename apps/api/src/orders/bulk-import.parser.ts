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
