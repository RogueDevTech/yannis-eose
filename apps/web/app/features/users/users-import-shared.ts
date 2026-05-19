/**
 * Pure utilities shared by the legacy `UsersImportModal` and the new
 * `UsersImportPage`. No React, no fetcher — keep this file framework-free so
 * unit tests stay simple and the page-side editor can call these on every
 * keystroke without dragging in modal state.
 */

export interface BranchInfo {
  id: string;
  code: string;
  name: string;
  status: string;
}

/** Mirrors the backend branching rule: Marketing, CS, Branch Admin, and HR
 *  (added 2026-05-19) live in `user_branches`. */
export const BRANCH_ELIGIBLE_IMPORT_ROLES = new Set([
  'MEDIA_BUYER',
  'HEAD_OF_MARKETING',
  'CS_CLOSER',
  'HEAD_OF_CS',
  'BRANCH_ADMIN',
  'HR_MANAGER',
]);

/**
 * Importable roles — single source for VALID_ROLES + the column-guide reference.
 * SUPER_ADMIN is intentionally omitted (cannot be imported).
 */
export const SPREADSHEET_IMPORT_ROLE_REFERENCE = [
  { enum: 'ADMIN', acceptedLabels: 'Admin' },
  { enum: 'BRANCH_ADMIN', acceptedLabels: 'Branch Admin' },
  { enum: 'HEAD_OF_MARKETING', acceptedLabels: 'Head of Marketing' },
  { enum: 'MEDIA_BUYER', acceptedLabels: 'Media Buyer' },
  { enum: 'HEAD_OF_CS', acceptedLabels: 'Head of CS' },
  { enum: 'CS_CLOSER', acceptedLabels: 'CS Closer' },
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
  // Legacy alias — pre-2026-05-10 sheets still import cleanly.
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

export function normalizeRole(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase().replace(/\s+/g, '_');
  if (VALID_ROLES.has(upper)) return upper;
  const lower = trimmed.toLowerCase();
  return ROLE_LABEL_LOOKUP[lower] ?? null;
}

export const NIGERIAN_PHONE = /^(?:0[789]\d{9}|\+234[789]\d{9})$/;

export interface ParsedRow {
  /** 1-based row number from the source sheet (header is row 1). Used for human display. */
  rowIndex: number;
  name: string;
  email: string;
  role: string;
  phone: string;
  primaryBranchInput: string;
  additionalBranchesInput: string;
  isProbation: boolean;
  probationUntil: string;
}

export interface ResolvedRow extends ParsedRow {
  /** Canonical role enum (or null when unresolvable). */
  resolvedRole: string | null;
  primaryBranchId: string | null;
  additionalBranchIds: string[];
  errors: string[];
}

export function pickHeaderValue(row: Record<string, unknown>, header: string): string {
  // Excel header lookups are aggressively normalised: lowercase, treat any run
  // of whitespace / dashes / dots / slashes as a single underscore, then strip
  // leading + trailing underscores. That way " Primary Branch", "primary-branch",
  // "PRIMARY  BRANCH", and a stray BOM all resolve to "primary_branch".
  const target = normalizeHeader(header);
  for (const key of Object.keys(row)) {
    if (normalizeHeader(key) === target) {
      const v = row[key];
      if (v == null) return '';
      return String(v).trim();
    }
  }
  return '';
}

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseTruthy(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

export function resolveBranchId(input: string, branches: BranchInfo[]): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const byCode = branches.find((b) => b.code.toLowerCase() === lower);
  if (byCode) return byCode.id;
  const byName = branches.find((b) => b.name.toLowerCase() === lower);
  return byName?.id ?? null;
}

export function resolveRow(parsed: ParsedRow, branches: BranchInfo[]): ResolvedRow {
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
      `Unknown role "${parsed.role}". Use a valid role enum (e.g. CS_CLOSER) or label (e.g. "CS Closer").`,
    );
  }
  const roleNeedsBranch = !!resolvedRole && BRANCH_ELIGIBLE_IMPORT_ROLES.has(resolvedRole);
  const primaryBranchId = roleNeedsBranch
    ? resolveBranchId(parsed.primaryBranchInput, branches)
    : null;
  if (roleNeedsBranch && !primaryBranchId) {
    errors.push(
      `Unknown primary branch "${parsed.primaryBranchInput}". Use a branch code or full name.`,
    );
  }
  const additionalBranchIds: string[] = [];
  if (roleNeedsBranch && parsed.additionalBranchesInput) {
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

/** Empty row factory used when adding a fresh row to the editor table. */
export function makeEmptyParsedRow(rowIndex: number): ParsedRow {
  return {
    rowIndex,
    name: '',
    email: '',
    role: '',
    phone: '',
    primaryBranchInput: '',
    additionalBranchesInput: '',
    isProbation: false,
    probationUntil: '',
  };
}
