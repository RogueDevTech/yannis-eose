/**
 * Pure utilities for the orders bulk-import flow (CRM migration).
 * Framework-free so column renderers, sheet parser, and resolver share
 * the same validation contract.
 */

export interface ProductInfo {
  id: string;
  name: string;
  offers?: Array<{ label: string; price: string; qty: number }>;
}

export interface ParsedRow {
  rowIndex: number;
  dateInput: string;
  name: string;
  phoneInput: string;
  whatsappInput: string;
  emailInput: string;
  addressInput: string;
  stateInput: string;
  productInput: string;
  unitInput: string;
  quantityInput: string;
  costInput: string;
  genderInput: string;
  deliveryTimeInput: string;
  moreDetailsInput: string;
  statusInput: string;
  mediaBuyerInput: string;
  csInput: string;
  deliveryAgentInput: string;
  comment1Input: string;
  comment2Input: string;
  comment3Input: string;
  /** Raw Media Buyer ID from spreadsheet (e.g. 'USR-42') */
  mbIdInput: string;
  /** Raw CS ID from spreadsheet (e.g. 'USR-12') */
  csIdInput: string;
  /** Per-row media buyer override (user UUID or '__system__' or '' for global default) */
  rowMbId: string;
  /** Per-row CS agent override (user UUID or '__system__' or '' for global default) */
  rowCsId: string;
}

export interface ResolvedRow extends ParsedRow {
  /** Resolved product UUID (when matched); null when blank or unknown. */
  productId: string | null;
  productName: string | null;
  quantity: number;
  cost: number | null;
  /** Mapped system status */
  targetStatus: ImportTargetStatus | null;
  /** Parsed ISO date string from Excel date column */
  createdAtIso: string | null;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Header normalisation (reused from products-import-shared pattern)
// ---------------------------------------------------------------------------

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function pickHeaderValue(row: Record<string, unknown>, header: string): string {
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

// ---------------------------------------------------------------------------
// Numeric parser (tolerates Naira, commas, spaces)
// ---------------------------------------------------------------------------

export function parseNumeric(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₦N,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Date parser — handles Excel serial dates and string dates
// ---------------------------------------------------------------------------

export function parseExcelDate(raw: string): string | null {
  if (!raw) return null;

  // Excel serial number (e.g. 46143)
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 30000 && asNum < 100000) {
    // Excel epoch is 1900-01-01, with the 1900 leap year bug (+1 day offset)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + asNum * 86400000);
    if (!isNaN(date.getTime())) return date.toISOString();
  }

  // Try common string formats: "4/29/2026", "5/2/2026 9:05:30", "2026-04-29", etc.
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    // Sanity check: year should be reasonable (2020-2030)
    const year = parsed.getFullYear();
    if (year >= 2020 && year <= 2030) return parsed.toISOString();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

export type ImportTargetStatus =
  | 'CS_ASSIGNED'
  | 'CS_ENGAGED'
  | 'CONFIRMED'
  | 'DELIVERED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'REMITTED'
  | 'DELETED';

/** CRM-friendly labels → system status. Used both for parsing sheet text and for the dropdown. */
export const IMPORT_STATUS_OPTIONS: { value: ImportTargetStatus; label: string }[] = [
  { value: 'CS_ASSIGNED', label: 'Pending' },
  { value: 'CS_ENGAGED', label: 'No Response' },
  { value: 'CS_ENGAGED', label: 'Rescheduled' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REMITTED', label: 'Delivered and Cash Remitted' },
  { value: 'DELETED', label: 'Deleted' },
];

export function parseStatus(raw: string): ImportTargetStatus | null {
  const lower = raw.toLowerCase().trim();
  if (!lower) return null;
  // Exact/substring matches against CRM labels
  if (lower.includes('delivered') && (lower.includes('remitted') || lower.includes('cash'))) return 'REMITTED';
  if (lower.includes('pending')) return 'CS_ASSIGNED';
  if (lower.includes('no response') || lower.includes('no_response')) return 'CS_ENGAGED';
  if (lower.includes('rescheduled')) return 'CS_ENGAGED';
  if (lower.includes('confirmed')) return 'CONFIRMED';
  if (lower.includes('delivered')) return 'DELIVERED';
  if (lower.includes('returned')) return 'RETURNED';
  if (lower.includes('cancelled') || lower.includes('canceled')) return 'CANCELLED';
  if (lower.includes('remitted')) return 'REMITTED';
  if (lower.includes('deleted')) return 'DELETED';
  return null;
}

// ---------------------------------------------------------------------------
// Product resolution (case-insensitive fuzzy match)
// ---------------------------------------------------------------------------

export function resolveProduct(
  input: string,
  products: ProductInfo[],
): { id: string | null; name: string | null; unknown: boolean } {
  const trimmed = input.trim();
  if (!trimmed) return { id: null, name: null, unknown: false };
  const lower = trimmed.toLowerCase();
  // Exact match first
  const exact = products.find((p) => p.name.toLowerCase() === lower);
  if (exact) return { id: exact.id, name: exact.name, unknown: false };
  // Partial match — product name contains the input or vice versa
  const partial = products.find(
    (p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()),
  );
  if (partial) return { id: partial.id, name: partial.name, unknown: false };
  return { id: null, name: null, unknown: true };
}

// ---------------------------------------------------------------------------
// Row resolver
// ---------------------------------------------------------------------------

export function resolveRow(parsed: ParsedRow): ResolvedRow {
  const errors: string[] = [];

  // Customer name
  if (!parsed.name || parsed.name.length < 2) {
    errors.push('Name must be at least 2 characters.');
  }

  // Phone
  if (!parsed.phoneInput || parsed.phoneInput.trim().length < 5) {
    errors.push('Phone number is required.');
  }

  // Quantity — default 1
  const quantityRaw = parsed.quantityInput.trim();
  let quantity = 1;
  if (quantityRaw) {
    const q = parseInt(quantityRaw, 10);
    if (!Number.isFinite(q) || q < 1) {
      errors.push('Quantity must be a whole number ≥ 1.');
    } else {
      quantity = q;
    }
  }

  // Cost
  const costProvided = parsed.costInput.trim() !== '';
  const cost = costProvided ? parseNumeric(parsed.costInput) : null;
  if (costProvided && cost === null) {
    errors.push('Cost must be a number ≥ 0 (e.g. 100000 or ₦100,000).');
  }

  // Status
  const targetStatus = parseStatus(parsed.statusInput);
  if (!parsed.statusInput.trim()) {
    errors.push('Status is required.');
  } else if (!targetStatus) {
    errors.push(`Unknown status "${parsed.statusInput}". Select a valid status from the dropdown.`);
  }

  // Date (optional but preferred)
  const createdAtIso = parseExcelDate(parsed.dateInput);

  return {
    ...parsed,
    productId: null,
    productName: null,
    quantity,
    cost,
    targetStatus,
    createdAtIso,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Empty row factory
// ---------------------------------------------------------------------------

export function makeEmptyParsedRow(rowIndex: number): ParsedRow {
  return {
    rowIndex,
    dateInput: '',
    name: '',
    phoneInput: '',
    whatsappInput: '',
    emailInput: '',
    addressInput: '',
    stateInput: '',
    productInput: '',
    unitInput: '',
    quantityInput: '',
    costInput: '',
    genderInput: '',
    deliveryTimeInput: '',
    moreDetailsInput: '',
    statusInput: '',
    mediaBuyerInput: '',
    csInput: '',
    deliveryAgentInput: '',
    comment1Input: '',
    comment2Input: '',
    comment3Input: '',
    mbIdInput: '',
    csIdInput: '',
    rowMbId: '',
    rowCsId: '',
  };
}
