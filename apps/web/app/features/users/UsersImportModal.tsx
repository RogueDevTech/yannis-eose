/**
 * @deprecated Replaced 2026-05-11 by `UsersImportPage` mounted at
 * `/hr/users/import`. The page version makes every row inline-editable so HR
 * can fix bad rows without bouncing back to Excel. This file is no longer
 * imported anywhere — kept for one release as a fallback. Safe to delete
 * after the new page proves out.
 *
 * UsersImportModal — bulk-import users from a XLSX/CSV sheet.
 *
 * Three-step wizard:
 *   1. Upload     — file picker + "Download template" generator. Parsing happens in the
 *                   browser via the `xlsx` package (already a dependency).
 *   2. Preview    — table of parsed rows with per-row validation status. HR can spot
 *                   shape errors before any server call goes out.
 *   3. Import     — sequential per-row POST to the route's `intent=importUser` action.
 *                   The progress bar tracks completed/total rows; per-row failures are
 *                   collected and shown in the summary at the end.
 *
 * The action handler delegates to the existing `users.create` tRPC procedure, so the
 * sensitive-role approval flow (HR creating ADMIN, etc.) still kicks in row-by-row.
 *
 * Branch resolution: the modal loads `/trpc/branches.list` on open and matches the
 * sheet's `primary_branch` / `additional_branches` columns by branch CODE first, then
 * NAME (case-insensitive). Unknown branches fail validation with a clear message.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import * as XLSX from 'xlsx';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { useFetcherToast } from '~/components/ui/toast';

interface BranchInfo {
  id: string;
  code: string;
  name: string;
  status: string;
}

/**
 * Importable roles — single source for VALID_ROLES + the column-guide reference.
 * SUPER_ADMIN is intentionally omitted (cannot be imported).
 */
const SPREADSHEET_IMPORT_ROLE_REFERENCE = [
  { enum: 'ADMIN', acceptedLabels: 'Admin' },
  { enum: 'BRANCH_ADMIN', acceptedLabels: 'Branch Admin' },
  { enum: 'HEAD_OF_MARKETING', acceptedLabels: 'Head of Marketing' },
  { enum: 'MEDIA_BUYER', acceptedLabels: 'Media Buyer' },
  { enum: 'HEAD_OF_CS', acceptedLabels: 'Head of CS' },
  { enum: 'CS_CLOSER', acceptedLabels: 'Sales Closer' },
  { enum: 'FINANCE_OFFICER', acceptedLabels: 'Finance Officer' },
  { enum: 'HEAD_OF_LOGISTICS', acceptedLabels: 'Head of Logistics' },
  { enum: 'STOCK_MANAGER', acceptedLabels: 'Stock Manager' },
  { enum: 'TPL_MANAGER', acceptedLabels: '3PL Manager, TPL Manager' },
  { enum: 'TPL_RIDER', acceptedLabels: '3PL Rider, TPL Rider' },
  { enum: 'HR_MANAGER', acceptedLabels: 'HR Manager' },
] as const;

const VALID_ROLES = new Set<string>(SPREADSHEET_IMPORT_ROLE_REFERENCE.map((r) => r.enum));

/** Human label → enum value (also accepts the enum directly). Case-insensitive. */
const ROLE_LABEL_LOOKUP: Record<string, string> = {
  admin: 'ADMIN',
  'branch admin': 'BRANCH_ADMIN',
  'head of marketing': 'HEAD_OF_MARKETING',
  'media buyer': 'MEDIA_BUYER',
  'head of cs': 'HEAD_OF_CS',
  'cs closer': 'CS_CLOSER',
  // Legacy alias — spreadsheets created before the 2026-05-10 rename still
  // import cleanly. Keep until the next big import-spec cleanup.
  'cs agent': 'CS_CLOSER',
  'finance officer': 'FINANCE_OFFICER',
  'head of logistics': 'HEAD_OF_LOGISTICS',
  'stock manager': 'STOCK_MANAGER',
  '3pl manager': 'TPL_MANAGER',
  'tpl manager': 'TPL_MANAGER',
  '3pl rider': 'TPL_RIDER',
  'tpl rider': 'TPL_RIDER',
  'hr manager': 'HR_MANAGER',
};

function normalizeRole(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase().replace(/\s+/g, '_');
  if (VALID_ROLES.has(upper)) return upper;
  const lower = trimmed.toLowerCase();
  return ROLE_LABEL_LOOKUP[lower] ?? null;
}

const NIGERIAN_PHONE = /^(?:0[789]\d{9}|\+234[789]\d{9})$/;

interface ParsedRow {
  rowIndex: number; // 1-based for human display
  name: string;
  email: string;
  role: string;
  phone: string;
  primaryBranchInput: string;
  additionalBranchesInput: string;
  isProbation: boolean;
  probationUntil: string;
}

interface ResolvedRow extends ParsedRow {
  /** Canonical role enum (or null when unresolvable). */
  resolvedRole: string | null;
  primaryBranchId: string | null;
  additionalBranchIds: string[];
  errors: string[];
}

type RowStatus =
  | { state: 'pending' }
  | { state: 'in_flight' }
  | { state: 'created'; requiresApproval: boolean }
  | { state: 'failed'; reason: string }
  | { state: 'invalid' };

interface ColumnSpec {
  /**
   * Canonical lookup key — snake_case. `pickHeaderValue` normalises the
   * spreadsheet header (lowercase, whitespace + dashes → underscore) before
   * matching, so "Name", "Primary Branch", "PRIMARY-BRANCH", and
   * "primary_branch" all resolve here.
   */
  header: string;
  /** Friendly display label shown in chips, the column guide, and the template. */
  label: string;
  /** Extra aliases shown in the column guide so operators see headers are case/spacing insensitive. */
  alsoAccepts: string[];
  required: boolean;
  description: string;
  examples: string[];
  /** Full allowed values for columns like `role` (enum ↔ accepted labels). */
  referenceGuide?: ReadonlyArray<{ enum: string; acceptedLabels: string }>;
}

const COLUMN_SPECS: ColumnSpec[] = [
  {
    header: 'name',
    label: 'Name',
    alsoAccepts: ['Name', 'NAME'],
    required: true,
    description: 'Full name. Minimum 2 characters.',
    examples: ['Jane Doe', 'Tunde Bello'],
  },
  {
    header: 'email',
    label: 'Email',
    alsoAccepts: ['Email', 'EMAIL'],
    required: true,
    description: 'Login email. Must be unique across the org.',
    examples: ['jane.doe@example.com'],
  },
  {
    header: 'role',
    label: 'Role',
    alsoAccepts: ['Role', 'ROLE'],
    required: true,
    description:
      'Use the enum (left column) or any accepted label (right column) in each row. Case-insensitive; spaces vs underscores both work for enums. SUPER_ADMIN cannot be imported. Creating users with admin-class roles (e.g. ADMIN, FINANCE_OFFICER) queues SuperAdmin approval row-by-row.',
    examples: [],
    referenceGuide: SPREADSHEET_IMPORT_ROLE_REFERENCE,
  },
  {
    header: 'phone',
    label: 'Phone',
    alsoAccepts: ['Phone', 'PHONE'],
    required: true,
    description: 'Nigerian number, no spaces.',
    examples: ['08031234567', '+2348022223333'],
  },
  {
    header: 'primary_branch',
    label: 'Primary Branch',
    alsoAccepts: ['Primary Branch', 'PRIMARY BRANCH', 'primary branch', 'Primary-Branch'],
    required: true,
    description: 'The branch this user defaults to. Use the branch CODE first; the NAME also works.',
    examples: ['LAG', 'Lagos HQ'],
  },
  {
    header: 'additional_branches',
    label: 'Additional Branches',
    alsoAccepts: ['Additional Branches', 'additional branches', 'Additional-Branches'],
    required: false,
    description: 'Extra branches the user can switch into. Comma- or semicolon-separated codes/names. The primary is auto-included.',
    examples: ['ABJ, PHC', 'Abuja; Port Harcourt'],
  },
  {
    header: 'probation',
    label: 'Probation',
    alsoAccepts: ['Probation', 'PROBATION'],
    required: false,
    description: 'Mark the new user as probation. Empty / blank = no.',
    examples: ['true', 'yes', 'false'],
  },
  {
    header: 'probation_until',
    label: 'Probation Until',
    alsoAccepts: ['Probation Until', 'probation until', 'Probation-Until'],
    required: false,
    description: 'Probation review date when probation = true. ISO format. Defaults to 90 days from import.',
    examples: ['2026-08-08'],
  },
];

function pickHeaderValue(row: Record<string, unknown>, header: string): string {
  // Excel header lookups are case-insensitive and treat whitespace / dashes as equivalent
  // to underscores so the template + a hand-typed sheet both parse.
  const target = header.toLowerCase().replace(/[\s-]+/g, '_');
  for (const key of Object.keys(row)) {
    if (key.toLowerCase().replace(/[\s-]+/g, '_') === target) {
      const v = row[key];
      if (v == null) return '';
      return String(v).trim();
    }
  }
  return '';
}

function parseTruthy(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function resolveBranchId(input: string, branches: BranchInfo[]): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const byCode = branches.find((b) => b.code.toLowerCase() === lower);
  if (byCode) return byCode.id;
  const byName = branches.find((b) => b.name.toLowerCase() === lower);
  return byName?.id ?? null;
}

function resolveRow(parsed: ParsedRow, branches: BranchInfo[]): ResolvedRow {
  const errors: string[] = [];

  if (!parsed.name || parsed.name.length < 2) errors.push('Name must be at least 2 characters.');
  if (!parsed.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) {
    errors.push('Email is invalid.');
  }
  if (!NIGERIAN_PHONE.test(parsed.phone)) {
    errors.push('Phone must be a Nigerian number (08031234567 or +2348031234567).');
  }
  const resolvedRole = parsed.role ? normalizeRole(parsed.role) : null;
  if (!resolvedRole) {
    errors.push(
      `Unknown role "${parsed.role}". Use a valid role enum (e.g. CS_CLOSER) or label (e.g. "Sales Closer").`,
    );
  }
  const primaryBranchId = resolveBranchId(parsed.primaryBranchInput, branches);
  if (!primaryBranchId) {
    errors.push(
      `Unknown primary branch "${parsed.primaryBranchInput}". Use a branch code or full name.`,
    );
  }
  const additionalBranchIds: string[] = [];
  if (parsed.additionalBranchesInput) {
    const tokens = parsed.additionalBranchesInput
      .split(/[,;|]/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const token of tokens) {
      const id = resolveBranchId(token, branches);
      if (!id) {
        errors.push(`Unknown additional branch "${token}".`);
      } else if (!additionalBranchIds.includes(id)) {
        additionalBranchIds.push(id);
      }
    }
  }

  return {
    ...parsed,
    resolvedRole,
    primaryBranchId,
    additionalBranchIds,
    errors,
  };
}

function InfoCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
      />
    </svg>
  );
}

/**
 * Branch columns (`primary_branch`, `additional_branches`) ship with placeholder
 * examples that the import-modal swaps for live branch data once the
 * `branches.list` fetch returns. Falls back to the static placeholders when
 * the list hasn't loaded yet (e.g. modal just opened, network slow).
 */
function resolveColumnExamples(spec: ColumnSpec, branches: BranchInfo[]): string[] {
  if (branches.length === 0) return spec.examples;
  if (spec.header === 'primary_branch') {
    const first = branches[0];
    if (!first) return spec.examples;
    // Show the same branch by code AND by name so the operator sees both
    // forms are accepted. Mirrors the "CODE first; NAME also works" copy.
    return [first.code, first.name];
  }
  if (spec.header === 'additional_branches') {
    const others = branches.slice(1, 3); // up to 2 other branches
    if (others.length === 0) return spec.examples;
    const codes = others.map((b) => b.code).join(', ');
    const names = others.map((b) => b.name).join('; ');
    return [codes, names].filter(Boolean);
  }
  return spec.examples;
}

/**
 * Compact columns reference — chips per header. The info control opens a full
 * modal so guidance is readable (popover was easy to miss / clipped).
 */
function ColumnsReferenceGrid({ branches }: { branches: BranchInfo[] }) {
  const [detailColumn, setDetailColumn] = useState<ColumnSpec | null>(null);
  const detailTitleId = 'users-import-column-guide-title';

  const detailExamples = detailColumn ? resolveColumnExamples(detailColumn, branches) : [];

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
        {COLUMN_SPECS.map((c) => (
          <div
            key={c.header}
            className="flex items-center justify-between gap-1.5 rounded-md border border-app-border bg-app-hover/30 px-2 py-1.5"
          >
            <span className="text-xs font-medium text-app-fg truncate" title={c.label}>
              {c.label}
              {c.required ? (
                <span className="ml-0.5 text-danger-500" aria-hidden="true">*</span>
              ) : null}
              {c.required ? <span className="sr-only"> (required)</span> : null}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                aria-label={`Open column guide: ${c.label}`}
                aria-haspopup="dialog"
                onClick={() => setDetailColumn(c)}
                className="inline-flex items-center justify-center min-w-8 min-h-8 rounded-full border border-app-border text-app-fg-muted hover:bg-brand-50 hover:border-brand-200 hover:text-brand-700 dark:hover:bg-brand-900/25 dark:hover:border-brand-700 dark:hover:text-brand-300 transition-colors"
              >
                <InfoCircleIcon />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={detailColumn !== null}
        onClose={() => setDetailColumn(null)}
        maxWidth="max-w-md"
        aria-labelledby={detailTitleId}
        contentClassName="p-0"
      >
        {detailColumn ? (
          <div className="px-5 pt-5 pb-4 border-b border-app-border flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <h3 id={detailTitleId} className="text-base font-semibold text-app-fg leading-snug">
                <span className="text-app-fg-muted font-normal">Spreadsheet column · </span>
                <span className="text-xl font-semibold text-app-fg">{detailColumn.label}</span>
              </h3>
              {detailColumn.required ? (
                <span className="inline-flex text-micro uppercase tracking-wider rounded-md bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300 px-2 py-0.5 font-semibold">
                  Required in every row
                </span>
              ) : (
                <span className="inline-flex text-micro uppercase tracking-wider rounded-md bg-app-hover text-app-fg-muted px-2 py-0.5 font-semibold">
                  Optional
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDetailColumn(null)}
              className="text-app-fg-muted hover:text-app-fg p-1 shrink-0 rounded-md hover:bg-app-hover"
              aria-label="Close column guide"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : null}
        {detailColumn ? (
          <div
            className={
              detailColumn.referenceGuide?.length
                ? 'px-5 py-4 space-y-4 max-h-[min(75dvh,36rem)] overflow-y-auto'
                : 'px-5 py-4 space-y-4 max-h-[min(60dvh,22rem)] overflow-y-auto'
            }
          >
            <p className="text-sm text-app-fg leading-relaxed">{detailColumn.description}</p>
            <div className="rounded-md border border-app-border bg-app-hover/40 px-3 py-2 space-y-1.5">
              <p className="text-micro font-semibold uppercase tracking-wider text-app-fg-muted">
                Header names — case &amp; spacing don&apos;t matter
              </p>
              <p className="text-xs text-app-fg-muted">
                The matcher lowercases the column header and treats spaces or dashes as underscores.
                Any of these all work for this column:
              </p>
              <ul className="flex flex-wrap gap-1">
                {[detailColumn.label, detailColumn.header, ...detailColumn.alsoAccepts].map((alias) => (
                  <li key={alias}>
                    <code className="font-mono text-mini rounded bg-app-elevated border border-app-border px-1.5 py-0.5 text-app-fg">
                      {alias}
                    </code>
                  </li>
                ))}
              </ul>
            </div>
            {detailColumn.referenceGuide && detailColumn.referenceGuide.length > 0 ? (
              <div className="space-y-2">
                <p className="text-mini font-semibold uppercase tracking-wider text-app-fg-muted">
                  Full list — spreadsheet cell may use either column
                </p>
                <ul className="flex flex-col gap-2">
                  {detailColumn.referenceGuide.map((row) => (
                    <li
                      key={row.enum}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-app-border bg-app-hover/40 px-2.5 py-2"
                    >
                      <code className="font-mono text-xs font-semibold text-app-fg shrink-0">{row.enum}</code>
                      <span className="text-app-fg-muted text-xs shrink-0">→</span>
                      <span className="text-xs text-app-fg min-w-0">{row.acceptedLabels}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detailExamples.length > 0 ? (
              <div className="space-y-2">
                <p className="text-mini font-semibold uppercase tracking-wider text-app-fg-muted">
                  Example values
                  {(detailColumn.header === 'primary_branch' ||
                    detailColumn.header === 'additional_branches') &&
                  branches.length > 0 ? (
                    <span className="ml-1.5 text-micro font-normal normal-case tracking-normal text-app-fg-muted">
                      — pulled from your branches
                    </span>
                  ) : null}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {detailExamples.map((ex, i) => (
                    <li key={`${detailColumn.header}-ex-${i}`}>
                      <code className="font-mono text-xs rounded-md bg-app-hover text-app-fg px-2 py-1.5 block w-fit max-w-full break-all">
                        {ex}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="pt-1">
              <Button type="button" variant="primary" size="sm" className="w-full sm:w-auto" onClick={() => setDetailColumn(null)}>
                Got it
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

interface UsersImportModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function UsersImportModal({ open, onClose, onComplete }: UsersImportModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'import' | 'summary'>('upload');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<RowStatus[]>([]);
  const cancelRef = useRef(false);

  // Branches load when the modal opens — used for code/name → id resolution in preview.
  const branchesFetcher = useFetcher<unknown>();
  useEffect(() => {
    if (!open) return;
    if (branchesFetcher.state !== 'idle' || branchesFetcher.data) return;
    branchesFetcher.load('/api/import-users-branches');
  }, [open, branchesFetcher]);
  const branches: BranchInfo[] = useMemo(() => {
    const data = branchesFetcher.data as { branches?: BranchInfo[] } | undefined;
    return Array.isArray(data?.branches) ? (data!.branches as BranchInfo[]) : [];
  }, [branchesFetcher.data]);
  const branchesLoading = branchesFetcher.state !== 'idle' || branchesFetcher.data == null;

  // Derived: validate every parsed row against the loaded branches.
  const resolved = useMemo(
    () => parsed.map((r) => resolveRow(r, branches)),
    [parsed, branches],
  );
  const validCount = resolved.filter((r) => r.errors.length === 0).length;
  const invalidCount = resolved.length - validCount;

  // Reset modal state whenever it closes, so the next open is fresh.
  useEffect(() => {
    if (!open) {
      setStep('upload');
      setParsed([]);
      setParseError(null);
      setStatuses([]);
      cancelRef.current = false;
    }
  }, [open]);

  const importFetcher = useFetcher<{ success?: boolean; error?: string; rowIndex?: number; requiresApproval?: boolean }>();
  // Suppress the global error toast — the modal renders per-row errors directly.
  useFetcherToast(importFetcher.data, { skipErrorToast: true, skipSuccessToast: true });

  /**
   * Build a starter `.xlsx` for the operator. Two sheets:
   *   1. "Users" — friendly headers (matching the column-guide labels) + two
   *      sample rows pre-filled with realistic values pulled from the live
   *      branches list.
   *   2. "Reference" — every role enum + its accepted labels, and every
   *      branch (code + name). The open-source `xlsx` package only writes
   *      data validations under SheetJS Pro — copying from the Reference
   *      sheet is the practical fallback for an Excel-native dropdown.
   */
  function downloadTemplate() {
    const headers = COLUMN_SPECS.map((c) => c.label);
    const sampleBranchCode = branches[0]?.code ?? 'LAG';
    const sampleSecondBranch = branches[1]?.code ?? branches[0]?.code ?? '';
    const sampleA: Record<string, string | number> = {
      Name: 'Jane Doe',
      Email: 'jane.doe@example.com',
      Role: 'Sales Closer',
      Phone: '08031234567',
      'Primary Branch': sampleBranchCode,
      'Additional Branches': sampleSecondBranch ? sampleSecondBranch : '',
      Probation: 'false',
      'Probation Until': '',
    };
    const sampleB: Record<string, string | number> = {
      Name: 'Tunde Bello',
      Email: 'tunde.bello@example.com',
      Role: 'Media Buyer',
      Phone: '+2348022223333',
      'Primary Branch': sampleBranchCode,
      'Additional Branches': '',
      Probation: 'true',
      'Probation Until': new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    };
    const ws = XLSX.utils.json_to_sheet([sampleA, sampleB], { header: headers });

    const headerComments: Record<string, string> = {
      Name: 'Required. Min 2 characters.',
      Email: 'Required. Must be unique.',
      Role:
        'Required. Pick a value from the Reference sheet — enum (CS_CLOSER) or label (Sales Closer) both work.',
      Phone: 'Required. Nigerian number.',
      'Primary Branch':
        'Required. Use the branch CODE first; NAME also works. See Reference sheet for the full list.',
      'Additional Branches':
        'Optional. Comma- or semicolon-separated branch codes/names.',
      Probation: 'Optional. true / false / yes / no. Empty = no.',
      'Probation Until': 'Optional. ISO date, e.g. 2026-08-08. Defaults to +90 days.',
    };
    headers.forEach((h, idx) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: idx });
      const comment = headerComments[h];
      const cell = ws[addr];
      if (cell && comment) {
        (cell as { c?: Array<{ a: string; t: string }> }).c = [{ a: 'Yannis', t: comment }];
      }
    });

    ws['!cols'] = [
      { wch: 22 }, // Name
      { wch: 28 }, // Email
      { wch: 18 }, // Role
      { wch: 16 }, // Phone
      { wch: 18 }, // Primary Branch
      { wch: 22 }, // Additional Branches
      { wch: 12 }, // Probation
      { wch: 16 }, // Probation Until
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');

    // Reference sheet — single column-wise dump of every enum option. Each
    // section is separated by a blank row so it scans well visually.
    const referenceRows: Array<Record<string, string>> = [
      { Column: 'Name', Rule: 'Free text. Min 2 characters.' },
      { Column: 'Email', Rule: 'Unique login email.' },
      { Column: 'Role', Rule: 'Pick from the list below (enum or label).' },
      { Column: 'Phone', Rule: 'Nigerian: 08031234567 or +2348031234567.' },
      { Column: 'Primary Branch', Rule: 'Branch CODE or NAME (case-insensitive).' },
      { Column: 'Additional Branches', Rule: 'Comma- or semicolon-separated.' },
      { Column: 'Probation', Rule: 'true / false / yes / no. Empty = no.' },
      { Column: 'Probation Until', Rule: 'ISO date (YYYY-MM-DD).' },
      { Column: '', Rule: '' },
      { Column: 'Valid roles (enum)', Rule: 'Accepted labels' },
      ...SPREADSHEET_IMPORT_ROLE_REFERENCE.map((r) => ({
        Column: r.enum,
        Rule: r.acceptedLabels,
      })),
      { Column: '', Rule: '' },
      {
        Column: 'Valid branches (code)',
        Rule: branches.length > 0 ? 'Branch name' : 'No branches configured yet',
      },
      ...branches.map((b) => ({ Column: b.code, Rule: b.name })),
    ];
    const refWs = XLSX.utils.json_to_sheet(referenceRows, { header: ['Column', 'Rule'] });
    refWs['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

    XLSX.writeFile(wb, 'yannis-users-import-template.xlsx');
  }

  // Sequential row-by-row submit. Each row is one POST to the page action's `importUser`
  // intent, which calls `users.create`. Cancel flips a ref the loop checks before each row.
  async function runImport() {
    cancelRef.current = false;
    setStep('import');
    const initial: RowStatus[] = resolved.map((r) =>
      r.errors.length > 0 ? { state: 'invalid' } : { state: 'pending' },
    );
    setStatuses(initial);

    for (let i = 0; i < resolved.length; i += 1) {
      if (cancelRef.current) break;
      const row = resolved[i]!;
      if (row.errors.length > 0) continue; // already marked invalid

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
          setStatuses((prev) =>
            prev.map((s, idx) => (idx === i ? { state: 'created', requiresApproval } : s)),
          );
        } else {
          const reason = (data as { error?: string }).error ?? `HTTP ${res.status}`;
          setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'failed', reason } : s)));
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Network error';
        setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'failed', reason } : s)));
      }
    }

    setStep('summary');
  }

  function handleFileChange(file: File) {
    setParseError(null);
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
          rowIndex: idx + 2, // +2 because row 1 is headers in the source sheet
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
        setStep('preview');
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Could not parse the file.');
      }
    };
    reader.onerror = () => setParseError('Could not read the file. Try again.');
    reader.readAsBinaryString(file);
  }

  if (!open) return null;

  const completedCount = statuses.filter((s) => s.state === 'created').length;
  const failedCount = statuses.filter((s) => s.state === 'failed').length;
  const invalidStatusCount = statuses.filter((s) => s.state === 'invalid').length;
  const inFlightIdx = statuses.findIndex((s) => s.state === 'in_flight');
  const progressPercent =
    statuses.length === 0 ? 0 : Math.round(((completedCount + failedCount) / (statuses.length - invalidStatusCount || 1)) * 100);

  return (
    <Modal open onClose={onClose} contentClassName="p-0" maxWidth="max-w-3xl">
      <div className="px-5 pt-5 pb-3 border-b border-app-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-app-fg">Import users from Excel</h2>
          <p className="mt-1 text-xs text-app-fg-muted">
            Upload a spreadsheet, preview the rows, then import. Each row is created one at a time
            so a single bad row doesn&apos;t block the rest.
          </p>
        </div>
        {step !== 'import' ? (
          <button
            type="button"
            onClick={onClose}
            className="text-app-fg-muted hover:text-app-fg p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {step === 'upload' && (
        <div className="px-5 py-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 -mb-2">
            <p className="text-xs text-app-fg-muted">
              New here? Grab the starter template — headers + sample rows + a Reference sheet of valid roles and branches.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={downloadTemplate}
              disabled={branchesLoading}
            >
              Download template
            </Button>
          </div>
          <div className="rounded-lg border-2 border-dashed border-app-border p-6 text-center">
            <p className="text-sm text-app-fg-muted mb-3">
              Drop an .xlsx, .xls, or .csv file, or click to choose. Max 500 rows per import.
            </p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileChange(file);
              }}
              className="block mx-auto text-sm"
            />
          </div>
          {parseError ? <InlineNotification variant="danger" message={parseError} /> : null}

          <div>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="text-mini font-semibold uppercase tracking-wider text-app-fg-muted">
                Expected columns
              </p>
              <p className="text-micro text-app-fg-muted">
                Header names are case-insensitive
              </p>
            </div>
            <ColumnsReferenceGrid branches={branches} />
          </div>
        </div>
      )}

      {step === 'preview' && (
        <>
          <div className="px-5 py-3 border-b border-app-border flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <span className="text-app-fg">
                <strong>{resolved.length}</strong> row{resolved.length === 1 ? '' : 's'}
              </span>
              <span className="text-success-700 dark:text-success-400">
                {validCount} ready
              </span>
              {invalidCount > 0 ? (
                <span className="text-danger-700 dark:text-danger-400">{invalidCount} with errors</span>
              ) : null}
              {branchesLoading ? (
                <span className="text-app-fg-muted">Loading branches…</span>
              ) : null}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setStep('upload')}>
              Choose another file
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto px-5 py-3">
            <table className="w-full text-xs">
              <thead className="text-app-fg-muted border-b border-app-border">
                <tr>
                  <th className="text-left py-2 pr-2">Row</th>
                  <th className="text-left py-2 pr-2">Name</th>
                  <th className="text-left py-2 pr-2">Email</th>
                  <th className="text-left py-2 pr-2">Role</th>
                  <th className="text-left py-2 pr-2">Branch</th>
                  <th className="text-left py-2 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((row, idx) => {
                  const ok = row.errors.length === 0;
                  return (
                    <tr
                      key={`${row.rowIndex}-${idx}`}
                      className={`border-b border-app-border ${ok ? '' : 'bg-danger-50/40 dark:bg-danger-900/10'}`}
                    >
                      <td className="py-2 pr-2 text-app-fg-muted tabular-nums">{row.rowIndex}</td>
                      <td className="py-2 pr-2 text-app-fg">{row.name || <span className="text-danger-700">—</span>}</td>
                      <td className="py-2 pr-2 text-app-fg-muted">{row.email || <span className="text-danger-700">—</span>}</td>
                      <td className="py-2 pr-2 text-app-fg">
                        {row.resolvedRole ?? <span className="text-danger-700">{row.role || '—'}</span>}
                      </td>
                      <td className="py-2 pr-2 text-app-fg-muted">{row.primaryBranchInput || '—'}</td>
                      <td className="py-2 pr-2">
                        {ok ? (
                          <span className="text-success-700 dark:text-success-400">Ready</span>
                        ) : (
                          <span className="text-danger-700 dark:text-danger-400" title={row.errors.join(' ')}>
                            {row.errors[0]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-app-border px-5 py-4 flex items-center justify-between">
            <p className="text-xs text-app-fg-muted">
              Invalid rows are skipped automatically — fix in Excel and re-upload to include them.
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={runImport}
                disabled={validCount === 0 || branchesLoading}
              >
                Import {validCount} user{validCount === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </>
      )}

      {step === 'import' && (
        <div className="px-5 py-6 space-y-4">
          <div>
            <p className="text-sm text-app-fg">
              Importing {completedCount + failedCount} of {statuses.length - invalidStatusCount} users…
            </p>
            <div className="mt-2 h-2 w-full rounded-full bg-app-hover overflow-hidden">
              <div
                className="h-full bg-brand-500 transition-[width] duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs">
              <span className="text-success-700 dark:text-success-400">{completedCount} created</span>
              {failedCount > 0 ? (
                <span className="text-danger-700 dark:text-danger-400">{failedCount} failed</span>
              ) : null}
              {invalidStatusCount > 0 ? (
                <span className="text-app-fg-muted">{invalidStatusCount} skipped (invalid)</span>
              ) : null}
            </div>
          </div>
          <div className="max-h-[40vh] overflow-y-auto rounded-md border border-app-border">
            <ul className="text-xs divide-y divide-app-border">
              {resolved.map((row, idx) => {
                const status = statuses[idx];
                const isCurrent = inFlightIdx === idx;
                return (
                  <li
                    key={`${row.rowIndex}-${idx}`}
                    className={`flex items-center justify-between px-3 py-1.5 ${
                      isCurrent ? 'bg-brand-50 dark:bg-brand-900/20' : ''
                    }`}
                  >
                    <span className="truncate text-app-fg">
                      <span className="text-app-fg-muted mr-2">#{row.rowIndex}</span>
                      {row.name || row.email}
                    </span>
                    <span className="ml-3 text-right shrink-0">
                      {status?.state === 'in_flight' && (
                        <span className="text-app-fg-muted">Importing…</span>
                      )}
                      {status?.state === 'pending' && <span className="text-app-fg-muted">Queued</span>}
                      {status?.state === 'invalid' && <span className="text-app-fg-muted">Skipped</span>}
                      {status?.state === 'created' && (
                        <span className="text-success-700 dark:text-success-400">
                          ✓ Created{status.requiresApproval ? ' (pending approval)' : ''}
                        </span>
                      )}
                      {status?.state === 'failed' && (
                        <span className="text-danger-700 dark:text-danger-400" title={status.reason}>
                          ✗ {status.reason}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                cancelRef.current = true;
                setStep('summary');
              }}
            >
              Stop
            </Button>
          </div>
        </div>
      )}

      {step === 'summary' && (
        <div className="px-5 py-6 space-y-4">
          <InlineNotification
            variant={failedCount === 0 ? 'success' : 'warning'}
            message={
              failedCount === 0
                ? `Import complete. ${completedCount} user${completedCount === 1 ? '' : 's'} created.`
                : `Import finished. ${completedCount} created, ${failedCount} failed${invalidStatusCount > 0 ? `, ${invalidStatusCount} skipped` : ''}.`
            }
          />
          {failedCount > 0 ? (
            <div className="rounded-md border border-app-border max-h-[40vh] overflow-y-auto">
              <ul className="text-xs divide-y divide-app-border">
                {resolved.map((row, idx) => {
                  const status = statuses[idx];
                  if (status?.state !== 'failed') return null;
                  return (
                    <li key={`${row.rowIndex}-${idx}`} className="px-3 py-1.5">
                      <span className="text-app-fg-muted mr-2">#{row.rowIndex}</span>
                      <span className="text-app-fg">{row.name || row.email}</span>
                      <span className="text-danger-700 dark:text-danger-400 ml-2">
                        — {status.reason}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setStep('upload');
                setParsed([]);
                setStatuses([]);
              }}
            >
              Import another file
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                onComplete();
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
