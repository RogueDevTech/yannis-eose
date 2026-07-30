import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { RoleBadge } from '~/components/ui/role-badge';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { PageNotification } from '~/components/ui/page-notification';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import { CONTROL_HEIGHT_CLASS } from '~/components/ui/_control-heights';
import type { BranchOption, ViewerInfo, PayrollDepartment } from './types';
import {
  ALL_DEPARTMENTS,
  ALL_DEPARTMENTS_SENTINEL,
  ADMIN_ROLES,
  DEPT_LABEL,
  DEPT_OWNER_ROLE,
} from './payroll-constants';

const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const INCLUDE_OPTIONS = [
  { value: 'staff', label: 'Staff only' },
  { value: 'staff_and_contractors', label: 'Staff + agency contractors' },
];

interface PreviewRow {
  staffId: string;
  staffName: string;
  staffRole: string;
  baseSalary: number;
  performanceBonus: number;
  addOnsTotal: number;
  deductionsTotal: number;
  totalPayout: number;
}

interface PayrollPreview {
  staffCount: number;
  totalAmount: number;
  rows: PreviewRow[];
}

export interface PayrollGenerateLoaderData {
  branches: BranchOption[];
  viewer: ViewerInfo;
}

/** Searchable multi-select with checkboxes for combining branches into one batch. */
function BranchMultiSelect({
  id,
  label,
  options,
  value,
  onChange,
  required,
}: {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const triggerText =
    selectedLabels.length === 0
      ? 'Select branches…'
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : selectedLabels.length === options.length && options.length > 1
          ? `All branches (${selectedLabels.length})`
          : `${selectedLabels.length} branches`;

  const toggle = (idValue: string) => {
    if (value.includes(idValue)) onChange(value.filter((v) => v !== idValue));
    else onChange([...value, idValue]);
  };

  const allSelected = options.length > 0 && options.every((o) => value.includes(o.value));

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="block text-sm font-medium text-app-fg mb-1">
        {label}
        {required ? <span className="text-danger-500 ml-0.5">*</span> : null}
      </label>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          CONTROL_HEIGHT_CLASS,
          'w-full flex items-center justify-between gap-2 rounded-lg border border-app-border bg-app-canvas px-3 text-sm text-left',
          'hover:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
          selectedLabels.length === 0 ? 'text-app-fg-muted' : 'text-app-fg',
        ].join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{triggerText}</span>
        <svg className="w-3.5 h-3.5 shrink-0 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-app-border bg-app-elevated shadow-lg overflow-hidden">
          <div className="p-2 border-b border-app-border">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search branches…"
              className="w-full h-8 rounded-md border border-app-border bg-app-canvas px-2 text-sm text-app-fg placeholder:text-app-fg-muted focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          {options.length > 1 ? (
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-brand-600 dark:text-brand-400 hover:bg-app-hover border-b border-app-border"
              onClick={() => {
                onChange(allSelected ? [] : options.map((o) => o.value));
              }}
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          ) : null}
          <ul className="max-h-56 overflow-y-auto py-1" role="listbox" aria-multiselectable>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-app-fg-muted">No branches match.</li>
            ) : (
              filtered.map((opt) => {
                const checked = value.includes(opt.value);
                return (
                  <li key={opt.value}>
                    <label className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-app-fg cursor-pointer hover:bg-app-hover">
                      <Checkbox
                        checked={checked}
                        onChange={() => toggle(opt.value)}
                        aria-label={opt.label}
                      />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PayrollGeneratePage({ branches, viewer }: PayrollGenerateLoaderData) {
  const fetcher = useFetcher();
  const previewFetcher = useFetcher<{ success?: boolean; preview?: PayrollPreview | null; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const previewSurface = useFetcherActionSurface(previewFetcher);

  const firstNow = new Date();
  const [monthMm, setMonthMm] = useState(() => String(firstNow.getMonth() + 1).padStart(2, '0'));
  const [yearYyyy, setYearYyyy] = useState(() => String(firstNow.getFullYear()));
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [deptSel, setDeptSel] = useState('');
  const [includeMode, setIncludeMode] = useState<'staff' | 'staff_and_contractors'>('staff');
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [runLabel, setRunLabel] = useState('');
  const [dismissedPreviewError, setDismissedPreviewError] = useState(false);
  const [dismissedGenerateError, setDismissedGenerateError] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);

  const includeContractors = includeMode === 'staff_and_contractors';

  const generatableDepartments: PayrollDepartment[] = useMemo(() => {
    if (ADMIN_ROLES.has(viewer.role)) return ALL_DEPARTMENTS;
    if (viewer.prepareDepartments?.length) return viewer.prepareDepartments;
    if (viewer.role === 'HR_MANAGER') return ['LOGISTICS', 'HR'];
    const matching = ALL_DEPARTMENTS.find((d) => DEPT_OWNER_ROLE[d] === viewer.role);
    return matching ? [matching] : [];
  }, [viewer.role, viewer.prepareDepartments]);

  const generatableBranches: BranchOption[] = useMemo(() => {
    if (ADMIN_ROLES.has(viewer.role)) return branches;
    if (viewer.prepareBranchIds?.length) {
      return branches.filter((b) => viewer.prepareBranchIds?.includes(b.id));
    }
    const own = branches.find((b) => b.id === viewer.currentBranchId);
    return own ? [own] : [];
  }, [viewer, branches]);

  useEffect(() => {
    if (branchIds.length === 0 && generatableBranches[0]) {
      setBranchIds([generatableBranches[0].id]);
    }
  }, [branchIds.length, generatableBranches]);

  useEffect(() => {
    const first = generatableDepartments[0];
    if (first && !generatableDepartments.includes(deptSel as PayrollDepartment) && deptSel !== ALL_DEPARTMENTS_SENTINEL) {
      setDeptSel(first);
    }
  }, [deptSel, generatableDepartments]);

  const branchOptions = useMemo(
    () => generatableBranches.map((b) => ({ value: b.id, label: b.name })),
    [generatableBranches],
  );

  const deptOptions = useMemo(() => {
    const base = generatableDepartments.map((d) => ({ value: d, label: DEPT_LABEL[d] }));
    if (generatableDepartments.length > 1) {
      return [{ value: ALL_DEPARTMENTS_SENTINEL, label: 'All departments' }, ...base];
    }
    return base;
  }, [generatableDepartments]);

  const isBulkDept = deptSel === ALL_DEPARTMENTS_SENTINEL;
  const resolvedDeptCount = isBulkDept ? generatableDepartments.length : deptSel ? 1 : 0;
  const combinedBatch = branchIds.length > 1;
  /** One batch per department when combining branches; otherwise one slot per selection. */
  const slotCount = isBulkDept ? resolvedDeptCount : deptSel ? 1 : 0;

  const periodMonth = `${yearYyyy}-${monthMm}-01`;
  const showPreview = !isBulkDept && branchIds.length >= 1 && !!deptSel;

  useEffect(() => {
    if (previewFetcher.data && typeof previewFetcher.data === 'object') {
      const d = previewFetcher.data as { preview?: PayrollPreview };
      if (d.preview) setPreview(d.preview);
    }
  }, [previewFetcher.data]);

  useEffect(() => {
    if (previewFetcher.data && (previewFetcher.data as { error?: string }).error) {
      setDismissedPreviewError(false);
    }
  }, [previewFetcher.data]);

  useEffect(() => {
    const err = (fetcher.data as { error?: string } | undefined)?.error;
    if (err) setDismissedGenerateError(false);
  }, [fetcher.data]);

  const previewError = previewSurface.errorMatchingIntent('previewBatch');
  const previewActionError =
    !dismissedPreviewError && (previewFetcher.data as { error?: string } | undefined)?.error;
  const generateActionError =
    !dismissedGenerateError && (fetcher.data as { error?: string } | undefined)?.error;

  const formatMonthLabel = useMemo(() => {
    const mm = Number(monthMm);
    const y = Number(yearYyyy);
    const d = new Date(Date.UTC(y, mm - 1, 1));
    return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [monthMm, yearYyyy]);

  const previewColumns: CompactTableColumn<PreviewRow>[] = [
    {
      key: 'staff',
      header: 'Staff',
      render: (r) => (
        <div>
          <p className="font-medium text-app-fg">{r.staffName}</p>
          <RoleBadge role={r.staffRole} size="sm" />
        </div>
      ),
    },
    {
      key: 'base',
      header: 'Base',
      align: 'right',
      nowrap: true,
      render: (r) => <NairaPrice amount={r.baseSalary} />,
    },
    {
      key: 'bonus',
      header: 'Bonus',
      align: 'right',
      nowrap: true,
      cellClassName: 'text-success-600 dark:text-success-400',
      render: (r) => <NairaPrice amount={r.performanceBonus} />,
    },
    {
      key: 'addons',
      header: 'Add-ons',
      align: 'right',
      nowrap: true,
      render: (r) => <NairaPrice amount={r.addOnsTotal} />,
    },
    {
      key: 'deductions',
      header: 'Deductions',
      align: 'right',
      nowrap: true,
      cellClassName: 'text-danger-600 dark:text-danger-400',
      render: (r) =>
        Number(r.deductionsTotal) > 0 ? (
          <>
            −<NairaPrice amount={Number(r.deductionsTotal)} />
          </>
        ) : (
          'N/A'
        ),
    },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      nowrap: true,
      render: (r) => (
        <span className="font-semibold">
          <NairaPrice amount={r.totalPayout} />
        </span>
      ),
    },
  ];

  const yearOptions = useMemo(() => {
    const cy = new Date().getFullYear();
    return [-2, -1, 0, 1, 2].map((o) => ({
      value: String(cy + o),
      label: String(cy + o),
    }));
  }, []);

  const generating =
    fetcher.state === 'submitting' &&
    (fetcher.formData?.get('intent') === 'generateBatch' ||
      fetcher.formData?.get('intent') === 'generateBatchesBulk');
  const canGenerate = branchIds.length > 0 && !!deptSel && !generating;
  const homeBranchId = branchIds[0] ?? '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generate payroll"
        description="Pick month and scope, then generate a draft batch."
        backTo="/hr/payroll"
      />

      {(previewError ?? previewActionError) && (
        <PageNotification
          variant="error"
          title="Preview failed"
          message={
            typeof previewError === 'string'
              ? previewError
              : typeof previewActionError === 'string'
                ? previewActionError
                : ''
          }
          onDismiss={() => setDismissedPreviewError(true)}
        />
      )}

      {(surface.errorMatchingIntent(['generateBatch', 'generateBatchesBulk']) ?? generateActionError) && (
        <PageNotification
          variant="error"
          title="Could not generate"
          message={(() => {
            const e = surface.errorMatchingIntent(['generateBatch', 'generateBatchesBulk']);
            return typeof e === 'string'
              ? e
              : typeof generateActionError === 'string'
                ? generateActionError
                : '';
          })()}
          onDismiss={() => setDismissedGenerateError(true)}
        />
      )}

      <div className="card space-y-5">
        <fetcher.Form method="post" id="payroll-generate-form" className="space-y-5">
          {isBulkDept ? (
            <input type="hidden" name="intent" value="generateBatchesBulk" />
          ) : (
            <input type="hidden" name="intent" value="generateBatch" />
          )}
          <input type="hidden" name="periodMonth" value={periodMonth} />
          {includeContractors ? <input type="hidden" name="includeContractors" value="on" /> : null}
          {runLabel ? <input type="hidden" name="runLabel" value={runLabel} /> : null}
          {combinedBatch || isBulkDept ? (
            <input type="hidden" name="combineBranches" value="on" />
          ) : null}

          {branchIds.map((id) => (
            <input key={id} type="hidden" name="branchIds" value={id} />
          ))}
          {homeBranchId ? <input type="hidden" name="branchId" value={homeBranchId} /> : null}

          {isBulkDept
            ? generatableDepartments.map((d) => (
                <input key={d} type="hidden" name="departments" value={d} />
              ))
            : deptSel && deptSel !== ALL_DEPARTMENTS_SENTINEL ? (
                <input type="hidden" name="department" value={deptSel} />
              ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
            <div className="sm:col-span-1 xl:col-span-2">
              <BranchMultiSelect
                id="payroll-gen-branch"
                label="Branch"
                required
                options={branchOptions}
                value={branchIds}
                onChange={(next) => {
                  setBranchIds(next);
                  setPreview(null);
                }}
              />
            </div>
            <FormSelect
              label="Department"
              name="_departmentUi"
              required
              options={deptOptions}
              value={deptSel}
              onChange={(e) => {
                setDeptSel(e.target.value);
                setPreview(null);
              }}
            />
            <FormSelect
              label="Month"
              name="_monthUi"
              required
              options={MONTH_OPTIONS}
              value={monthMm}
              onChange={(e) => {
                setMonthMm(e.target.value);
                setPreview(null);
              }}
            />
            <FormSelect
              label="Year"
              name="_yearUi"
              required
              options={yearOptions}
              value={yearYyyy}
              onChange={(e) => {
                setYearYyyy(e.target.value);
                setPreview(null);
              }}
            />
            <Button
              type="button"
              variant="primary"
              disabled={!canGenerate}
              loading={generating}
              loadingText="…"
              className="h-10 md:h-9 w-full mt-2 sm:mt-0"
              onClick={() => setShowGenerateConfirm(true)}
            >
              Generate
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <FormSelect
              label="Include"
              name="_includeUi"
              options={INCLUDE_OPTIONS}
              value={includeMode}
              onChange={(e) =>
                setIncludeMode(e.target.value === 'staff_and_contractors' ? 'staff_and_contractors' : 'staff')
              }
            />
            <TextInput
              label="Run label (optional)"
              name="_runLabelUi"
              value={runLabel}
              onChange={(e) => setRunLabel(e.target.value)}
              placeholder="e.g. April 2026 CS run"
            />
          </div>

          {(combinedBatch || isBulkDept) && (
            <p className="text-xs text-app-fg-muted rounded-md border border-app-border bg-app-hover px-3 py-2">
              {combinedBatch ? (
                <>
                  Selected branches combine into{' '}
                  <span className="font-medium text-app-fg">
                    {slotCount} batch{slotCount === 1 ? '' : 'es'}
                  </span>{' '}
                  for <span className="font-medium text-app-fg">{formatMonthLabel}</span>
                  {isBulkDept ? ' (one per department)' : ''}.
                </>
              ) : (
                <>
                  Will create up to <span className="font-medium text-app-fg">{slotCount}</span> batch
                  {slotCount === 1 ? '' : 'es'} for{' '}
                  <span className="font-medium text-app-fg">{formatMonthLabel}</span>. Existing batches
                  for the same scope are skipped.
                </>
              )}
            </p>
          )}

          {showPreview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={branchIds.length === 0 || !deptSel || previewFetcher.state === 'submitting'}
                  loading={previewFetcher.state === 'submitting'}
                  loadingText="Previewing…"
                  onClick={() => {
                    const fd = new FormData();
                    fd.set('intent', 'previewBatch');
                    fd.set('branchId', homeBranchId);
                    fd.set('department', deptSel);
                    fd.set('periodMonth', periodMonth.slice(0, 10));
                    for (const id of branchIds) fd.append('branchIds', id);
                    previewFetcher.submit(fd, { method: 'post', action: '/hr/payroll/generate' });
                  }}
                >
                  Preview roster
                </Button>
                {preview ? (
                  <p className="text-xs text-app-fg-muted">
                    Staff:{' '}
                    <span className="font-medium text-app-fg">{preview.staffCount}</span>
                    {' · '}
                    Expected:{' '}
                    <span className="font-medium text-app-fg">
                      <NairaPrice amount={preview.totalAmount} />
                    </span>
                  </p>
                ) : null}
              </div>
              <ModalFetcherInlineError message={previewSurface.errorMatchingIntent('previewBatch')} />
              {preview ? (
                preview.rows.length > 0 ? (
                  <CompactTable
                    withCard={false}
                    columns={previewColumns}
                    rows={preview.rows}
                    rowKey={(r) => r.staffId}
                    renderMobileCard={(r) => (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-app-fg leading-snug truncate">{r.staffName}</p>
                          <span className="shrink-0 text-sm font-semibold text-app-fg tabular-nums">
                            <NairaPrice amount={r.totalPayout} />
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <RoleBadge role={r.staffRole} size="sm" />
                        </div>
                        <p className="text-xs text-app-fg-muted tabular-nums">
                          Base <NairaPrice amount={r.baseSalary} />
                          {r.performanceBonus > 0 ? (
                            <>
                              {' \u00b7 '}
                              <span className="text-success-600 dark:text-success-400">
                                Bonus <NairaPrice amount={r.performanceBonus} />
                              </span>
                            </>
                          ) : null}
                          {r.deductionsTotal > 0 ? (
                            <>
                              {' \u00b7 '}
                              <span className="text-danger-600 dark:text-danger-400">
                                −<NairaPrice amount={r.deductionsTotal} />
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                    )}
                  />
                ) : (
                  <p className="text-xs text-app-fg-muted">
                    No staff in scope for the selected branches and department.
                  </p>
                )
              ) : null}
            </div>
          )}
        </fetcher.Form>
      </div>

      <ConfirmActionModal
        open={showGenerateConfirm}
        onClose={() => setShowGenerateConfirm(false)}
        title="Generate payroll batch"
        description={
          <>
            Create payroll batch{slotCount > 1 ? 'es' : ''} for{' '}
            <strong>{formatMonthLabel}</strong>
            {combinedBatch
              ? ` combining ${branchIds.length} branches`
              : ''}
            {isBulkDept ? ` across ${resolvedDeptCount} departments` : ''}
            ? Existing non-draft batches for the same home branch and department are skipped.
          </>
        }
        details={
          <ul className="list-disc pl-4 space-y-1 text-sm">
            <li>Draft payouts are created from current rules and delivered orders</li>
            <li>You can review and adjust before submitting to HR</li>
            {includeContractors ? <li>Agency contractors will be included in this run</li> : null}
            {combinedBatch ? (
              <li>Staff from all selected branches go into one batch per department</li>
            ) : null}
          </ul>
        }
        confirmLabel="Generate"
        variant="warning"
        loading={generating}
        onConfirm={() => {
          const form = document.getElementById('payroll-generate-form') as HTMLFormElement | null;
          form?.requestSubmit();
          setShowGenerateConfirm(false);
        }}
      />
    </div>
  );
}
