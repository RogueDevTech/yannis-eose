/**
 * ProductsImportModal — bulk-import products from a XLSX/CSV sheet.
 *
 * Mirrors the three-step wizard shape of `UsersImportModal`:
 *   1. Upload   — file picker + column reference. Parsing in the browser via `xlsx`.
 *   2. Preview  — table of parsed rows with per-row validation. Operators can spot
 *                 shape errors (missing prices, unknown categories) before any
 *                 server call goes out.
 *   3. Import   — sequential per-row POST to the page action's `importProduct`
 *                 intent. Per-row failures collected and shown in the summary.
 *
 * The page action delegates to `products.create` so the existing `products.create`
 * permission gate, RLS, and audit triggers all apply row-by-row. A bad row
 * doesn't abort the batch — its error is surfaced in the summary and the rest
 * of the rows continue.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import * as XLSX from 'xlsx';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { useFetcherToast } from '~/components/ui/toast';

interface CategoryInfo {
  id: string;
  name: string;
}

interface ColumnSpec {
  /**
   * Canonical lookup key — snake_case. `pickHeaderValue` matches any
   * spreadsheet header that normalises to this (case-insensitive, treats
   * whitespace + dashes as underscores), so "Name", "Base Price",
   * "Gallery URLs", "GALLERY-URLS", and "gallery_urls" all resolve here.
   */
  header: string;
  /** Friendly display label shown in chips + the column-guide modal. */
  label: string;
  /**
   * Other forms the parser accepts. The matcher is already lenient, but
   * listing them in the column guide reassures operators they don't have to
   * type `gallery_urls` exactly.
   */
  alsoAccepts: string[];
  required: boolean;
  description: string;
  examples: string[];
}

const COLUMN_SPECS: ColumnSpec[] = [
  {
    header: 'name',
    label: 'Name',
    alsoAccepts: ['Name', 'NAME'],
    required: true,
    description: 'Product name. Minimum 2 characters. Must be unique enough to spot in a list.',
    examples: ['Arjuna herb', 'Nebulizer'],
  },
  {
    header: 'base_price',
    label: 'Base Price',
    alsoAccepts: ['Base Price', 'BASE PRICE', 'base price', 'Base-Price'],
    required: true,
    description: 'Public list / "from" price in Naira. Numeric, ≥ 0. Decimals OK (e.g. 4999.99).',
    examples: ['30000', '12999.99'],
  },
  {
    header: 'cost_price',
    label: 'Cost Price',
    alsoAccepts: ['Cost Price', 'COST PRICE', 'cost price', 'Cost-Price'],
    required: true,
    description: 'Cost of goods in Naira (used for margin calc). Numeric, ≥ 0.',
    examples: ['18000', '7250'],
  },
  {
    header: 'category',
    label: 'Category',
    alsoAccepts: ['Category', 'CATEGORY'],
    required: false,
    description:
      'Category name from your catalogue (case-insensitive). Leave blank for products with no category. Unknown names fail validation — create the category first under Admin → Categories.',
    examples: ['Wellness', 'Healthy'],
  },
  {
    header: 'description',
    label: 'Description',
    alsoAccepts: ['Description', 'DESCRIPTION'],
    required: false,
    description: 'Short product blurb. Surfaces on the public form, invoices, and admin views.',
    examples: ['Herbal supplement for heart health.', 'Asthma nebulizer kit.'],
  },
  {
    header: 'gallery_urls',
    label: 'Gallery URLs',
    alsoAccepts: ['Gallery URLs', 'Gallery Urls', 'gallery urls', 'Gallery-URLs', 'GALLERY URLS'],
    required: false,
    description:
      'Public product image URLs, comma- or semicolon-separated. After import the server downloads each image and rehosts it on our CDN — so links surviving the supplier site going down. The product is created instantly; the rehost runs in the background and replaces the URLs within a few seconds. Failed downloads keep the original URL so the storefront still has something to render.',
    examples: [
      'https://cdn.example.com/arjuna-1.jpg, https://cdn.example.com/arjuna-2.jpg',
      'https://cdn.example.com/nebulizer.jpg',
    ],
  },
];

interface ParsedRow {
  rowIndex: number;
  name: string;
  basePriceInput: string;
  costPriceInput: string;
  categoryInput: string;
  description: string;
  galleryUrlsInput: string;
}

interface ResolvedRow extends ParsedRow {
  basePrice: number | null;
  costPrice: number | null;
  /** Resolved category UUID (when matched); null when blank or unknown. */
  categoryId: string | null;
  /** Resolved category display name — passed through to `products.create.category`. */
  categoryName: string | null;
  galleryUrls: string[];
  errors: string[];
}

type RowStatus =
  | { state: 'pending' }
  | { state: 'in_flight' }
  | { state: 'created' }
  | { state: 'failed'; reason: string }
  | { state: 'invalid' };

function pickHeaderValue(row: Record<string, unknown>, header: string): string {
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

function parseNumeric(raw: string): number | null {
  if (!raw) return null;
  // Tolerate currency symbols, thousands separators, stray whitespace — common
  // when operators copy from invoices. Reject obvious garbage.
  const cleaned = raw.replace(/[₦,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseGalleryUrls(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function resolveCategory(input: string, categories: CategoryInfo[]): {
  id: string | null;
  name: string | null;
  unknown: boolean;
} {
  const trimmed = input.trim();
  if (!trimmed) return { id: null, name: null, unknown: false };
  const lower = trimmed.toLowerCase();
  const match = categories.find((c) => c.name.toLowerCase() === lower);
  if (match) return { id: match.id, name: match.name, unknown: false };
  return { id: null, name: null, unknown: true };
}

function resolveRow(parsed: ParsedRow, categories: CategoryInfo[]): ResolvedRow {
  const errors: string[] = [];

  if (!parsed.name || parsed.name.length < 2) errors.push('Name must be at least 2 characters.');

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

function InfoCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-3.5 w-3.5'}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}

function resolveColumnExamples(spec: ColumnSpec, categories: CategoryInfo[]): string[] {
  if (categories.length === 0) return spec.examples;
  if (spec.header === 'category') {
    // First two real category names so the example reflects the operator's
    // actual catalogue, not generic placeholders.
    const sample = categories.slice(0, 2).map((c) => c.name);
    if (sample.length === 0) return spec.examples;
    return sample;
  }
  return spec.examples;
}

function ColumnsReferenceGrid({ categories }: { categories: CategoryInfo[] }) {
  const [detailColumn, setDetailColumn] = useState<ColumnSpec | null>(null);
  const detailTitleId = 'products-import-column-guide-title';
  const detailExamples = detailColumn ? resolveColumnExamples(detailColumn, categories) : [];

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
                <span className="ml-0.5 text-danger-500" aria-hidden="true">
                  *
                </span>
              ) : null}
              {c.required ? <span className="sr-only"> (required)</span> : null}
            </span>
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
          <>
            <div className="px-5 pt-5 pb-4 border-b border-app-border flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <h3 id={detailTitleId} className="text-base font-semibold text-app-fg leading-snug">
                  <span className="text-app-fg-muted font-normal">Spreadsheet column · </span>
                  <span className="text-[15px] font-semibold text-app-fg">{detailColumn.label}</span>
                </h3>
                {detailColumn.required ? (
                  <span className="inline-flex text-[10px] uppercase tracking-wider rounded-md bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300 px-2 py-0.5 font-semibold">
                    Required in every row
                  </span>
                ) : (
                  <span className="inline-flex text-[10px] uppercase tracking-wider rounded-md bg-app-hover text-app-fg-muted px-2 py-0.5 font-semibold">
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
            <div className="px-5 py-4 space-y-4 max-h-[min(60dvh,22rem)] overflow-y-auto">
              <p className="text-sm text-app-fg leading-relaxed">{detailColumn.description}</p>
              <div className="rounded-md border border-app-border bg-app-hover/40 px-3 py-2 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-muted">
                  Header names — case &amp; spacing don&apos;t matter
                </p>
                <p className="text-xs text-app-fg-muted">
                  The matcher lowercases the column header and treats spaces or dashes as underscores.
                  Any of these (and more) all work for this column:
                </p>
                <ul className="flex flex-wrap gap-1">
                  {[detailColumn.label, detailColumn.header, ...detailColumn.alsoAccepts].map((alias) => (
                    <li key={alias}>
                      <code className="font-mono text-[11px] rounded bg-app-elevated border border-app-border px-1.5 py-0.5 text-app-fg">
                        {alias}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
              {detailExamples.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                    Example values
                    {detailColumn.header === 'category' && categories.length > 0 ? (
                      <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-app-fg-muted">
                        — pulled from your catalogue
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
          </>
        ) : null}
      </Modal>
    </>
  );
}

interface ProductsImportModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function ProductsImportModal({ open, onClose, onComplete }: ProductsImportModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'import' | 'summary'>('upload');
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<RowStatus[]>([]);
  const cancelRef = useRef(false);

  // Categories load when the modal opens — used for resolving the `category`
  // column to a known catalogue entry.
  const categoriesFetcher = useFetcher<unknown>();
  useEffect(() => {
    if (!open) return;
    if (categoriesFetcher.state !== 'idle' || categoriesFetcher.data) return;
    categoriesFetcher.load('/api/import-products-categories');
  }, [open, categoriesFetcher]);
  const categories: CategoryInfo[] = useMemo(() => {
    const data = categoriesFetcher.data as { categories?: CategoryInfo[] } | undefined;
    return Array.isArray(data?.categories) ? (data!.categories as CategoryInfo[]) : [];
  }, [categoriesFetcher.data]);
  const categoriesLoading = categoriesFetcher.state !== 'idle' || categoriesFetcher.data == null;

  const resolved = useMemo(
    () => parsed.map((r) => resolveRow(r, categories)),
    [parsed, categories],
  );
  const validCount = resolved.filter((r) => r.errors.length === 0).length;
  const invalidCount = resolved.length - validCount;

  useEffect(() => {
    if (!open) {
      setStep('upload');
      setParsed([]);
      setParseError(null);
      setStatuses([]);
      cancelRef.current = false;
    }
  }, [open]);

  const importFetcher = useFetcher<{ success?: boolean; error?: string; rowIndex?: number }>();
  useFetcherToast(importFetcher.data, { skipErrorToast: true, skipSuccessToast: true });

  /**
   * Build a starter `.xlsx` for the operator. Two sheets:
   *   1. "Products" — friendly headers (so the cells the operator sees match
   *      the column-guide labels) + two sample rows. Cell comments on the
   *      `Category` column point to the Reference sheet because the
   *      open-source `xlsx` package only writes data validations under SheetJS
   *      Pro — copy/paste from the Reference is the practical fallback.
   *   2. "Reference" — full enum lists. Categories pulled from the operator's
   *      live catalogue (`/api/import-products-categories`), so the template
   *      reflects what they can actually use today.
   */
  function downloadTemplate() {
    const headers = COLUMN_SPECS.map((c) => c.label);
    const sampleA: Record<string, string | number> = {
      Name: 'Arjuna herb',
      'Base Price': 30000,
      'Cost Price': 18000,
      Category: categories[0]?.name ?? 'Wellness',
      Description: 'Herbal supplement for heart health.',
      'Gallery URLs': 'https://cdn.example.com/arjuna-1.jpg, https://cdn.example.com/arjuna-2.jpg',
    };
    const sampleB: Record<string, string | number> = {
      Name: 'Nebulizer kit',
      'Base Price': 12000,
      'Cost Price': 7250,
      Category: categories[1]?.name ?? categories[0]?.name ?? 'Healthy',
      Description: 'Asthma nebulizer kit.',
      'Gallery URLs': 'https://cdn.example.com/nebulizer.jpg',
    };
    const ws = XLSX.utils.json_to_sheet([sampleA, sampleB], { header: headers });

    // Attach cell comments on the Category header so Excel shows a tooltip
    // ("see Reference sheet"). The xlsx CE supports comments via `!c`.
    const headerCells: Record<string, string> = {
      Name: 'Required. Min 2 characters.',
      'Base Price': 'Required. Numeric — Naira. Decimals OK.',
      'Cost Price': 'Required. Numeric — Naira. Used for margin.',
      Category:
        'Optional. Must match a row in the "Reference" sheet exactly (case-insensitive). Leave blank for no category.',
      Description: 'Optional short blurb.',
      'Gallery URLs': 'Optional. Comma- or semicolon-separated http(s) URLs.',
    };
    headers.forEach((h, idx) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: idx });
      const comment = headerCells[h];
      const cell = ws[addr];
      if (cell && comment) {
        // SheetJS comments shape — `c` is an array of comment entries.
        // Using `t` for the text and `a` for the author keeps Excel happy.
        (cell as { c?: Array<{ a: string; t: string }> }).c = [{ a: 'Yannis', t: comment }];
      }
    });

    // Set a sensible column width so the template doesn't open with cramped
    // cells. Approximate "char widths" — Excel applies its own padding on top.
    ws['!cols'] = [
      { wch: 24 }, // Name
      { wch: 12 }, // Base Price
      { wch: 12 }, // Cost Price
      { wch: 18 }, // Category
      { wch: 40 }, // Description
      { wch: 50 }, // Gallery URLs
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');

    // Reference sheet — lists every valid category from the operator's
    // catalogue. Plus header rows explaining the other constraints inline.
    const referenceRows: Array<Record<string, string>> = [
      { Column: 'Name', Rule: 'Free text. Min 2 characters.' },
      { Column: 'Base Price', Rule: 'Number ≥ 0. ₦, commas, decimals all tolerated.' },
      { Column: 'Cost Price', Rule: 'Number ≥ 0.' },
      {
        Column: 'Category',
        Rule:
          categories.length > 0
            ? 'Pick one of the values listed below (case-insensitive). Leave blank for no category.'
            : 'Optional. Match a name from Admin → Categories — none configured yet.',
      },
      { Column: 'Description', Rule: 'Free text — short blurb.' },
      { Column: 'Gallery URLs', Rule: 'Public http(s) URLs, comma- or semicolon-separated.' },
      { Column: '', Rule: '' },
      { Column: 'Valid categories', Rule: '' },
      ...categories.map((c) => ({ Column: c.name, Rule: '' })),
    ];
    const refWs = XLSX.utils.json_to_sheet(referenceRows, { header: ['Column', 'Rule'] });
    refWs['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, refWs, 'Reference');

    // The header row in the data sheet uses friendly labels (`Name`, `Base
    // Price`, …) — the import parser is case- and whitespace-insensitive, so
    // operators can re-arrange, rename, or download/edit/re-upload without
    // worrying about exact snake_case spellings.
    XLSX.writeFile(wb, 'yannis-products-import-template.xlsx');
  }

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
      if (row.errors.length > 0) continue;

      setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'in_flight' } : s)));

      const formData = new FormData();
      formData.set('intent', 'importProduct');
      formData.set('rowIndex', String(i));
      formData.set('name', row.name);
      formData.set('basePrice', String(row.basePrice as number));
      formData.set('costPrice', String(row.costPrice as number));
      if (row.description) formData.set('description', row.description);
      if (row.categoryId) formData.set('categoryId', row.categoryId);
      if (row.categoryName) formData.set('category', row.categoryName);
      if (row.galleryUrls.length > 0) {
        formData.set('galleryImageUrls', JSON.stringify(row.galleryUrls));
      }

      try {
        const res = await fetch('/admin/products?index', { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data as { success?: boolean }).success === true) {
          setStatuses((prev) => prev.map((s, idx) => (idx === i ? { state: 'created' } : s)));
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
          basePriceInput: pickHeaderValue(row, 'base_price'),
          costPriceInput: pickHeaderValue(row, 'cost_price'),
          categoryInput: pickHeaderValue(row, 'category'),
          description: pickHeaderValue(row, 'description'),
          galleryUrlsInput: pickHeaderValue(row, 'gallery_urls'),
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
    statuses.length === 0
      ? 0
      : Math.round(((completedCount + failedCount) / (statuses.length - invalidStatusCount || 1)) * 100);

  return (
    <Modal open onClose={onClose} contentClassName="p-0" maxWidth="max-w-3xl">
      <div className="px-5 pt-5 pb-3 border-b border-app-border flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-app-fg">Import products from Excel</h2>
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
              New here? Grab the starter template — headers + sample rows + a Reference sheet of valid categories.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={downloadTemplate}
              disabled={categoriesLoading}
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
              <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                Expected columns
              </p>
              <p className="text-[10px] text-app-fg-muted">Header names are case-insensitive</p>
            </div>
            <ColumnsReferenceGrid categories={categories} />
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
              <span className="text-success-700 dark:text-success-400">{validCount} ready</span>
              {invalidCount > 0 ? (
                <span className="text-danger-700 dark:text-danger-400">{invalidCount} with errors</span>
              ) : null}
              {categoriesLoading ? (
                <span className="text-app-fg-muted">Loading categories…</span>
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
                  <th className="text-right py-2 pr-2">Base</th>
                  <th className="text-right py-2 pr-2">Cost</th>
                  <th className="text-left py-2 pr-2">Category</th>
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
                      <td className="py-2 pr-2 text-app-fg">
                        {row.name || <span className="text-danger-700">—</span>}
                      </td>
                      <td className="py-2 pr-2 text-right text-app-fg-muted tabular-nums">
                        {row.basePrice !== null ? `₦${row.basePrice.toLocaleString('en-NG')}` : (
                          <span className="text-danger-700">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right text-app-fg-muted tabular-nums">
                        {row.costPrice !== null ? `₦${row.costPrice.toLocaleString('en-NG')}` : (
                          <span className="text-danger-700">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-app-fg-muted">
                        {row.categoryName ?? (row.categoryInput || <span className="text-app-fg-muted/70">—</span>)}
                      </td>
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
                disabled={validCount === 0 || categoriesLoading}
              >
                Import {validCount} product{validCount === 1 ? '' : 's'}
              </Button>
            </div>
          </div>
        </>
      )}

      {step === 'import' && (
        <div className="px-5 py-6 space-y-4">
          <div>
            <p className="text-sm text-app-fg">
              Importing {completedCount + failedCount} of {statuses.length - invalidStatusCount} products…
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
                      {row.name || '—'}
                    </span>
                    <span className="ml-3 text-right shrink-0">
                      {status?.state === 'in_flight' && (
                        <span className="text-app-fg-muted">Importing…</span>
                      )}
                      {status?.state === 'pending' && <span className="text-app-fg-muted">Queued</span>}
                      {status?.state === 'invalid' && <span className="text-app-fg-muted">Skipped</span>}
                      {status?.state === 'created' && (
                        <span className="text-success-700 dark:text-success-400">✓ Created</span>
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
                ? `Import complete. ${completedCount} product${completedCount === 1 ? '' : 's'} created.`
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
                      <span className="text-app-fg">{row.name || '—'}</span>
                      <span className="text-danger-700 dark:text-danger-400 ml-2">— {status.reason}</span>
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
