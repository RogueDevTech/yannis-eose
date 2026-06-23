/**
 * UsersImportPage — thin column-config wrapper around `<ImportBulkData>`.
 *
 * The page's chrome (upload card, editable table, status icons, error-detail
 * modal, sequential per-row POST loop) lives in `~/components/ui/import-bulk-data`.
 * This file owns the *user-specific* bits:
 *   - Sheet → ParsedRow mapping
 *   - Re-validation (`resolveRow` from `users-import-shared`)
 *   - Per-cell renderers (text inputs, role select, BranchPickerDropdown, probation checkbox)
 *   - FormData shape posted to `/hr/users?index` with `intent=importUser`
 *   - Template download trigger
 *   - Column-reference grid (the chip row above the table)
 *
 * Routed from /hr/users/import (see ../routes/hr.users.import/route.tsx).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ImportBulkData,
  type ImportColumn,
  importCellInputClass,
} from '~/components/ui/import-bulk-data';
import { FormSelect } from '~/components/ui/form-select';
import { Checkbox } from '~/components/ui/checkbox';
import {
  BRANCH_ELIGIBLE_IMPORT_ROLES,
  type BranchInfo,
  type ParsedRow,
  type ResolvedRow,
  makeEmptyParsedRow,
  pickHeaderValue,
  resolveRow,
  SPREADSHEET_IMPORT_ROLE_REFERENCE,
} from './users-import-shared';
import { UsersImportColumnsReference } from './UsersImportColumnsReference';
import { downloadUsersImportTemplate } from './users-import-template';

interface UsersImportPageProps {
  branches: BranchInfo[];
}

function importSelectClass(errored: boolean): string {
  return [
    '!h-7 !rounded-md !bg-app-elevated !px-2 !pr-6 !text-xs',
    errored
      ? '!border-danger-400 focus:!border-danger-500 focus:!ring-danger-500'
      : '!border-app-border focus:!border-brand-500 focus:!ring-brand-500',
  ].join(' ');
}

/** Excel converts long phone numbers to scientific notation (e.g. 2.34802E+12).
 *  Expand back to full integer string when possible. If precision was lost
 *  (fractional part suggests truncation), keep as-is so validation catches it
 *  and the user can correct manually in the preview table. */
function normalizePhoneFromSheet(raw: string): string {
  let v = raw;
  if (/^\d+(\.\d+)?[eE]\+?\d+$/i.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      v = n.toFixed(0);
    }
  }
  if (/^234\d{10}$/.test(v)) v = `+${v}`;
  return v;
}

export function UsersImportPage({ branches }: UsersImportPageProps) {
  const columns: ImportColumn<ResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Name',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['name must be'],
        errorLabel: 'Name',
        getDisplayValue: (row) => row.name,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.name}
            onChange={(e) => patch({ name: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Email',
        headerClassName: 'min-w-[14rem]',
        errorTokens: ['email is invalid'],
        errorLabel: 'Email',
        getDisplayValue: (row) => row.email,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="email"
            value={row.email}
            onChange={(e) =>
              patch({ email: e.target.value.toLowerCase() } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Phone',
        headerClassName: 'min-w-[9rem]',
        errorTokens: ['phone must be'],
        errorLabel: 'Phone',
        getDisplayValue: (row) => row.phone,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="tel"
            value={row.phone}
            onChange={(e) => patch({ phone: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            placeholder="08031234567"
            aria-invalid={errored || undefined}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Role',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['unknown role'],
        errorLabel: 'Role',
        getDisplayValue: (row) => row.role,
        renderCell: ({ row, disabled, errored, patch }) => (
          <FormSelect
            value={row.resolvedRole ?? ''}
            onChange={(e) => patch({ role: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            controlSize="sm"
            wrapperClassName="w-full"
            className={importSelectClass(errored)}
            placeholder="—"
            options={SPREADSHEET_IMPORT_ROLE_REFERENCE.map((r) => ({
              value: r.enum,
              label: r.acceptedLabels.split(',').at(0)?.trim() || r.enum,
            }))}
          />
        ),
      },
      {
        header: 'Primary branch',
        headerClassName: 'min-w-[8rem]',
        errorTokens: ['unknown primary branch'],
        errorLabel: 'Primary branch',
        getDisplayValue: (row) => row.primaryBranchInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <BranchPickerDropdown
            mode="single"
            branches={branches}
            selectedIds={row.primaryBranchId ? [row.primaryBranchId] : []}
            excludeIds={row.additionalBranchIds}
            disabled={disabled}
            errored={errored}
            onChange={(ids) => {
              const next = ids.at(0) ?? null;
              const code = next ? branches.find((b) => b.id === next)?.code ?? '' : '';
              patch({ primaryBranchInput: code } as Partial<ResolvedRow>);
            }}
          />
        ),
      },
      {
        header: 'Additional branches',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['unknown additional branch'],
        errorLabel: 'Additional branches',
        getDisplayValue: (row) => row.additionalBranchesInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <BranchPickerDropdown
            mode="multi"
            branches={branches}
            selectedIds={row.additionalBranchIds}
            excludeIds={row.primaryBranchId ? [row.primaryBranchId] : []}
            disabled={disabled}
            errored={errored}
            onChange={(ids) => {
              // Convert back to a comma-separated CODE string so the resolver
              // re-validates from the same input shape it parses from a sheet.
              const codes = ids
                .map((id) => branches.find((b) => b.id === id)?.code)
                .filter((c): c is string => Boolean(c))
                .join(', ');
              patch({ additionalBranchesInput: codes } as Partial<ResolvedRow>);
            }}
          />
        ),
      },
      {
        header: 'Prob.',
        headerClassName: 'w-12',
        cellClassName: 'px-2 py-1.5 text-center pt-2.5',
        errorTokens: [],
        errorLabel: 'Probation',
        getDisplayValue: (row) => (row.isProbation ? 'true' : 'false'),
        hideErrorInfo: true,
        renderCell: ({ row, disabled, patch }) => (
          <Checkbox
            checked={row.isProbation}
            onChange={(e) => patch({ isProbation: e.target.checked } as Partial<ResolvedRow>)}
            disabled={disabled}
            aria-label={`Probation for ${row.name || 'row ' + row.rowIndex}`}
          />
        ),
      },
    ],
    [branches],
  );

  return (
    <ImportBulkData<ParsedRow, ResolvedRow>
      title="Import users"
      description="Upload a spreadsheet and import users."
      backHref="/hr/users"
      backLabel="← Back to users"
      resourceLabel="user"
      actionPath="/hr/users?index"
      actionIntent="importUser"
      maxRows={500}
      redirectOnComplete
      columns={columns}
      parseSheetRow={(row, sheetRowIndex) => ({
        rowIndex: sheetRowIndex,
        name: pickHeaderValue(row, 'name'),
        email: pickHeaderValue(row, 'email').toLowerCase(),
        role: pickHeaderValue(row, 'role'),
        phone: normalizePhoneFromSheet(pickHeaderValue(row, 'phone')),
        primaryBranchInput: pickHeaderValue(row, 'primary_branch'),
        additionalBranchesInput: pickHeaderValue(row, 'additional_branches'),
      })}
      resolveRow={(parsed) => resolveRow(parsed, branches)}
      makeEmptyRow={(sheetRowIndex) => makeEmptyParsedRow(sheetRowIndex)}
      buildFormData={(row) => {
        const fd = new FormData();
        fd.set('name', row.name);
        fd.set('email', row.email);
        fd.set('role', row.resolvedRole as string);
        fd.set('phone', row.phone);
        const roleNeedsBranch =
          !!row.resolvedRole && BRANCH_ELIGIBLE_IMPORT_ROLES.has(row.resolvedRole);
        if (roleNeedsBranch) {
          fd.set('primaryBranchId', row.primaryBranchId as string);
          const allBranches = [
            ...new Set([row.primaryBranchId as string, ...row.additionalBranchIds]),
          ];
          fd.set('branchIds', JSON.stringify(allBranches));
        }
        return fd;
      }}
      parseSuccessMeta={(data) =>
        (data as { requiresApproval?: boolean }).requiresApproval === true
          ? 'pending approval'
          : undefined
      }
      downloadTemplate={() => downloadUsersImportTemplate(branches)}
      referenceContent={<UsersImportColumnsReference branches={branches} />}
    />
  );
}

/**
 * Compact checkbox-dropdown branch picker used by both the primary and
 * additional-branches cells. `single` mode behaves like a radio (last click
 * wins, click again to clear); `multi` mode toggles each entry. Closes on
 * outside click. Branches in `excludeIds` are hidden so an additional-branch
 * picker can't list the row's own primary branch (and vice versa).
 */
function BranchPickerDropdown({
  mode,
  branches,
  selectedIds,
  excludeIds = [],
  disabled,
  errored,
  onChange,
}: {
  mode: 'single' | 'multi';
  branches: BranchInfo[];
  selectedIds: string[];
  excludeIds?: string[];
  disabled?: boolean;
  errored?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const visible = useMemo(
    () => branches.filter((b) => !excludeIds.includes(b.id)),
    [branches, excludeIds],
  );
  const selectedBranches = selectedIds
    .map((id) => branches.find((b) => b.id === id))
    .filter((b): b is BranchInfo => Boolean(b));

  const triggerLabel =
    selectedBranches.length === 0
      ? mode === 'single'
        ? 'Select…'
        : 'None'
      : selectedBranches.map((b) => b.code).join(', ');

  function toggle(id: string) {
    if (mode === 'single') {
      onChange((selectedIds.at(0) ?? null) === id ? [] : [id]);
      setOpen(false);
      return;
    }
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const triggerClass = [
    'w-full inline-flex items-center justify-between gap-1.5 rounded-md border bg-app-elevated px-2 py-1 text-xs text-app-fg',
    'focus:outline-none focus:ring-1 disabled:opacity-60 disabled:cursor-not-allowed',
    errored
      ? 'border-danger-400 ring-1 ring-danger-200 dark:border-danger-700 dark:ring-danger-900/40 focus:ring-danger-500'
      : 'border-app-border focus:ring-brand-500',
  ].join(' ');

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || branches.length === 0}
        className={triggerClass}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selectedBranches.length === 0 ? 'text-app-fg-muted' : ''}>
          {triggerLabel}
        </span>
        <svg
          className="w-3 h-3 shrink-0 text-app-fg-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-multiselectable={mode === 'multi'}
          className="absolute left-0 top-full z-20 mt-1 w-max min-w-full max-w-[18rem] max-h-[16rem] overflow-y-auto rounded-md border border-app-border bg-app-elevated shadow-lg"
        >
          {visible.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-app-fg-muted">No branches available</p>
          ) : (
            <ul className="py-1">
              {visible.map((b) => {
                const checked = selectedIds.includes(b.id);
                return (
                  <li key={b.id}>
                    <label className="flex items-center gap-2 px-2 py-1 text-xs text-app-fg cursor-pointer hover:bg-app-hover">
                      <input
                        type={mode === 'single' ? 'radio' : 'checkbox'}
                        checked={checked}
                        onChange={() => toggle(b.id)}
                        className="w-3.5 h-3.5"
                      />
                      <span className="font-mono text-micro text-app-fg-muted shrink-0">
                        {b.code}
                      </span>
                      <span className="truncate">{b.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
