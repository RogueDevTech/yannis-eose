/**
 * ProvidersImportColumnsReference — chip grid + per-column detail modal for
 * the Providers (3PL) bulk-import page. Same visual model as the users +
 * products import column references.
 */

import { useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';

interface ColumnSpec {
  header: string;
  label: string;
  alsoAccepts: string[];
  required: boolean;
  description: string;
  examples: string[];
}

const COLUMN_SPECS: ColumnSpec[] = [
  {
    header: 'name',
    label: 'Name',
    alsoAccepts: ['Name', 'NAME', 'Company', 'Provider'],
    required: true,
    description:
      'Logistics company name. 2–200 characters. Used as the display name on dispatch UIs and remittance reports.',
    examples: ['GIG Logistics', 'Konga Express'],
  },
  {
    header: 'contact_info',
    label: 'Contact Info',
    alsoAccepts: ['Contact Info', 'Contact', 'CONTACT', 'Contact-Info'],
    required: true,
    description:
      'Phone, email, or both — used by Operations to reach the company. 1–500 characters. Combine with " · " or "/".',
    examples: ['dispatch@giglogistics.com · +2348031234567', 'partners@konga.com'],
  },
  {
    header: 'coverage_area',
    label: 'Coverage Area',
    alsoAccepts: ['Coverage Area', 'Coverage', 'COVERAGE'],
    required: true,
    description:
      'States or regions the company services. 1–500 characters. Free text — comma-separate states or use "Nigeria-wide".',
    examples: ['Lagos, Ogun, Oyo', 'Nigeria-wide'],
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

export function ProvidersImportColumnsReference() {
  const [detailColumn, setDetailColumn] = useState<ColumnSpec | null>(null);
  const detailTitleId = 'providers-import-column-guide-title';

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
            <code className="font-mono text-mini font-medium text-app-fg" title={c.label}>
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
            <div className="px-5 py-4 space-y-4 max-h-[min(60dvh,28rem)] overflow-y-auto">
              <p className="text-sm text-app-fg leading-relaxed">{detailColumn.description}</p>
              <div className="rounded-md border border-app-border bg-app-hover/40 px-3 py-2 space-y-1.5">
                <p className="text-micro font-semibold uppercase tracking-wider text-app-fg-muted">
                  Header names — case &amp; spacing don&apos;t matter
                </p>
                <ul className="flex flex-wrap gap-1">
                  {[detailColumn.label, detailColumn.header, ...detailColumn.alsoAccepts].map(
                    (alias) => (
                      <li key={alias}>
                        <code className="font-mono text-mini rounded bg-app-elevated border border-app-border px-1.5 py-0.5 text-app-fg">
                          {alias}
                        </code>
                      </li>
                    ),
                  )}
                </ul>
              </div>
              {detailColumn.examples.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-mini font-semibold uppercase tracking-wider text-app-fg-muted">
                    Example values
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {detailColumn.examples.map((ex, i) => (
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
