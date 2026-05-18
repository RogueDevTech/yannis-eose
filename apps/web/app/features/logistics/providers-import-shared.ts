/**
 * Pure utilities for the logistics providers (3PL companies) bulk-import
 * flow. Framework-free so the column renderers, the sheet parser, and the
 * resolver all share the same validation contract.
 */

export interface ParsedRow {
  /** 1-based row number from the source sheet (header is row 1). */
  rowIndex: number;
  name: string;
  contactInfo: string;
  coverageArea: string;
}

export interface ResolvedRow extends ParsedRow {
  errors: string[];
}

export function pickHeaderValue(row: Record<string, unknown>, header: string): string {
  // Aggressive normalisation matching the rest of the import flows: lowercase,
  // run of whitespace/dashes/dots/slashes → single underscore, then strip
  // leading + trailing underscores.
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

export function resolveRow(parsed: ParsedRow): ResolvedRow {
  const errors: string[] = [];

  if (!parsed.name || parsed.name.length < 2) {
    errors.push('Name must be at least 2 characters.');
  } else if (parsed.name.length > 200) {
    errors.push('Name must be 200 characters or fewer.');
  }

  if (!parsed.contactInfo || parsed.contactInfo.length < 1) {
    errors.push('Contact info is required (phone, email, or both).');
  } else if (parsed.contactInfo.length > 500) {
    errors.push('Contact info must be 500 characters or fewer.');
  }

  if (!parsed.coverageArea || parsed.coverageArea.length < 1) {
    errors.push('Coverage area is required (e.g. "Lagos, Ogun" or "Nigeria-wide").');
  } else if (parsed.coverageArea.length > 500) {
    errors.push('Coverage area must be 500 characters or fewer.');
  }

  return { ...parsed, errors };
}

/** Empty row factory used when adding a fresh row to the editor table. */
export function makeEmptyParsedRow(rowIndex: number): ParsedRow {
  return {
    rowIndex,
    name: '',
    contactInfo: '',
    coverageArea: '',
  };
}
