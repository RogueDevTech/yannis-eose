/**
 * LocationsImportColumnsReference — chip grid + per-column detail modal for
 * the Locations bulk-import page. Same visual model as the providers/users/
 * products references. Provider examples auto-swap for live provider names
 * once the parent loader's providers fetch returns.
 */

import { useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import type { ProviderInfo } from './locations-import-shared';

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
    header: 'provider',
    label: 'Provider',
    alsoAccepts: ['Provider', 'Company', 'Provider Name', 'PROVIDER'],
    required: true,
    description:
      'Which 3PL company owns this location. Case-insensitive name match against the Companies list, or paste a provider UUID. Unknown values fail validation — create the company first under Logistics → Companies.',
    examples: ['GIG Logistics', 'Konga Express'],
  },
  {
    header: 'name',
    label: 'Name',
    alsoAccepts: ['Name', 'Location', 'Hub', 'NAME'],
    required: true,
    description:
      'Short label for the location. 2–200 characters. Surfaces in dispatch dropdowns and reports.',
    examples: ['Lekki hub', 'Abuja CBD', 'Ikeja warehouse'],
  },
  {
    header: 'address',
    label: 'Address',
    alsoAccepts: ['Address', 'Street Address', 'ADDRESS'],
    required: true,
    description: 'Full street address. 5–500 characters.',
    examples: ['24 Admiralty Way, Lekki Phase 1, Lagos', 'Plot 14, Wuse II, Abuja'],
  },
  {
    header: 'coordinates',
    label: 'Coordinates',
    alsoAccepts: ['Coordinates', 'GPS', 'Lat/Lng', 'Coords'],
    required: false,
    description:
      'Optional "lat,lng" pair (max 100 characters). Powers route-optimisation features for riders.',
    examples: ['6.4426,3.4525', '9.0579,7.4951'],
  },
  {
    header: 'whatsapp_group_link',
    label: 'WhatsApp Group Link',
    alsoAccepts: ['WhatsApp Group Link', 'Whatsapp', 'WA Group', 'whatsapp_group'],
    required: false,
    description:
      'Optional WhatsApp group invite for the location’s riders. Must be a chat.whatsapp.com or wa.me URL — other formats are rejected.',
    examples: ['https://chat.whatsapp.com/ABCD1234567890', 'https://wa.me/2348031234567'],
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

function resolveColumnExamples(spec: ColumnSpec, providers: ProviderInfo[]): string[] {
  if (providers.length === 0) return spec.examples;
  if (spec.header === 'provider') {
    const sample = providers.slice(0, 2).map((p) => p.name);
    if (sample.length === 0) return spec.examples;
    return sample;
  }
  return spec.examples;
}

export function LocationsImportColumnsReference({
  providers,
}: {
  providers: ProviderInfo[];
}) {
  const [detailColumn, setDetailColumn] = useState<ColumnSpec | null>(null);
  const detailTitleId = 'locations-import-column-guide-title';
  const detailExamples = detailColumn ? resolveColumnExamples(detailColumn, providers) : [];

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
              {detailExamples.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-mini font-semibold uppercase tracking-wider text-app-fg-muted">
                    Example values
                    {detailColumn.header === 'provider' && providers.length > 0 ? (
                      <span className="ml-1.5 text-micro font-normal normal-case tracking-normal text-app-fg-muted">
                        — pulled from your companies
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
