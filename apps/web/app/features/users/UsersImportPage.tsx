/**
 * UsersImportPage — replaces `UsersImportModal` with a dedicated page.
 *
 * Flow:
 *   1. Drop / pick an .xlsx | .xls | .csv (parsing happens client-side via `xlsx`).
 *   2. Rows land in an EDITABLE table — every cell is an input that re-validates
 *      on every keystroke. Valid rows turn GREEN; invalid rows turn red and
 *      surface their first error inline.
 *   3. Operator can edit / add / remove rows freely until the "Ready" count
 *      matches what they want. Invalid rows are skipped at import time.
 *   4. "Import N users" runs the existing per-row submit loop against the
 *      `intent=importUser` action on `/hr/users` — same backend the modal used,
 *      so sensitive-role approval flows still kick in row-by-row.
 *
 * Routed from /hr/users/import (see ../routes/hr.users.import/route.tsx).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import * as XLSX from 'xlsx';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { InlineNotification } from '~/components/ui/inline-notification';
import {
  type BranchInfo,
  type ParsedRow,
  type ResolvedRow,
  makeEmptyParsedRow,
  parseTruthy,
  pickHeaderValue,
  resolveRow,
  SPREADSHEET_IMPORT_ROLE_REFERENCE,
} from './users-import-shared';
import { UsersImportColumnsReference } from './UsersImportColumnsReference';
import { downloadUsersImportTemplate } from './users-import-template';

interface UsersImportPageProps {
  branches: BranchInfo[];
}

type RowStatus =
  | { state: 'pending' }
  | { state: 'in_flight' }
  | { state: 'created'; requiresApproval: boolean }
  | { state: 'failed'; reason: string }
  | { state: 'invalid' };

export function UsersImportPage({ branches }: UsersImportPageProps) {
  const navigate = useNavigate();
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<RowStatus[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  /** Filename of the picked file — surfaced next to the custom Choose-file
   *  button so the operator gets visual confirmation of what's loaded. */
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  /** Open-state for the per-cell error-detail modal. Populated when the
   *  operator clicks the (i) icon next to an errored cell. */
  const [errorDetail, setErrorDetail] = useState<{
    rowNumber: number;
    fieldLabel: string;
    value: string;
    errors: string[];
  } | null>(null);
  const cancelRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-validate every row on each keystroke / branch list change. Cheap — the
  // resolver is pure JS over a small array.
  const resolved = useMemo<ResolvedRow[]>(
    () => parsed.map((r) => resolveRow(r, branches)),
    [parsed, branches],
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
        if (rows.length > 500) {
          throw new Error(`Found ${rows.length} rows; limit is 500 per import.`);
        }
        const parsedRows: ParsedRow[] = rows.map((row, idx) => ({
          rowIndex: idx + 2, // +2: row 1 = headers in source sheet
          name: pickHeaderValue(row, 'name'),
          email: pickHeaderValue(row, 'email').toLowerCase(),
          role: pickHeaderValue(row, 'role'),
          phone: pickHeaderValue(row, 'phone'),
          primaryBranchInput: pickHeaderValue(row, 'primary_branch'),
          additionalBranchesInput: pickHeaderValue(row, 'additional_branches'),
          isProbation: parseTruthy(pickHeaderValue(row, 'probation')),
          probationUntil: pickHeaderValue(row, 'probation_until'),
        }));
        setParsed(parsedRows);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Could not parse the file.');
      }
    };
    reader.onerror = () => setParseError('Could not read the file. Try again.');
    reader.readAsBinaryString(file);
  }

  /** Patch one row's field — re-validation happens via the `useMemo` above. */
  function patchRow(idx: number, patch: Partial<ParsedRow>) {
    setParsed((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    // Editing a row clears its prior import status (so a "failed" row that's
    // since been edited shows as Ready / Pending again rather than stale red).
    setStatuses((prev) => (prev.length === 0 ? prev : prev.map((s, i) => (i === idx ? { state: 'pending' as const } : s))));
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
    setParsed((prev) => [...prev, makeEmptyParsedRow(prev.length + 2)]);
  }

  async function runImport() {
    cancelRef.current = false;
    setIsImporting(true);
    setImportDone(false);
    const initial: RowStatus[] = resolved.map((r) =>
      r.errors.length > 0 ? { state: 'invalid' } : { state: 'pending' },
    );
    setStatuses(initial);

    for (let i = 0; i < resolved.length; i += 1) {
      if (cancelRef.current) break;
      const row = resolved[i]!;
      if (row.errors.length > 0) continue;

      setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'in_flight' } : s)));

      const formData = new FormData();
      formData.set('intent', 'importUser');
      formData.set('rowIndex', String(i));
      formData.set('name', row.name);
      formData.set('email', row.email);
      formData.set('role', row.resolvedRole as string);
      formData.set('phone', row.phone);
      formData.set('primaryBranchId', row.primaryBranchId as string);
      const allBranches = [...new Set([row.primaryBranchId as string, ...row.additionalBranchIds])];
      formData.set('branchIds', JSON.stringify(allBranches));
      formData.set('isProbation', String(row.isProbation));
      if (row.probationUntil) formData.set('probationUntil', row.probationUntil);

      try {
        const res = await fetch('/hr/users?index', { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data as { success?: boolean }).success === true) {
          const requiresApproval = (data as { requiresApproval?: boolean }).requiresApproval === true;
          setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'created', requiresApproval } : s)));
        } else {
          const reason = (data as { error?: string }).error ?? `HTTP ${res.status}`;
          setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'failed', reason } : s)));
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Network error';
        setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'failed', reason } : s)));
      }
    }

    setIsImporting(false);
    setImportDone(true);
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Import users"
        description="Upload a spreadsheet, fix any rows the editor flags, then import. Each row is created one at a time so a single bad row doesn't block the rest."
        actions={
          <Link to="/hr/users" prefetch="intent" className="btn-secondary btn-sm">
            ← Back to users
          </Link>
        }
      />

      {/* ── Upload card ───────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-app-fg">1. Upload</h2>
            <p className="text-xs text-app-fg-muted">
              .xlsx, .xls, or .csv. Max 500 rows. Headers are case-insensitive — see the
              column reference below for what each cell expects.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => downloadUsersImportTemplate(branches)}
              disabled={isImporting}
              title="Download an .xlsx template with example rows + a Reference sheet listing every accepted role and branch"
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
            {/* Native <input type="file"> styling is unfixable across browsers,
                so we hide it via `sr-only` and drive it with a styled button.
                The button matches the Download template button's size + chrome
                and shows the picked filename inline once a file is loaded. */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileChange(file);
                // Clear the input value so the operator can re-pick the SAME
                // file (e.g. they fixed it in Excel and want to re-upload).
                // Without this the native input no-ops on the second click.
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

        {/* ── Expected columns reference ──────────────────────────────
            Same chip-grid + per-column detail modal we had in the legacy
            UsersImportModal. Operators can tap any chip's info button to
            see description / accepted labels (for `role`) / live example
            values (for `primary_branch` / `additional_branches`). */}
        <div className="space-y-2 pt-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
              Expected columns
            </p>
            <p className="text-[10px] text-app-fg-muted">
              Header names are case-insensitive · <span className="text-danger-500">*</span> required
            </p>
          </div>
          <UsersImportColumnsReference branches={branches} />
        </div>
      </div>

      {/* ── Editable preview / editor ─────────────────────────────────── */}
      {parsed.length > 0 ? (
        <div className="card space-y-3 p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-app-border">
            <div>
              <h2 className="text-sm font-semibold text-app-fg">2. Preview &amp; edit</h2>
              <p className="text-xs text-app-fg-muted">
                Rows in <span className="text-success-700 dark:text-success-400 font-medium">green</span> are
                ready to import. Edit any cell to fix the others.
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
                  <th className="text-left px-2 py-2 min-w-[10rem]">Name</th>
                  <th className="text-left px-2 py-2 min-w-[14rem]">Email</th>
                  <th className="text-left px-2 py-2 min-w-[9rem]">Phone</th>
                  <th className="text-left px-2 py-2 min-w-[10rem]">Role</th>
                  <th className="text-left px-2 py-2 min-w-[8rem]">Primary branch</th>
                  <th className="text-left px-2 py-2 min-w-[10rem]">Additional branches</th>
                  <th className="text-left px-2 py-2 w-12">Prob.</th>
                  <th className="text-right px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {resolved.map((row, idx) => {
                  const ok = row.errors.length === 0;
                  const status = statuses[idx];
                  // Row tinting: green when it's a clean "Ready" row, red when
                  // it has resolver errors. The status from a completed import
                  // takes precedence so the operator can see at a glance which
                  // rows have already landed (success state) vs need a retry.
                  // Only valid rows get the green tint — invalid rows stay
                  // neutral and let the per-cell red rings localise the issue.
                  // (Painting the whole row red made it look like every cell
                  // was the problem when often only one was, e.g. a bad phone.)
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
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => patchRow(idx, { name: e.target.value })}
                            disabled={isImporting}
                            className={cellInputClass(row.errors, 'name')}
                          />
                          <CellErrorInfo
                            errors={row.errors}
                            field="name"
                            rowNumber={row.rowIndex}
                            value={row.name}
                            onOpen={setErrorDetail}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="email"
                            value={row.email}
                            onChange={(e) => patchRow(idx, { email: e.target.value.toLowerCase() })}
                            disabled={isImporting}
                            className={cellInputClass(row.errors, 'email')}
                          />
                          <CellErrorInfo
                            errors={row.errors}
                            field="email"
                            rowNumber={row.rowIndex}
                            value={row.email}
                            onOpen={setErrorDetail}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="tel"
                            value={row.phone}
                            onChange={(e) => patchRow(idx, { phone: e.target.value })}
                            disabled={isImporting}
                            placeholder="08031234567"
                            aria-invalid={isFieldErrored(row.errors, 'phone') || undefined}
                            className={cellInputClass(row.errors, 'phone')}
                          />
                          <CellErrorInfo
                            errors={row.errors}
                            field="phone"
                            rowNumber={row.rowIndex}
                            value={row.phone}
                            onOpen={setErrorDetail}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={row.resolvedRole ?? ''}
                            onChange={(e) => patchRow(idx, { role: e.target.value })}
                            disabled={isImporting}
                            className={cellSelectClass(row.errors, 'role')}
                          >
                            <option value="">—</option>
                            {SPREADSHEET_IMPORT_ROLE_REFERENCE.map((r) => (
                              <option key={r.enum} value={r.enum}>
                                {r.acceptedLabels.split(',')[0]?.trim() ?? r.enum}
                              </option>
                            ))}
                          </select>
                          <CellErrorInfo
                            errors={row.errors}
                            field="role"
                            rowNumber={row.rowIndex}
                            value={row.role}
                            onOpen={setErrorDetail}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <BranchPickerDropdown
                            mode="single"
                            branches={branches}
                            selectedIds={row.primaryBranchId ? [row.primaryBranchId] : []}
                            excludeIds={row.additionalBranchIds}
                            disabled={isImporting}
                            errored={isFieldErrored(row.errors, 'primary_branch')}
                            onChange={(ids) => {
                              const next = ids[0];
                              const code = next ? branches.find((b) => b.id === next)?.code ?? '' : '';
                              patchRow(idx, { primaryBranchInput: code });
                            }}
                          />
                          <CellErrorInfo
                            errors={row.errors}
                            field="primary_branch"
                            rowNumber={row.rowIndex}
                            value={row.primaryBranchInput}
                            onOpen={setErrorDetail}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <BranchPickerDropdown
                            mode="multi"
                            branches={branches}
                            selectedIds={row.additionalBranchIds}
                            excludeIds={row.primaryBranchId ? [row.primaryBranchId] : []}
                            disabled={isImporting}
                            errored={isFieldErrored(row.errors, 'additional_branches')}
                            onChange={(ids) => {
                              // Convert back to a comma-separated CODE string so
                              // the resolver re-validates from the same input
                              // shape it parses from the spreadsheet.
                              const codes = ids
                                .map((id) => branches.find((b) => b.id === id)?.code)
                                .filter((c): c is string => Boolean(c))
                                .join(', ');
                              patchRow(idx, { additionalBranchesInput: codes });
                            }}
                          />
                          <CellErrorInfo
                            errors={row.errors}
                            field="additional_branches"
                            rowNumber={row.rowIndex}
                            value={row.additionalBranchesInput}
                            onOpen={setErrorDetail}
                          />
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-center pt-2.5">
                        <input
                          type="checkbox"
                          checked={row.isProbation}
                          onChange={(e) => patchRow(idx, { isProbation: e.target.checked })}
                          disabled={isImporting}
                          aria-label={`Probation for ${row.name || 'row ' + row.rowIndex}`}
                        />
                      </td>
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
                onClick={() => navigate('/hr/users')}
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
                Import {validCount} user{validCount === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Per-cell error detail modal ──────────────────────────────────
          Opened by the (i) button on any errored cell. Shows the field
          name, the row number, the current cell value, and the full list
          of resolver errors for THAT field only — so operators can see
          exactly what to fix without parsing a multi-error one-liner. */}
      <Modal
        open={errorDetail !== null}
        onClose={() => setErrorDetail(null)}
        maxWidth="max-w-md"
        aria-labelledby="users-import-error-title"
        contentClassName="p-0"
      >
        {errorDetail ? (
          <>
            <div className="px-5 pt-5 pb-4 border-b border-app-border flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-app-fg-muted font-semibold">
                  Row {errorDetail.rowNumber}
                </p>
                <h3 id="users-import-error-title" className="text-base font-semibold text-app-fg leading-snug">
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
                  {errorDetail.value || <span className="text-app-fg-muted italic">empty</span>}
                </code>
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                  {errorDetail.errors.length === 1 ? 'Issue' : `${errorDetail.errors.length} issues`}
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

/**
 * Map a field key → the substrings that appear in its resolver-error messages.
 * Anchoring to a token list (not a single keyword) means the email error
 * "Email is invalid." doesn't accidentally light up the Name cell, and the
 * branch errors don't bleed into the additional-branches column either.
 */
const FIELD_ERROR_TOKENS: Record<string, string[]> = {
  name: ['name must be'],
  email: ['email is invalid'],
  phone: ['phone must be'],
  role: ['unknown role'],
  primary_branch: ['unknown primary branch'],
  additional_branches: ['unknown additional branch'],
};

function isFieldErrored(errors: string[], field: keyof typeof FIELD_ERROR_TOKENS): boolean {
  const tokens = FIELD_ERROR_TOKENS[field] ?? [];
  if (tokens.length === 0) return false;
  return errors.some((e) => {
    const lower = e.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });
}

/** Filter the resolver-error list down to just the entries that match this
 *  field's tokens. Used by the per-cell info modal so the detail dialog only
 *  shows errors relevant to the cell that was clicked. */
function getFieldErrors(errors: string[], field: keyof typeof FIELD_ERROR_TOKENS): string[] {
  const tokens = FIELD_ERROR_TOKENS[field] ?? [];
  if (tokens.length === 0) return [];
  return errors.filter((e) => {
    const lower = e.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });
}

/** Friendly label for each cell field, used as the dialog title. */
const FIELD_LABELS: Record<keyof typeof FIELD_ERROR_TOKENS, string> = {
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  role: 'Role',
  primary_branch: 'Primary branch',
  additional_branches: 'Additional branches',
};

/** Tailwind classes for an editable cell input — neutral by default; only the
 *  cell whose own field has an error gets the red ring. */
function cellInputClass(errors: string[], field: keyof typeof FIELD_ERROR_TOKENS): string {
  const errored = isFieldErrored(errors, field);
  return [
    'w-full rounded-md border bg-app-elevated px-2 py-1 text-xs text-app-fg',
    'focus:outline-none focus:ring-1',
    errored
      ? 'border-danger-400 ring-1 ring-danger-200 dark:border-danger-700 dark:ring-danger-900/40 focus:ring-danger-500'
      : 'border-app-border focus:ring-brand-500',
    'disabled:opacity-60 disabled:cursor-not-allowed',
  ].join(' ');
}

function cellSelectClass(errors: string[], field: keyof typeof FIELD_ERROR_TOKENS): string {
  return cellInputClass(errors, field);
}

/**
 * Compact icon shown next to the row number once an import attempt has run.
 * Spinner = in-flight, green check = created, red X = failed (reason in title).
 * Renders nothing for pending / invalid rows so the row number stays clean
 * before the operator hits "Import".
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
    const tip = status.requiresApproval ? 'Created — pending approval' : 'Created';
    return (
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300"
        title={tip}
        aria-label={tip}
      >
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden>
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
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </span>
  );
}

/**
 * Small red (i) button rendered inline next to an errored cell input. Clicking
 * it pops the per-cell error-detail modal so the operator can read the full
 * resolver message instead of squinting at the truncated inline label.
 * Renders nothing when the field has no errors — keeps clean cells uncluttered.
 */
function CellErrorInfo({
  errors,
  field,
  rowNumber,
  value,
  onOpen,
}: {
  errors: string[];
  field: keyof typeof FIELD_ERROR_TOKENS;
  rowNumber: number;
  value: string;
  onOpen: (detail: {
    rowNumber: number;
    fieldLabel: string;
    value: string;
    errors: string[];
  }) => void;
}) {
  const fieldErrors = getFieldErrors(errors, field);
  if (fieldErrors.length === 0) return null;
  const label = FIELD_LABELS[field];
  return (
    <button
      type="button"
      onClick={() =>
        onOpen({ rowNumber, fieldLabel: label, value, errors: fieldErrors })
      }
      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-danger-100 text-danger-700 hover:bg-danger-200 dark:bg-danger-900/40 dark:text-danger-300 dark:hover:bg-danger-900/60 transition-colors"
      aria-label={`Show ${label} error details for row ${rowNumber}`}
      title={`Show ${label} error details`}
    >
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
        <path
          fillRule="evenodd"
          d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

/**
 * Compact checkbox-dropdown branch picker used by both the primary and
 * additional-branches cells. `single` mode behaves like a radio (last click
 * wins, click again to clear); `multi` mode toggles each entry. Closes on
 * outside click. Branches in `excludeIds` are hidden so an additional-branch
 * picker can't list the row's own primary branch (and vice versa).
 */
function BranchPickerDropdown({
  mode,
  branches,
  selectedIds,
  excludeIds = [],
  disabled,
  errored,
  onChange,
}: {
  mode: 'single' | 'multi';
  branches: BranchInfo[];
  selectedIds: string[];
  excludeIds?: string[];
  disabled?: boolean;
  errored?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click — common pattern, scoped to this picker only.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const visible = useMemo(
    () => branches.filter((b) => !excludeIds.includes(b.id)),
    [branches, excludeIds],
  );
  const selectedBranches = selectedIds
    .map((id) => branches.find((b) => b.id === id))
    .filter((b): b is BranchInfo => Boolean(b));

  const triggerLabel =
    selectedBranches.length === 0
      ? mode === 'single'
        ? 'Select…'
        : 'None'
      : selectedBranches.map((b) => b.code).join(', ');

  function toggle(id: string) {
    if (mode === 'single') {
      onChange(selectedIds[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const triggerClass = [
    'w-full inline-flex items-center justify-between gap-1.5 rounded-md border bg-app-elevated px-2 py-1 text-xs text-app-fg',
    'focus:outline-none focus:ring-1 disabled:opacity-60 disabled:cursor-not-allowed',
    errored
      ? 'border-danger-400 ring-1 ring-danger-200 dark:border-danger-700 dark:ring-danger-900/40 focus:ring-danger-500'
      : 'border-app-border focus:ring-brand-500',
  ].join(' ');

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || branches.length === 0}
        className={triggerClass}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selectedBranches.length === 0 ? 'text-app-fg-muted' : ''}>
          {triggerLabel}
        </span>
        <svg
          className="w-3 h-3 shrink-0 text-app-fg-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable={mode === 'multi'}
          className="absolute left-0 top-full z-20 mt-1 w-max min-w-full max-w-[18rem] max-h-[16rem] overflow-y-auto rounded-md border border-app-border bg-app-elevated shadow-lg"
        >
          {visible.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-app-fg-muted">No branches available</p>
          ) : (
            <ul className="py-1">
              {visible.map((b) => {
                const checked = selectedIds.includes(b.id);
                return (
                  <li key={b.id}>
                    <label className="flex items-center gap-2 px-2 py-1 text-xs text-app-fg cursor-pointer hover:bg-app-hover">
                      <input
                        type={mode === 'single' ? 'radio' : 'checkbox'}
                        checked={checked}
                        onChange={() => toggle(b.id)}
                        className="w-3.5 h-3.5"
                      />
                      <span className="font-mono text-[10px] text-app-fg-muted shrink-0">
                        {b.code}
                      </span>
                      <span className="truncate">{b.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
