/**
 * ProductsImportColumnsReference — chip grid + per-column detail modal for
 * the Products bulk-import page. Same visual model as
 * `UsersImportColumnsReference`: each column is a clickable chip that opens a
 * Modal with the column's description, accepted header aliases, and example
 * values. Examples for `category` are swapped to live catalogue data once
 * the parent loader's category fetch returns.
 */

import { useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import type { CategoryInfo } from './products-import-shared';

interface ColumnSpec {
  /** Canonical lookup key — snake_case. The parser is case-insensitive and
   *  treats spaces / dashes as underscores so any spelling resolves here. */
  header: string;
  /** Friendly display label shown in the chip grid + modal. */
  label: string;
  /** Other forms the parser also accepts. Listing them in the guide reassures
   *  operators they don't have to type `gallery_urls` exactly. */
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
      'Public product image URLs, comma- or semicolon-separated. After import the server downloads each image and rehosts it on our CDN — so links survive the supplier site going down. The product is created instantly; the rehost runs in the background and replaces the URLs within a few seconds.',
    examples: [
      'https://cdn.example.com/arjuna-1.jpg, https://cdn.example.com/arjuna-2.jpg',
      'https://cdn.example.com/nebulizer.jpg',
    ],
  },
];

function InfoCircleIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      className={className}
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

function resolveColumnExamples(spec: ColumnSpec, categories: CategoryInfo[]): string[] {
  if (categories.length === 0) return spec.examples;
  if (spec.header === 'category') {
    const sample = categories.slice(0, 2).map((c) => c.name);
    if (sample.length === 0) return spec.examples;
    return sample;
  }
  return spec.examples;
}

export function ProductsImportColumnsReference({
  categories,
}: {
  categories: CategoryInfo[];
}) {
  const [detailColumn, setDetailColumn] = useState<ColumnSpec | null>(null);
  const detailTitleId = 'products-import-column-guide-title';
  const detailExamples = detailColumn ? resolveColumnExamples(detailColumn, categories) : [];

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {COLUMN_SPECS.map((c) => (
          <button
            key={c.header}
            type="button"
            aria-label={`Open column guide: ${c.label}`}
            aria-haspopup="dialog"
            onClick={() => setDetailColumn(c)}
            className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-hover/30 px-2 py-1 text-app-fg-muted hover:bg-brand-50 hover:border-brand-200 hover:text-brand-700 dark:hover:bg-brand-900/25 dark:hover:border-brand-700 dark:hover:text-brand-300 transition-colors"
          >
            <code className="font-mono text-[11px] font-medium text-app-fg" title={c.label}>
              {c.label}
              {c.required ? (
                <span className="ml-0.5 text-danger-500" aria-hidden="true">
                  *
                </span>
              ) : null}
              {c.required ? <span className="sr-only"> (required)</span> : null}
            </code>
            <InfoCircleIcon className="w-3.5 h-3.5 opacity-60" />
          </button>
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
                <h3
                  id={detailTitleId}
                  className="text-base font-semibold text-app-fg leading-snug"
                >
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
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 max-h-[min(60dvh,28rem)] overflow-y-auto">
              <p className="text-sm text-app-fg leading-relaxed">{detailColumn.description}</p>
              <div className="rounded-md border border-app-border bg-app-hover/40 px-3 py-2 space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-app-fg-muted">
                  Header names — case &amp; spacing don&apos;t matter
                </p>
                <p className="text-xs text-app-fg-muted">
                  The matcher lowercases the column header and treats spaces or dashes as
                  underscores. Any of these (and more) all work for this column:
                </p>
                <ul className="flex flex-wrap gap-1">
                  {[detailColumn.label, detailColumn.header, ...detailColumn.alsoAccepts].map(
                    (alias) => (
                      <li key={alias}>
                        <code className="font-mono text-[11px] rounded bg-app-elevated border border-app-border px-1.5 py-0.5 text-app-fg">
                          {alias}
                        </code>
                      </li>
                    ),
                  )}
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
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => setDetailColumn(null)}
                >
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
