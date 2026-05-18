/**
 * Pure utilities for the products bulk-import flow. Framework-free so the
 * column renderers, the sheet parser, and the resolver all share the same
 * validation contract and unit tests stay simple.
 */

export interface CategoryInfo {
  id: string;
  name: string;
}

export interface ParsedRow {
  /** 1-based row number from the source sheet (header is row 1). */
  rowIndex: number;
  name: string;
  basePriceInput: string;
  costPriceInput: string;
  categoryInput: string;
  description: string;
  galleryUrlsInput: string;
}

export interface ResolvedRow extends ParsedRow {
  basePrice: number | null;
  costPrice: number | null;
  /** Resolved category UUID (when matched); null when blank or unknown. */
  categoryId: string | null;
  /** Resolved category display name — passed through to `products.create.category`. */
  categoryName: string | null;
  galleryUrls: string[];
  errors: string[];
}

export function pickHeaderValue(row: Record<string, unknown>, header: string): string {
  // Excel header lookups are aggressively normalised: lowercase, treat any run
  // of whitespace / dashes / dots / slashes as a single underscore, then strip
  // leading + trailing underscores. That way " Base Price", "Base-Price",
  // "BASE  PRICE", and a stray BOM all resolve to "base_price".
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

/** Parse a numeric cell tolerating currency symbols, thousand separators,
 *  stray whitespace — common when operators copy from invoices. */
export function parseNumeric(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₦,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function parseGalleryUrls(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function resolveCategory(
  input: string,
  categories: CategoryInfo[],
): { id: string | null; name: string | null; unknown: boolean } {
  const trimmed = input.trim();
  if (!trimmed) return { id: null, name: null, unknown: false };
  const lower = trimmed.toLowerCase();
  const match = categories.find((c) => c.name.toLowerCase() === lower);
  if (match) return { id: match.id, name: match.name, unknown: false };
  return { id: null, name: null, unknown: true };
}

export function resolveRow(parsed: ParsedRow, categories: CategoryInfo[]): ResolvedRow {
  const errors: string[] = [];

  if (!parsed.name || parsed.name.length < 2) {
    errors.push('Name must be at least 2 characters.');
  }

  const basePrice = parseNumeric(parsed.basePriceInput);
  if (basePrice === null) {
    errors.push('Base price must be a number ≥ 0 (e.g. 30000 or 12999.99).');
  }
  const costPrice = parseNumeric(parsed.costPriceInput);
  if (costPrice === null) {
    errors.push('Cost price must be a number ≥ 0.');
  }

  const cat = resolveCategory(parsed.categoryInput, categories);
  if (cat.unknown) {
    errors.push(
      `Unknown category "${parsed.categoryInput}". Create it under Admin → Categories, or leave the cell blank.`,
    );
  }

  const galleryUrls = parseGalleryUrls(parsed.galleryUrlsInput);
  const badUrl = galleryUrls.find((u) => {
    try {
      // Allow `http(s)://` only — relative paths or `javascript:` etc. are rejected.
      const parsedUrl = new URL(u);
      return !['http:', 'https:'].includes(parsedUrl.protocol);
    } catch {
      return true;
    }
  });
  if (badUrl) {
    errors.push(`Gallery URL "${badUrl}" is not a valid http(s) URL.`);
  }

  return {
    ...parsed,
    basePrice,
    costPrice,
    categoryId: cat.id,
    categoryName: cat.name,
    galleryUrls,
    errors,
  };
}

/** Empty row factory used when adding a fresh row to the editor table. */
export function makeEmptyParsedRow(rowIndex: number): ParsedRow {
  return {
    rowIndex,
    name: '',
    basePriceInput: '',
    costPriceInput: '',
    categoryInput: '',
    description: '',
    galleryUrlsInput: '',
  };
}
