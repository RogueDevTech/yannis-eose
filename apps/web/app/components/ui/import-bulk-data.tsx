/**
 * ImportBulkData — reusable bulk-import page shell.
 *
 * Owns: file picker (xlsx/csv), editable table, per-cell error info modal,
 * row-status icons, sequential per-row POST loop, footer counts + Import CTA.
 *
 * Per-resource hooks (users vs products vs anything else) plug in via:
 *   - `columns`           — per-column header + renderCell + error-token map
 *   - `parseSheetRow`     — sheet dict → editor's parsed shape
 *   - `resolveRow`        — parsed → resolved (validated, with errors[])
 *   - `makeEmptyRow`      — blank row factory for the "+ Row" button
 *   - `buildFormData`     — resolved row → FormData posted per row
 *   - `actionPath`/`actionIntent` — where rows are POSTed
 *
 * The contract for `actionPath` matches what /hr/users and /admin/products
 * already implement — `{ success: true, ... }` on success, `{ error: string }`
 * on failure, status code reflecting same. Per-row failures collected in the
 * status column without aborting the batch.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import * as XLSX from 'xlsx';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { InlineNotification } from '~/components/ui/inline-notification';
import { useToast } from '~/components/ui/toast';

export interface ImportColumn<TResolved> {
  /** Header text shown in the editor's `<thead>`. */
  header: string;
  /** Tailwind class controlling header / column width (e.g. `min-w-[10rem]`). */
  headerClassName?: string;
  /** Override the `<td>` wrapper class. Defaults to `px-2 py-1.5`. */
  cellClassName?: string;
  /** Substrings that resolver errors will contain when *this* cell is the
   *  problem. Used for both the per-cell red ring and the (i) → modal flow. */
  errorTokens: string[];
  /** Friendly label used as the modal title when the (i) icon is clicked. */
  errorLabel: string;
  /** Render the editable cell. Receives the resolved row + a `patch` helper
   *  that updates the parsed row (re-validation happens automatically). */
  renderCell: (ctx: {
    row: TResolved;
    rowIndex: number;
    disabled: boolean;
    errored: boolean;
    patch: (patch: Partial<TResolved>) => void;
  }) => ReactNode;
  /** Stringified value of this cell — shown as the "Current value" in the
   *  error-detail modal so operators see exactly what they typed. */
  getDisplayValue: (row: TResolved) => string;
  /** When true, the (i) error-info button is suppressed even if the row has
   *  matching errors. Use for non-data cells (e.g. checkboxes) where the
   *  error wouldn't make sense out of context. */
  hideErrorInfo?: boolean;
}

type RowStatus =
  | { state: 'pending' }
  | { state: 'in_flight' }
  | { state: 'created'; meta?: string }
  | { state: 'failed'; reason: string }
  | { state: 'invalid' };

export interface ImportBulkDataProps<
  TParsed extends { rowIndex: number },
  TResolved extends TParsed & { errors: string[] },
> {
  title: string;
  description?: string;
  /** Back link target shown in the page header. */
  backHref: string;
  /** Label for the back link button. Defaults to "← Back". */
  backLabel?: string;
  /** Singular noun used in the row counter and CTA ("user", "product"). */
  resourceLabel: string;
  /** Per-row POST endpoint (e.g. `/hr/users?index`). */
  actionPath: string;
  /** Value of the `intent` field on the per-row FormData. */
  actionIntent: string;
  /** Max rows allowed per import (default 500). */
  maxRows?: number;
  /** Where Cancel / Done buttons navigate to. Defaults to `backHref`. */
  doneHref?: string;
  /** Build the FormData body for a resolved row. The component pre-sets
   *  `intent` and `rowIndex` — the consumer adds the resource fields. */
  buildFormData: (row: TResolved) => FormData;
  /** Parse a single sheet row dict → the editor's parsed shape. */
  parseSheetRow: (row: Record<string, unknown>, sheetRowIndex: number) => TParsed;
  /** Re-validate a parsed row → resolved row carrying `errors: string[]`. */
  resolveRow: (parsed: TParsed) => TResolved;
  /** Make a blank parsed row for the "+ Row" button. */
  makeEmptyRow: (sheetRowIndex: number) => TParsed;
  /** Generate + trigger the template workbook download. Optional. */
  downloadTemplate?: () => void;
  /** Disable the Download template button (e.g. while a dependent fetch is loading). */
  downloadTemplateDisabled?: boolean;
  /** Reference content rendered under the upload card. Use for column-spec chips. */
  referenceContent?: ReactNode;
  /** Column definitions in left-to-right render order. */
  columns: ImportColumn<TResolved>[];
  /** Map a successful response payload → an optional badge label (e.g.
   *  "pending approval" for queued admin-class users). */
  parseSuccessMeta?: (data: unknown) => string | undefined;
  /** Fired after the import loop finishes, regardless of outcome. */
  onComplete?: (summary: { created: number; failed: number; total: number }) => void;
  /** Auto-navigate to `doneHref ?? backHref` once the import loop finishes.
   *  A summary toast fires first so the operator sees the result; the
   *  redirect runs ~1.2s later to give them time to read it. */
  redirectOnComplete?: boolean;
}

export function ImportBulkData<
  TParsed extends { rowIndex: number },
  TResolved extends TParsed & { errors: string[] },
>({
  title,
  description,
  backHref,
  backLabel = '← Back',
  resourceLabel,
  actionPath,
  actionIntent,
  maxRows = 500,
  doneHref,
  buildFormData,
  parseSheetRow,
  resolveRow,
  makeEmptyRow,
  downloadTemplate,
  downloadTemplateDisabled = false,
  referenceContent,
  columns,
  parseSuccessMeta,
  onComplete,
  redirectOnComplete = false,
}: ImportBulkDataProps<TParsed, TResolved>) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [parsed, setParsed] = useState<TParsed[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<RowStatus[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  /** Open-state for the per-cell error-detail modal. */
  const [errorDetail, setErrorDetail] = useState<{
    rowNumber: number;
    fieldLabel: string;
    value: string;
    errors: string[];
  } | null>(null);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolved = useMemo<TResolved[]>(
    () => parsed.map((r) => resolveRow(r)),
    [parsed, resolveRow],
  );
  const validCount = resolved.filter((r) => r.errors.length === 0).length;
  const invalidCount = resolved.length - validCount;

  function handleFileChange(file: File) {
    setParseError(null);
    setStatuses([]);
    setImportDone(false);
    setSelectedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error('Could not read file.');
        const wb = XLSX.read(data, { type: 'binary' });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) throw new Error('The workbook is empty.');
        const ws = wb.Sheets[firstSheet];
        if (!ws) throw new Error('Could not read the first sheet.');
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        if (rows.length === 0) {
          throw new Error('No rows found in the sheet. Add data under the headers and re-upload.');
        }
        if (rows.length > maxRows) {
          throw new Error(`Found ${rows.length} rows; limit is ${maxRows} per import.`);
        }
        const parsedRows = rows.map((row, idx) => parseSheetRow(row, idx + 2));
        setParsed(parsedRows);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Could not parse the file.');
      }
    };
    reader.onerror = () => setParseError('Could not read the file. Try again.');
    reader.readAsBinaryString(file);
  }

  function patchRow(idx: number, patch: Partial<TResolved>) {
    setParsed((prev) =>
      prev.map((r, i) => (i === idx ? ({ ...r, ...patch } as TParsed) : r)),
    );
    // Editing a row clears its prior import status — a row that previously
    // failed shouldn't show the red badge after the operator's edit.
    setStatuses((prev) =>
      prev.length === 0 ? prev : prev.map((s, i) => (i === idx ? { state: 'pending' as const } : s)),
    );
  }

  function removeRow(idx: number) {
    setParsed((prev) => prev.filter((_, i) => i !== idx));
    setStatuses((prev) => (prev.length === 0 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function removeAllInvalid() {
    setParsed((prev) => {
      const keepIndices = resolved
        .map((r, i) => (r.errors.length === 0 ? i : -1))
        .filter((i) => i >= 0);
      return keepIndices.map((i) => prev[i]!).filter(Boolean);
    });
    setStatuses([]);
  }

  function addBlankRow() {
    setParsed((prev) => [...prev, makeEmptyRow(prev.length + 2)]);
  }

  async function runImport() {
    cancelRef.current = false;
    setIsImporting(true);
    setImportDone(false);
    const initial: RowStatus[] = resolved.map((r) =>
      r.errors.length > 0 ? { state: 'invalid' } : { state: 'pending' },
    );
    setStatuses(initial);

    let createdAcc = 0;
    let failedAcc = 0;

    for (let i = 0; i < resolved.length; i += 1) {
      if (cancelRef.current) break;
      const row = resolved[i]!;
      if (row.errors.length > 0) continue;

      setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'in_flight' } : s)));

      const formData = buildFormData(row);
      formData.set('intent', actionIntent);
      formData.set('rowIndex', String(i));

      try {
        const res = await fetch(actionPath, { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data as { success?: boolean }).success === true) {
          const meta = parseSuccessMeta?.(data);
          createdAcc += 1;
          setStatuses((prev) =>
            prev.map((s, idx) => (idx === i ? { state: 'created', meta } : s)),
          );
        } else {
          const reason = (data as { error?: string }).error ?? `HTTP ${res.status}`;
          failedAcc += 1;
          setStatuses((prev) =>
            prev.map((s, idx) => (idx === i ? { state: 'failed', reason } : s)),
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Network error';
        failedAcc += 1;
        setStatuses((prev) =>
          prev.map((s, idx) => (idx === i ? { state: 'failed', reason } : s)),
        );
      }
    }

    setIsImporting(false);
    setImportDone(true);
    onComplete?.({ created: createdAcc, failed: failedAcc, total: resolved.length });

    // Summary toast — single round-up regardless of outcome. Created-count
    // and resource label come from the consumer's `resourceLabel` prop so it
    // reads naturally for whichever resource ("3 users created", "5 products
    // created").
    const noun = `${resourceLabel}${createdAcc === 1 ? '' : 's'}`;
    if (createdAcc > 0 && failedAcc === 0) {
      toast.success(`Import complete`, `${createdAcc} ${noun} created.`);
    } else if (createdAcc > 0 && failedAcc > 0) {
      toast.warning(
        `Import finished with errors`,
        `${createdAcc} ${noun} created, ${failedAcc} failed.`,
      );
    } else if (failedAcc > 0) {
      toast.error(`Import failed`, `${failedAcc} of ${resolved.length} rows failed.`);
    }

    if (redirectOnComplete) {
      // Brief delay so the toast + completed status icons are visible before
      // we navigate away. The dest defaults to backHref so the operator
      // lands on the listing they came from.
      const dest = doneHref ?? backHref;
      window.setTimeout(() => navigate(dest), 1200);
    }
  }

  const completedCount = statuses.filter((s) => s.state === 'created').length;
  const failedCount = statuses.filter((s) => s.state === 'failed').length;

  // Warn before navigating away mid-edit / mid-import. Browsers ignore the
  // custom message text but still show "Leave site?" — that's the goal.
  useEffect(() => {
    if (parsed.length === 0) return;
    if (importDone) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [parsed.length, importDone]);

  const cancelHref = doneHref ?? backHref;

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        mobileInlineActions
        description={description}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Import tools"
            sheetSubtitle={<span>Navigation</span>}
            triggerAriaLabel="Import toolbar"
            showMobileRefresh={false}
            desktop={
              <Link to={backHref} prefetch="intent" className="btn-secondary btn-sm">
                {backLabel}
              </Link>
            }
            sheet={
              <Link to={backHref} prefetch="intent" className="btn-secondary btn-sm w-full justify-center">
                {backLabel}
              </Link>
            }
          />
        }
      />

      {/* ── Upload card ───────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-app-fg">1. Upload</h2>
            <p className="text-xs text-app-fg-muted">
              .xlsx, .xls, or .csv. Max {maxRows} rows. Headers are case-insensitive — see the
              column reference below for what each cell expects.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {downloadTemplate ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={downloadTemplate}
                disabled={isImporting || downloadTemplateDisabled}
                title="Download an .xlsx template with example rows + a Reference sheet"
              >
                <span className="inline-flex items-center gap-1.5">
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 16V4m0 12l-4-4m4 4l4-4M4 20h16"
                    />
                  </svg>
                  Download template
                </span>
              </Button>
            ) : null}
            {/* Native <input type="file"> styling is unfixable across browsers,
                so we hide it via `sr-only` and drive it with a styled button. */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileChange(file);
                // Reset so re-picking the SAME file fires onChange again.
                e.target.value = '';
              }}
              className="sr-only"
              aria-label="Choose spreadsheet to import"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
            >
              <span className="inline-flex items-center gap-1.5">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                {selectedFileName ? 'Replace file' : 'Choose file'}
              </span>
            </Button>
          </div>
        </div>
        {selectedFileName ? (
          <p
            className="-mt-1 text-xs text-app-fg-muted truncate"
            title={selectedFileName}
          >
            <span className="text-app-fg-muted">Loaded:</span>{' '}
            <span className="font-medium text-app-fg">{selectedFileName}</span>
          </p>
        ) : null}
        {parseError ? <InlineNotification variant="danger" message={parseError} /> : null}

        {referenceContent ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                Expected columns
              </p>
              <p className="text-[10px] text-app-fg-muted">
                Header names are case-insensitive ·{' '}
                <span className="text-danger-500">*</span> required
              </p>
            </div>
            {referenceContent}
          </div>
        ) : null}
      </div>

      {/* ── Editable preview / editor ─────────────────────────────────── */}
      {parsed.length > 0 ? (
        <div className="card space-y-3 p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-app-border">
            <div>
              <h2 className="text-sm font-semibold text-app-fg">2. Preview &amp; edit</h2>
              <p className="text-xs text-app-fg-muted">
                Rows in{' '}
                <span className="text-success-700 dark:text-success-400 font-medium">green</span>{' '}
                are ready to import. Edit any cell to fix the others.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-app-fg">
                <strong>{resolved.length}</strong> total
              </span>
              <span className="text-success-700 dark:text-success-400">
                <strong>{validCount}</strong> ready
              </span>
              {invalidCount > 0 ? (
                <span className="text-danger-700 dark:text-danger-400">
                  <strong>{invalidCount}</strong> need fixing
                </span>
              ) : null}
              <Button type="button" variant="secondary" size="sm" onClick={addBlankRow} disabled={isImporting}>
                + Row
              </Button>
              {invalidCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={removeAllInvalid}
                  disabled={isImporting}
                >
                  Drop {invalidCount} invalid
                </Button>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-app-fg-muted bg-app-hover/30 border-b border-app-border">
                <tr>
                  <th className="text-left px-2 py-2 w-14">#</th>
                  {columns.map((col) => (
                    <th
                      key={col.header}
                      className={`text-left px-2 py-2 ${col.headerClassName ?? ''}`}
                    >
                      {col.header}
                    </th>
                  ))}
                  <th className="text-right px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {resolved.map((row, idx) => {
                  const ok = row.errors.length === 0;
                  const status = statuses[idx];
                  // Only valid rows get the green tint — invalid rows stay
                  // neutral and let the per-cell red rings localise the issue.
                  const rowTint = ok ? 'bg-success-50/50 dark:bg-success-900/15' : '';
                  return (
                    <tr
                      key={`${row.rowIndex}-${idx}`}
                      className={`border-b border-app-border align-top ${rowTint}`}
                    >
                      <td className="px-2 py-1.5 text-app-fg-muted tabular-nums pt-2.5">
                        <span className="inline-flex items-center gap-1">
                          <span>{row.rowIndex}</span>
                          <RowImportStatusIcon status={status} />
                        </span>
                      </td>
                      {columns.map((col) => {
                        const errored = isFieldErrored(row.errors, col.errorTokens);
                        const fieldErrors = errored
                          ? getFieldErrors(row.errors, col.errorTokens)
                          : [];
                        return (
                          <td
                            key={col.header}
                            className={col.cellClassName ?? 'px-2 py-1.5'}
                          >
                            <div className="flex items-center gap-1.5">
                              {col.renderCell({
                                row,
                                rowIndex: idx,
                                disabled: isImporting,
                                errored,
                                patch: (patch) => patchRow(idx, patch),
                              })}
                              {!col.hideErrorInfo && fieldErrors.length > 0 ? (
                                <CellErrorInfoButton
                                  fieldLabel={col.errorLabel}
                                  rowNumber={row.rowIndex}
                                  value={col.getDisplayValue(row)}
                                  errors={fieldErrors}
                                  onOpen={setErrorDetail}
                                />
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right pt-2">
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          disabled={isImporting}
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-danger-200 dark:border-danger-700/60 bg-danger-50 dark:bg-danger-900/30 text-danger-700 dark:text-danger-300 hover:bg-danger-100 hover:border-danger-300 dark:hover:bg-danger-900/50 dark:hover:border-danger-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label={`Remove row ${row.rowIndex}`}
                          title="Remove this row"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.25}
                            aria-hidden
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Footer / actions ───────────────────────────────────────── */}
          <div className="border-t border-app-border px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-app-fg-muted">
              {importDone
                ? `${completedCount} created${failedCount > 0 ? `, ${failedCount} failed` : ''}.`
                : isImporting
                  ? `Importing… ${completedCount} done.`
                  : `Invalid rows are skipped automatically — fix or drop them.`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => navigate(cancelHref)}
                disabled={isImporting}
              >
                {importDone ? 'Done' : 'Cancel'}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={runImport}
                loading={isImporting}
                loadingText="Importing…"
                disabled={validCount === 0 || isImporting || importDone}
              >
                Import {validCount} {resourceLabel}
                {validCount === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Per-cell error detail modal ──────────────────────────────────
          Opened by the (i) button on any errored cell. Shows the field
          name, the row number, the current cell value, and the full list
          of resolver errors for THAT field only. */}
      <Modal
        open={errorDetail !== null}
        onClose={() => setErrorDetail(null)}
        maxWidth="max-w-md"
        aria-labelledby="import-bulk-data-error-title"
        contentClassName="p-0"
      >
        {errorDetail ? (
          <>
            <div className="px-5 pt-5 pb-4 border-b border-app-border flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-app-fg-muted font-semibold">
                  Row {errorDetail.rowNumber}
                </p>
                <h3
                  id="import-bulk-data-error-title"
                  className="text-base font-semibold text-app-fg leading-snug"
                >
                  {errorDetail.fieldLabel}{' '}
                  <span className="text-app-fg-muted font-normal">needs attention</span>
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setErrorDetail(null)}
                className="text-app-fg-muted hover:text-app-fg p-1 shrink-0 rounded-md hover:bg-app-hover"
                aria-label="Close error details"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[min(60dvh,28rem)] overflow-y-auto">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                  Current value
                </p>
                <code className="block font-mono text-xs rounded-md bg-app-hover text-app-fg px-2.5 py-2 break-all">
                  {errorDetail.value || (
                    <span className="text-app-fg-muted italic">empty</span>
                  )}
                </code>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                  {errorDetail.errors.length === 1
                    ? 'Issue'
                    : `${errorDetail.errors.length} issues`}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {errorDetail.errors.map((e, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-md border border-danger-200 dark:border-danger-700/60 bg-danger-50 dark:bg-danger-900/20 px-2.5 py-2 text-xs text-danger-800 dark:text-danger-200"
                    >
                      <svg
                        className="w-3.5 h-3.5 mt-0.5 shrink-0 text-danger-600 dark:text-danger-400"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                        aria-hidden
                      >
                        <path
                          fillRule="evenodd"
                          d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="leading-snug">{e}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pt-1">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => setErrorDetail(null)}
                >
                  Got it
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </div>
  );
}

/** Returns true when any of the resolver-error tokens for this field appear in the row's errors. */
export function isFieldErrored(errors: string[], tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  return errors.some((e) => {
    const lower = e.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });
}

/** Filter the resolver-error list down to entries matching this field. */
function getFieldErrors(errors: string[], tokens: string[]): string[] {
  if (tokens.length === 0) return [];
  return errors.filter((e) => {
    const lower = e.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });
}

/**
 * Reusable Tailwind classes for an editable cell input. Neutral by default;
 * red ring when `errored`. Exported so resource-specific renderCells can
 * mirror the input chrome without re-deriving it.
 */
export function importCellInputClass(errored: boolean): string {
  return [
    'w-full rounded-md border bg-app-elevated px-2 py-1 text-xs text-app-fg',
    'focus:outline-none focus:ring-1',
    errored
      ? 'border-danger-400 ring-1 ring-danger-200 dark:border-danger-700 dark:ring-danger-900/40 focus:ring-danger-500'
      : 'border-app-border focus:ring-brand-500',
    'disabled:opacity-60 disabled:cursor-not-allowed',
  ].join(' ');
}

/**
 * Compact icon shown next to the row number once an import attempt has run.
 * Spinner = in-flight, green check = created, red X = failed (reason in title).
 */
function RowImportStatusIcon({ status }: { status: RowStatus | undefined }) {
  if (!status || status.state === 'pending' || status.state === 'invalid') return null;
  if (status.state === 'in_flight') {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full border-2 border-app-fg-muted border-t-transparent animate-spin"
        aria-label="Importing"
        title="Importing…"
      />
    );
  }
  if (status.state === 'created') {
    const tip = status.meta ? `Created — ${status.meta}` : 'Created';
    return (
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300"
        title={tip}
        aria-label={tip}
      >
        <svg
          className="w-2.5 h-2.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  // failed
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300"
      title={status.reason}
      aria-label={`Failed: ${status.reason}`}
    >
      <svg
        className="w-2.5 h-2.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={3}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  );
}

function CellErrorInfoButton({
  fieldLabel,
  rowNumber,
  value,
  errors,
  onOpen,
}: {
  fieldLabel: string;
  rowNumber: number;
  value: string;
  errors: string[];
  onOpen: (detail: {
    rowNumber: number;
    fieldLabel: string;
    value: string;
    errors: string[];
  }) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen({ rowNumber, fieldLabel, value, errors })}
      className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-danger-500 text-white shadow-sm ring-2 ring-danger-100 dark:ring-danger-900/60 hover:bg-danger-600 hover:ring-danger-200 dark:bg-danger-500 dark:hover:bg-danger-400 transition-colors"
      aria-label={`Show ${fieldLabel} error details for row ${rowNumber}`}
      title={`Show ${fieldLabel} error details`}
    >
      <span className="font-serif text-[12px] font-bold leading-none italic">i</span>
    </button>
  );
}
