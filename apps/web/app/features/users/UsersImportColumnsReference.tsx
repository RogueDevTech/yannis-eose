/**
 * UsersImportColumnsReference — the "Expected columns" chip grid + per-column
 * detail modal previously inlined in `UsersImportModal`. Lifted into its own
 * file so the new dedicated `/hr/users/import` page renders the same guidance
 * without duplicating the spec.
 *
 * Each column chip opens a Modal with the column's description, examples,
 * and (for `role`) the full enum / accepted-label reference table. Examples
 * for `primary_branch` / `additional_branches` are swapped to live branch
 * data once the branches list is loaded.
 */

import { useState } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import {
  type BranchInfo,
  SPREADSHEET_IMPORT_ROLE_REFERENCE,
} from './users-import-shared';

interface ColumnSpec {
  header: string;
  required: boolean;
  description: string;
  examples: string[];
  /** Full allowed values for columns like `role` (enum ↔ accepted labels). */
  referenceGuide?: ReadonlyArray<{ enum: string; acceptedLabels: string }>;
}

const COLUMN_SPECS: ColumnSpec[] = [
  {
    header: 'name',
    required: true,
    description: 'Full name. Minimum 2 characters.',
    examples: ['Jane Doe', 'Tunde Bello'],
  },
  {
    header: 'email',
    required: true,
    description: 'Login email. Must be unique across the org.',
    examples: ['jane.doe@example.com'],
  },
  {
    header: 'role',
    required: true,
    description:
      'Use the enum (left column) or any accepted label (right column) in each row. Case-insensitive; spaces vs underscores both work for enums. SUPER_ADMIN cannot be imported. Creating users with admin-class roles (e.g. ADMIN, FINANCE_OFFICER) queues SuperAdmin approval row-by-row.',
    examples: [],
    referenceGuide: SPREADSHEET_IMPORT_ROLE_REFERENCE,
  },
  {
    header: 'phone',
    required: true,
    description: 'Nigerian number, no spaces.',
    examples: ['08031234567', '+2348022223333'],
  },
  {
    header: 'primary_branch',
    required: true,
    description:
      'The branch this user defaults to. Use the branch CODE first; the NAME also works.',
    examples: ['LAG', 'Lagos HQ'],
  },
  {
    header: 'additional_branches',
    required: false,
    description:
      'Extra branches the user can switch into. Comma- or semicolon-separated codes/names. The primary is auto-included.',
    examples: ['ABJ, PHC', 'Abuja; Port Harcourt'],
  },
  {
    header: 'probation',
    required: false,
    description: 'Mark the new user as probation. Empty / blank = no.',
    examples: ['true', 'yes', 'false'],
  },
  {
    header: 'probation_until',
    required: false,
    description:
      'Probation review date when probation = true. ISO format. Defaults to 90 days from import.',
    examples: ['2026-08-08'],
  },
];

function InfoCircleIcon({ className = 'w-[18px] h-[18px]' }: { className?: string }) {
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

/** Branch columns ship with placeholder examples that swap for live branch
 *  data once the `branches.list` fetch returns. */
function resolveColumnExamples(spec: ColumnSpec, branches: BranchInfo[]): string[] {
  if (branches.length === 0) return spec.examples;
  if (spec.header === 'primary_branch') {
    const first = branches[0];
    if (!first) return spec.examples;
    return [first.code, first.name];
  }
  if (spec.header === 'additional_branches') {
    const others = branches.slice(1, 3);
    if (others.length === 0) return spec.examples;
    const codes = others.map((b) => b.code).join(', ');
    const names = others.map((b) => b.name).join('; ');
    return [codes, names].filter(Boolean);
  }
  return spec.examples;
}

/**
 * Compact columns reference — chips per header with an info button that opens
 * a per-column detail modal. Render this inside the Upload step's card so HR
 * can check the spec before / while building their sheet.
 */
export function UsersImportColumnsReference({ branches }: { branches: BranchInfo[] }) {
  const [detailColumn, setDetailColumn] = useState<ColumnSpec | null>(null);
  const detailTitleId = 'users-import-column-guide-title';

  const detailExamples = detailColumn ? resolveColumnExamples(detailColumn, branches) : [];

  return (
    <>
      {/* Compact one-row reference: each column is a single inline chip sized
          to its content, the whole row wraps only when the viewport runs out
          of horizontal space. The whole chip is the click target so HR
          doesn't have to aim at a tiny info icon. */}
      <div className="flex flex-wrap gap-1.5">
        {COLUMN_SPECS.map((c) => (
          <button
            key={c.header}
            type="button"
            aria-label={`Open column guide: ${c.header}`}
            aria-haspopup="dialog"
            onClick={() => setDetailColumn(c)}
            className="inline-flex items-center gap-1 rounded-md border border-app-border bg-app-hover/30 px-2 py-1 text-app-fg-muted hover:bg-brand-50 hover:border-brand-200 hover:text-brand-700 dark:hover:bg-brand-900/25 dark:hover:border-brand-700 dark:hover:text-brand-300 transition-colors"
          >
            <code className="font-mono text-[11px] font-medium text-app-fg" title={c.header}>
              {c.header}
              {c.required ? (
                <span className="ml-0.5 text-danger-500" aria-hidden="true">*</span>
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
          <div className="px-5 pt-5 pb-4 border-b border-app-border flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <h3 id={detailTitleId} className="text-base font-semibold text-app-fg leading-snug">
                <span className="text-app-fg-muted font-normal">Spreadsheet column · </span>
                <code className="font-mono text-[15px] font-semibold text-app-fg">
                  {detailColumn.header}
                </code>
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
        ) : null}
        {detailColumn ? (
          <div
            className={
              detailColumn.referenceGuide?.length
                ? 'px-5 py-4 space-y-4 max-h-[min(75dvh,36rem)] overflow-y-auto'
                : 'px-5 py-4 space-y-4 max-h-[min(60dvh,22rem)] overflow-y-auto'
            }
          >
            <p className="text-sm text-app-fg leading-relaxed">{detailColumn.description}</p>
            {detailColumn.referenceGuide && detailColumn.referenceGuide.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                  Full list — spreadsheet cell may use either column
                </p>
                <ul className="flex flex-col gap-2">
                  {detailColumn.referenceGuide.map((row) => (
                    <li
                      key={row.enum}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-app-border bg-app-hover/40 px-2.5 py-2"
                    >
                      <code className="font-mono text-xs font-semibold text-app-fg shrink-0">
                        {row.enum}
                      </code>
                      <span className="text-app-fg-muted text-xs shrink-0">→</span>
                      <span className="text-xs text-app-fg min-w-0">{row.acceptedLabels}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {detailExamples.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-app-fg-muted">
                  Example values
                  {(detailColumn.header === 'primary_branch' ||
                    detailColumn.header === 'additional_branches') &&
                  branches.length > 0 ? (
                    <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-app-fg-muted">
                      — pulled from your branches
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
        ) : null}
      </Modal>
    </>
  );
}
