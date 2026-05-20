/**
 * Pure utilities for the combined provider + location bulk-import flow.
 *
 * One spreadsheet row = one location. Providers are auto-created (idempotent):
 * rows that share the same provider name (case-insensitive) group together and
 * the server find-or-creates the provider once, then creates each location
 * under it.
 *
 * Framework-free so column renderers, the sheet parser, and the resolver all
 * share the same validation contract.
 */

export interface ProviderInfo {
  id: string;
  name: string;
  status: string;
}

/** 36 Nigerian states + FCT. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
  'Lagos', 'Nassarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
] as const;

export interface ParsedRow {
  /** 1-based row number from the source sheet (header is row 1). */
  rowIndex: number;
  /** Provider company name — will be find-or-created on the server. */
  providerName: string;
  /** Provider phone / contact info. */
  contactPhone: string;
  /** Coverage area / regions this provider covers. */
  coverageArea: string;
  /** Location name (short label for the delivery area). */
  locationName: string;
  /** Location address (physical address or area description). */
  locationAddress: string;
  /** Nigerian state (required — one of 36 states + FCT). */
  state: string;
  /** WhatsApp group link for CS dispatch. */
  whatsappGroupLink: string;
}

export interface ResolvedRow extends ParsedRow {
  /** Matched existing provider UUID (null if new — will be auto-created). */
  existingProviderId: string | null;
  /** Whether the provider already exists in the system. */
  providerExists: boolean;
  errors: string[];
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

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Clean up phone strings from Excel (trailing .0, formula prefixes, spaces). */
export function cleanPhone(raw: string): string {
  let s = raw.trim();
  // Excel formulas like =+234...
  if (s.startsWith('=')) s = s.replace(/^=\+?/, '');
  // Trailing .0 from Excel numeric coercion
  if (/^\d+\.0$/.test(s)) s = s.replace(/\.0$/, '');
  // Remove internal spaces (e.g. "234903 464 9383")
  s = s.replace(/\s+/g, '');
  return s;
}

const WHATSAPP_LINK = /^https:\/\/(chat\.whatsapp\.com|wa\.me)\/[\w\-+/=]+$/i;

export function resolveRow(parsed: ParsedRow, providers: ProviderInfo[]): ResolvedRow {
  const errors: string[] = [];

  // --- Provider name ---
  if (!parsed.providerName || parsed.providerName.length < 2) {
    errors.push('Provider name must be at least 2 characters.');
  } else if (parsed.providerName.length > 200) {
    errors.push('Provider name must be 200 characters or fewer.');
  }

  // --- Contact phone (used as provider contactInfo) ---
  if (!parsed.contactPhone) {
    errors.push('Contact phone is required.');
  } else if (parsed.contactPhone.length > 500) {
    errors.push('Contact phone must be 500 characters or fewer.');
  }

  // --- Coverage area ---
  if (!parsed.coverageArea) {
    errors.push('Coverage area / location region is required.');
  } else if (parsed.coverageArea.length > 500) {
    errors.push('Coverage area must be 500 characters or fewer.');
  }

  // --- Location name (fall back to coverage area if blank) ---
  const effectiveLocationName = parsed.locationName || parsed.coverageArea;
  if (effectiveLocationName.length < 2) {
    errors.push('Location name must be at least 2 characters.');
  } else if (effectiveLocationName.length > 200) {
    errors.push('Location name must be 200 characters or fewer.');
  }

  // --- Location address (fall back to coverage area) ---
  const effectiveAddress = parsed.locationAddress || parsed.coverageArea;
  if (!effectiveAddress || effectiveAddress.length < 2) {
    errors.push('Location address must be at least 2 characters (falls back to coverage area).');
  } else if (effectiveAddress.length > 500) {
    errors.push('Location address must be 500 characters or fewer.');
  }

  // --- State (required, must be a valid Nigerian state) ---
  if (!parsed.state) {
    errors.push('State is required — pick one of the 36 Nigerian states or FCT.');
  } else if (!(NIGERIAN_STATES as readonly string[]).includes(parsed.state)) {
    errors.push(`"${parsed.state}" is not a recognised Nigerian state. Pick from the dropdown.`);
  }

  // --- WhatsApp group link ---
  if (parsed.whatsappGroupLink && !WHATSAPP_LINK.test(parsed.whatsappGroupLink)) {
    errors.push(
      'WhatsApp group link must be a chat.whatsapp.com or wa.me URL (or leave it blank).',
    );
  }

  // --- Resolve existing provider ---
  const trimmedProvider = parsed.providerName.trim().toLowerCase();
  const existingProvider = providers.find((p) => p.name.toLowerCase() === trimmedProvider);

  return {
    ...parsed,
    existingProviderId: existingProvider?.id ?? null,
    providerExists: !!existingProvider,
    errors,
  };
}

/** Empty row factory used when adding a fresh row to the editor table. */
export function makeEmptyParsedRow(rowIndex: number): ParsedRow {
  return {
    rowIndex,
    providerName: '',
    contactPhone: '',
    coverageArea: '',
    locationName: '',
    locationAddress: '',
    state: '',
    whatsappGroupLink: '',
  };
}
