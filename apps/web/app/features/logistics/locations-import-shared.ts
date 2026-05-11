/**
 * Pure utilities for the logistics locations bulk-import flow. Each location
 * belongs to a provider (3PL company) — the resolver matches the
 * `provider` cell against the live providers list (case-insensitive name OR
 * id) and surfaces a validation error when no match is found.
 */

export interface ProviderInfo {
  id: string;
  name: string;
  status: string;
}

export interface ParsedRow {
  /** 1-based row number from the source sheet (header is row 1). */
  rowIndex: number;
  /** Free-text input from the sheet — provider name or UUID. */
  providerInput: string;
  name: string;
  address: string;
  coordinates: string;
  whatsappGroupLink: string;
}

export interface ResolvedRow extends ParsedRow {
  /** Resolved provider UUID; null when unknown / blank. */
  providerId: string | null;
  /** Resolved provider display name (for the modal "Current value" + summary). */
  providerName: string | null;
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

export function resolveProvider(
  input: string,
  providers: ProviderInfo[],
): { id: string | null; name: string | null; unknown: boolean } {
  const trimmed = input.trim();
  if (!trimmed) return { id: null, name: null, unknown: false };
  // Match by id first (paste-from-database use case), then by name.
  const byId = providers.find((p) => p.id === trimmed);
  if (byId) return { id: byId.id, name: byId.name, unknown: false };
  const lower = trimmed.toLowerCase();
  const byName = providers.find((p) => p.name.toLowerCase() === lower);
  if (byName) return { id: byName.id, name: byName.name, unknown: false };
  return { id: null, name: null, unknown: true };
}

const WHATSAPP_LINK = /^https:\/\/(chat\.whatsapp\.com|wa\.me)\/[\w\-+/=]+$/i;

export function resolveRow(parsed: ParsedRow, providers: ProviderInfo[]): ResolvedRow {
  const errors: string[] = [];

  if (!parsed.name || parsed.name.length < 2) {
    errors.push('Name must be at least 2 characters.');
  } else if (parsed.name.length > 200) {
    errors.push('Name must be 200 characters or fewer.');
  }

  if (!parsed.address || parsed.address.length < 5) {
    errors.push('Address must be at least 5 characters.');
  } else if (parsed.address.length > 500) {
    errors.push('Address must be 500 characters or fewer.');
  }

  const provider = resolveProvider(parsed.providerInput, providers);
  if (!parsed.providerInput.trim()) {
    errors.push('Provider is required — pick the 3PL company that owns this location.');
  } else if (provider.unknown) {
    errors.push(
      `Unknown provider "${parsed.providerInput}". Create the company first under Logistics → Companies, or pick from the dropdown.`,
    );
  }

  if (parsed.coordinates && parsed.coordinates.length > 100) {
    errors.push('Coordinates must be 100 characters or fewer.');
  }

  if (parsed.whatsappGroupLink && !WHATSAPP_LINK.test(parsed.whatsappGroupLink)) {
    errors.push(
      'WhatsApp group link must be a chat.whatsapp.com or wa.me URL (or leave it blank).',
    );
  }

  return {
    ...parsed,
    providerId: provider.id,
    providerName: provider.name,
    errors,
  };
}

/** Empty row factory used when adding a fresh row to the editor table. */
export function makeEmptyParsedRow(rowIndex: number): ParsedRow {
  return {
    rowIndex,
    providerInput: '',
    name: '',
    address: '',
    coordinates: '',
    whatsappGroupLink: '',
  };
}
