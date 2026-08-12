import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
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
import { invalidateCachedLoader } from '~/lib/loader-cache';
import type { BranchOption, ViewerInfo, PayrollDepartment } from './types';
import {
  ALL_DEPARTMENTS,
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

/** Pseudo-department options: scope choices, mutually exclusive with real departments. */
const CONTRACTORS_SENTINEL = '__CONTRACTORS__';
const ALL_SCOPE_SENTINEL = '__ALL__';
/** Branch-picker pseudo-option: sweep staff with no primary branch into the run. */
const NO_BRANCH_SENTINEL = '__NO_BRANCH__';

interface PreviewRow {
  staffId: string;
  staffName: string;
  staffRole: string;
  baseSalary: number;
  performanceBonus: number;
  addOnsTotal: number;
  deductionsTotal: number;
  totalPayout: number;
  grossPay: number;
  payeTax: number;
}

interface PayrollPreview {
  staffCount: number;
  totalAmount: number;
  rows: PreviewRow[];
  /** Staff with no resolvable salary config (would generate at ₦0 base). */
  missingConfigStaff?: Array<{ staffId: string; staffName: string; staffRole: string }>;
}

/** One underpaid staff member surfaced by a supplementary (Track A) preview. */
interface SupplementaryRow {
  staffId: string;
  name: string;
  role: string;
  expectedGross: number;
  paidGross: number;
  grossBalance: number;
  correctPaye: number;
  paidPaye: number;
  remainingPaye: number;
  correctStatutory: number;
  paidStatutory: number;
  remainingStatutory: number;
  netPayable: number;
}

interface SupplementaryPreview {
  periodMonth: string;
  affected: SupplementaryRow[];
  totalNetPayable: number;
  totalRemainingPaye: number;
}

/** Grand-total preview across a whole selection (fan-out / contractors / all). */
interface SelectionPreview {
  staffCount: number;
  contractorCount: number;
  totalAmount: number;
  batchCount: number;
  /** Per-person roster for the whole selection (all branches × departments). */
  rows?: SelectionRow[];
}

/** One person in the multi-scope roster; carries branch/department context. */
interface SelectionRow extends PreviewRow {
  branchName?: string | null;
  department?: string | null;
}

export interface PayrollGenerateLoaderData {
  branches: BranchOption[];
  viewer: ViewerInfo;
  /** Active payroll-role staff with no primary branch (warned about, opt-in sweep). */
  unassignedStaffCount?: number;
}

/**
 * Searchable multi-select with checkboxes. Used for both branches and departments.
 * `noun` drives placeholder / "All {noun}" / empty-search copy; `selectAll` toggles
 * the Select all / Clear all control (departments hide it since pseudo-options exist).
 */
function CheckboxMultiSelect({
  id,
  label,
  options,
  value,
  onChange,
  required,
  noun = 'branches',
  selectAll = true,
}: {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  required?: boolean;
  noun?: string;
  selectAll?: boolean;
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
      ? `Select ${noun}…`
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : selectedLabels.length === options.length && options.length > 1
          ? `All ${noun} (${selectedLabels.length})`
          : `${selectedLabels.length} ${noun}`;

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
              placeholder={`Search ${noun}…`}
              className="w-full h-8 rounded-md border border-app-border bg-app-canvas px-2 text-sm text-app-fg placeholder:text-app-fg-muted focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          {selectAll && options.length > 1 ? (
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
              <li className="px-3 py-2 text-xs text-app-fg-muted">No {noun} match.</li>
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

export function PayrollGeneratePage({ branches, viewer, unassignedStaffCount = 0 }: PayrollGenerateLoaderData) {
  const fetcher = useFetcher();
  const previewFetcher = useFetcher<{ success?: boolean; preview?: PayrollPreview | null; error?: string }>();
  const selectionFetcher = useFetcher<{ success?: boolean; selectionPreview?: SelectionPreview | null; error?: string }>();
  const supplementaryFetcher = useFetcher<{ success?: boolean; supplementaryPreview?: SupplementaryPreview | null; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const previewSurface = useFetcherActionSurface(previewFetcher);
  const selectionSurface = useFetcherActionSurface(selectionFetcher);
  const supplementarySurface = useFetcherActionSurface(supplementaryFetcher);

  /** Standard = normal draft run. Supplementary = complete an underpaid settled month. */
  const [mode, setMode] = useState<'STANDARD' | 'SUPPLEMENTARY'>('STANDARD');
  const [supplementaryPreview, setSupplementaryPreview] = useState<SupplementaryPreview | null>(null);
  const [supplementarySelectedIds, setSupplementarySelectedIds] = useState<Set<string>>(new Set());

  const firstNow = new Date();
  const [monthMm, setMonthMm] = useState(() => String(firstNow.getMonth() + 1).padStart(2, '0'));
  const [yearYyyy, setYearYyyy] = useState(() => String(firstNow.getFullYear()));
  // branchSel may contain real branch ids plus the NO_BRANCH_SENTINEL pseudo-option.
  const [branchSel, setBranchSel] = useState<string[]>([]);
  const [deptSel, setDeptSel] = useState<string[]>([]);
  // Real branch ids (sentinel stripped) and the no-branch opt-in derived from it.
  const includeNullBranch = branchSel.includes(NO_BRANCH_SENTINEL);
  const branchIds = useMemo(() => branchSel.filter((v) => v !== NO_BRANCH_SENTINEL), [branchSel]);
  const setBranchIds = (next: string[]) => setBranchSel(next);
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [selectionPreview, setSelectionPreview] = useState<SelectionPreview | null>(null);
  const [runLabel, setRunLabel] = useState('');
  const [dismissedPreviewError, setDismissedPreviewError] = useState(false);
  const [dismissedGenerateError, setDismissedGenerateError] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);

  const isAdminLevel = ADMIN_ROLES.has(viewer.role);
  /** Admin / HR (or HR with a null home branch) can run the "All" scope. */
  const canRunAllScope = isAdminLevel || viewer.role === 'HR_MANAGER';
  /** Branch-scoped: pinned to a home branch and not admin. Their branch is implicit. */
  const isBranchScoped = viewer.currentBranchId != null && !isAdminLevel;

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

  // Default: every option checked (org-wide users only; branch-scoped users submit
  // no branchIds, their branch is implicit server-side). Include the "no branch"
  // option too so unassigned org-wide staff are always swept in — checking it when
  // no such staff exist is a harmless no-op server-side.
  useEffect(() => {
    if (isBranchScoped) return;
    if (branchSel.length === 0 && generatableBranches.length > 0) {
      const seed = generatableBranches.map((b) => b.id);
      seed.push(NO_BRANCH_SENTINEL);
      setBranchSel(seed);
    }
  }, [isBranchScoped, branchSel.length, generatableBranches]);

  // Default: all real departments checked (never the Contractors / All pseudo-options).
  useEffect(() => {
    if (deptSel.length === 0 && generatableDepartments.length > 0) {
      setDeptSel([...generatableDepartments]);
    }
  }, [deptSel.length, generatableDepartments]);

  const branchOptions = useMemo(() => {
    const opts = generatableBranches.map((b) => ({ value: b.id, label: b.name }));
    // Always offer a "no branch" row so org-wide staff (HR, heads, finance) with no
    // primary branch can be swept into the run and are never silently unpaid.
    opts.push({
      value: NO_BRANCH_SENTINEL,
      label: unassignedStaffCount > 0 ? `Unassigned (no branch) · ${unassignedStaffCount}` : 'Unassigned (no branch)',
    });
    return opts;
  }, [generatableBranches, unassignedStaffCount]);

  const deptOptions = useMemo(() => {
    // Broad scopes lead the list: "All staff & contractors" first, then Contractors,
    // then the individual departments.
    const opts: Array<{ value: string; label: string }> = [];
    if (canRunAllScope) {
      opts.push({ value: ALL_SCOPE_SENTINEL, label: 'All staff & contractors' });
    }
    opts.push({ value: CONTRACTORS_SENTINEL, label: 'Contractors' });
    for (const d of generatableDepartments) {
      opts.push({ value: d, label: DEPT_LABEL[d] });
    }
    return opts;
  }, [generatableDepartments, canRunAllScope]);

  const isAllScope = deptSel.includes(ALL_SCOPE_SENTINEL);
  const isContractorsScope = !isAllScope && deptSel.includes(CONTRACTORS_SENTINEL);
  const isNullScope = isAllScope || isContractorsScope;
  const scopeType = isAllScope ? 'ALL' : isContractorsScope ? 'CONTRACTORS' : undefined;

  // Real departments actually selected (pseudo-options excluded).
  const selectedDepts = useMemo(
    () => deptSel.filter((d): d is PayrollDepartment => generatableDepartments.includes(d as PayrollDepartment)),
    [deptSel, generatableDepartments],
  );

  /**
   * Selecting a department dropdown value. Contractors / All are mutually exclusive
   * with real departments and with each other: picking one clears everything else.
   */
  const onDeptChange = (next: string[]) => {
    const added = next.filter((v) => !deptSel.includes(v));
    if (added.includes(ALL_SCOPE_SENTINEL)) {
      setDeptSel([ALL_SCOPE_SENTINEL]);
    } else if (added.includes(CONTRACTORS_SENTINEL)) {
      setDeptSel([CONTRACTORS_SENTINEL]);
    } else {
      // Any real-department pick drops the pseudo-options.
      setDeptSel(next.filter((v) => v !== ALL_SCOPE_SENTINEL && v !== CONTRACTORS_SENTINEL));
    }
    setPreview(null);
    setSelectionPreview(null);
  };

  const isBulkDept = !isNullScope && selectedDepts.length > 1;
  const resolvedDeptCount = selectedDepts.length;
  const combinedBatch = !isNullScope && branchIds.length > 1;
  /** One batch per department; branches combine into each department slot. */
  const slotCount = isNullScope ? 1 : selectedDepts.length;
  // A branch-pinned CONTRACTORS run must go through the single endpoint (bulk has no
  // branchId). ALL and unpinned CONTRACTORS can use bulk with empty arrays.
  const contractorsPinned = isContractorsScope && !isBranchScoped && branchIds.length === 1;
  // Fan out (bulk) whenever more than one department or more than one branch is in play,
  // or for a null scope that carries no single-branch pin.
  const useBulk =
    (isNullScope && !contractorsPinned) || isBulkDept || combinedBatch;

  const periodMonth = `${yearYyyy}-${monthMm}-01`;
  const hasBranchSelection = isBranchScoped || branchIds.length >= 1;
  // The full roster preview (table) only applies to exactly one branch + one department.
  const isSingleSlot =
    !isNullScope && !isBulkDept && (isBranchScoped || branchIds.length === 1) && selectedDepts.length === 1;
  // Preview is offered for ANY valid selection: a staff department run (>=1 dept and
  // a branch in scope), CONTRACTORS, or ALL.
  const showPreview =
    isNullScope || (selectedDepts.length >= 1 && hasBranchSelection);

  useEffect(() => {
    if (previewFetcher.data && typeof previewFetcher.data === 'object') {
      const d = previewFetcher.data as { preview?: PayrollPreview };
      if (d.preview) setPreview(d.preview);
    }
  }, [previewFetcher.data]);

  useEffect(() => {
    if (selectionFetcher.data && typeof selectionFetcher.data === 'object') {
      const d = selectionFetcher.data as { selectionPreview?: SelectionPreview };
      if (d.selectionPreview) setSelectionPreview(d.selectionPreview);
    }
  }, [selectionFetcher.data]);

  useEffect(() => {
    if (supplementaryFetcher.data && typeof supplementaryFetcher.data === 'object') {
      const d = supplementaryFetcher.data as { supplementaryPreview?: SupplementaryPreview };
      if (d.supplementaryPreview) {
        setSupplementaryPreview(d.supplementaryPreview);
        // Default: every affected member selected.
        setSupplementarySelectedIds(new Set(d.supplementaryPreview.affected.map((r) => r.staffId)));
      }
    }
  }, [supplementaryFetcher.data]);

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
      key: 'gross',
      header: 'Gross',
      align: 'right',
      nowrap: true,
      render: (r) => <NairaPrice amount={Number(r.grossPay ?? r.totalPayout)} />,
    },
    {
      key: 'paye',
      header: 'PAYE',
      align: 'right',
      nowrap: true,
      cellClassName: 'text-danger-600 dark:text-danger-400',
      render: (r) =>
        Number(r.payeTax ?? 0) > 0 ? (
          <>
            −<NairaPrice amount={Number(r.payeTax)} />
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

  // Multi-scope roster: same money columns, plus a Branch column since the
  // fan-out spans branches (and departments) in a single list.
  const selectionColumns: CompactTableColumn<SelectionRow>[] = useMemo(
    () => [
      {
        key: 'staff',
        header: 'Staff',
        render: (r) => (
          <div>
            <p className="font-medium text-app-fg">{r.staffName}</p>
            <div className="flex flex-wrap items-center gap-1">
              <RoleBadge role={r.staffRole} size="sm" />
              {r.branchName ? (
                <span className="text-xs text-app-fg-muted">{r.branchName}</span>
              ) : null}
            </div>
          </div>
        ),
      },
      { key: 'base', header: 'Base', align: 'right', nowrap: true, render: (r) => <NairaPrice amount={r.baseSalary} /> },
      {
        key: 'bonus', header: 'Bonus', align: 'right', nowrap: true,
        cellClassName: 'text-success-600 dark:text-success-400',
        render: (r) => <NairaPrice amount={r.performanceBonus} />,
      },
      {
        key: 'deductions', header: 'Deductions', align: 'right', nowrap: true,
        cellClassName: 'text-danger-600 dark:text-danger-400',
        render: (r) => (Number(r.deductionsTotal) > 0 ? <>−<NairaPrice amount={Number(r.deductionsTotal)} /></> : 'N/A'),
      },
      { key: 'gross', header: 'Gross', align: 'right', nowrap: true, render: (r) => <NairaPrice amount={Number(r.grossPay ?? r.totalPayout)} /> },
      {
        key: 'paye', header: 'PAYE', align: 'right', nowrap: true,
        cellClassName: 'text-danger-600 dark:text-danger-400',
        render: (r) => (Number(r.payeTax ?? 0) > 0 ? <>−<NairaPrice amount={Number(r.payeTax)} /></> : 'N/A'),
      },
      {
        key: 'net', header: 'Net', align: 'right', nowrap: true,
        render: (r) => (<span className="font-semibold"><NairaPrice amount={r.totalPayout} /></span>),
      },
    ],
    [],
  );

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
  const hasBranch = isBranchScoped || branchIds.length > 0;
  const canGenerate =
    !generating && (isNullScope || (selectedDepts.length >= 1 && hasBranch));
  const homeBranchId = branchIds[0] ?? '';
  // CONTRACTORS pins to a single branch only when exactly one is selected.
  const contractorsBranchId = branchIds.length === 1 ? branchIds[0] : '';

  // ── Supplementary (Track A) ──────────────────────────────────────────────
  // Supplementary scope: complete an already-settled month for underpaid staff.
  // Reuses the same Month/Year picker; branch is optional (org-wide if omitted).
  const supplementaryPeriodMonth = periodMonth.slice(0, 10);
  // Optional branch pin: reuse the first selected real branch, else org-wide.
  const supplementaryBranchId = isBranchScoped
    ? viewer.currentBranchId ?? ''
    : branchIds.length === 1
      ? branchIds[0] ?? ''
      : '';
  const supplementaryPreviewing = supplementaryFetcher.state === 'submitting';
  const supplementaryGenerating =
    fetcher.state === 'submitting' && fetcher.formData?.get('intent') === 'generateSupplementaryBatch';
  const supplementaryAllSelected =
    !!supplementaryPreview &&
    supplementaryPreview.affected.length > 0 &&
    supplementaryPreview.affected.every((r) => supplementarySelectedIds.has(r.staffId));

  const runSupplementaryPreview = () => {
    setSupplementaryPreview(null);
    setSupplementarySelectedIds(new Set());
    const fd = new FormData();
    fd.set('intent', 'previewSupplementaryBatch');
    fd.set('periodMonth', supplementaryPeriodMonth);
    if (supplementaryBranchId) fd.set('branchId', supplementaryBranchId);
    supplementaryFetcher.submit(fd, { method: 'post', action: '/hr/payroll/generate' });
  };

  const supplementaryColumns: CompactTableColumn<SupplementaryRow>[] = useMemo(
    () => [
      {
        key: 'member',
        header: 'Member',
        render: (r) => (
          <div>
            <p className="font-medium text-app-fg">{r.name}</p>
            <RoleBadge role={r.role} size="sm" />
          </div>
        ),
      },
      { key: 'expectedGross', header: 'Expected gross', align: 'right', nowrap: true, render: (r) => <NairaPrice amount={r.expectedGross} /> },
      { key: 'paidGross', header: 'Paid gross', align: 'right', nowrap: true, render: (r) => <NairaPrice amount={r.paidGross} /> },
      {
        key: 'grossBalance', header: 'Gross balance', align: 'right', nowrap: true,
        cellClassName: 'text-success-600 dark:text-success-400',
        render: (r) => <NairaPrice amount={r.grossBalance} />,
      },
      { key: 'correctPaye', header: 'Correct PAYE', align: 'right', nowrap: true, render: (r) => <NairaPrice amount={r.correctPaye} /> },
      { key: 'paidPaye', header: 'PAYE deducted', align: 'right', nowrap: true, render: (r) => <NairaPrice amount={r.paidPaye} /> },
      {
        key: 'remainingPaye', header: 'Remaining PAYE', align: 'right', nowrap: true,
        cellClassName: 'text-danger-600 dark:text-danger-400',
        render: (r) => (Number(r.remainingPaye) > 0 ? <>−<NairaPrice amount={r.remainingPaye} /></> : 'N/A'),
      },
      {
        key: 'netPayable', header: 'Net supplementary', align: 'right', nowrap: true,
        render: (r) => (<span className="font-semibold"><NairaPrice amount={r.netPayable} /></span>),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generate payroll"
        description="Pick month and scope, then generate a draft batch."
        backTo="/hr/payroll"
      />

      {/* Mode switch: standard draft run vs supplementary (complete an underpaid,
          already-settled month). */}
      <div className="inline-flex rounded-lg border border-app-border bg-app-canvas p-0.5">
        {(
          [
            { value: 'STANDARD' as const, label: 'Standard' },
            { value: 'SUPPLEMENTARY' as const, label: 'Supplementary' },
          ]
        ).map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setMode(m.value)}
            className={[
              'px-4 h-9 rounded-md text-sm font-medium transition-colors',
              mode === m.value
                ? 'bg-brand-500 text-white'
                : 'text-app-fg-muted hover:text-app-fg',
            ].join(' ')}
            aria-pressed={mode === m.value}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'STANDARD' && (previewError ?? previewActionError) && (
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

      {mode === 'STANDARD' && (surface.errorMatchingIntent(['generateBatch', 'generateBatchesBulk']) ?? generateActionError) && (
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

      {mode === 'SUPPLEMENTARY' && (
        <SupplementaryGenerate
          formatMonthLabel={formatMonthLabel}
          monthMm={monthMm}
          yearYyyy={yearYyyy}
          setMonthMm={setMonthMm}
          setYearYyyy={setYearYyyy}
          yearOptions={yearOptions}
          isBranchScoped={isBranchScoped}
          branchOptions={branchOptions.filter((o) => o.value !== NO_BRANCH_SENTINEL)}
          branchIds={branchIds}
          setBranchIds={setBranchIds}
          supplementaryBranchId={supplementaryBranchId}
          runLabel={runLabel}
          setRunLabel={setRunLabel}
          columns={supplementaryColumns}
          preview={supplementaryPreview}
          setPreview={setSupplementaryPreview}
          selectedIds={supplementarySelectedIds}
          setSelectedIds={setSupplementarySelectedIds}
          allSelected={supplementaryAllSelected}
          previewing={supplementaryPreviewing}
          generating={supplementaryGenerating}
          onPreview={runSupplementaryPreview}
          previewError={supplementarySurface.errorMatchingIntent('previewSupplementaryBatch')}
          generateError={surface.errorMatchingIntent('generateSupplementaryBatch')}
          periodMonth={supplementaryPeriodMonth}
          fetcher={fetcher}
        />
      )}

      {mode === 'STANDARD' && (
      <div className="card space-y-5">
        <fetcher.Form method="post" id="payroll-generate-form" className="space-y-5">
          <input
            type="hidden"
            name="intent"
            value={useBulk ? 'generateBatchesBulk' : 'generateBatch'}
          />
          <input type="hidden" name="periodMonth" value={periodMonth} />
          {scopeType ? <input type="hidden" name="scopeType" value={scopeType} /> : null}
          {runLabel ? <input type="hidden" name="runLabel" value={runLabel} /> : null}
          {combinedBatch || isBulkDept ? (
            <input type="hidden" name="combineBranches" value="on" />
          ) : null}

          {/* Branch inputs: none for a branch-scoped user (implicit) or an ALL run. */}
          {!isBranchScoped && !isAllScope
            ? branchIds.map((id) => (
                <input key={id} type="hidden" name="branchIds" value={id} />
              ))
            : null}
          {isContractorsScope
            ? contractorsBranchId
              ? <input type="hidden" name="branchId" value={contractorsBranchId} />
              : null
            : !isBranchScoped && !isAllScope && homeBranchId
              ? <input type="hidden" name="branchId" value={homeBranchId} />
              : null}

          {/* Department inputs: only for a normal staff run (never for CONTRACTORS / ALL). */}
          {!isNullScope
            ? useBulk
              ? selectedDepts.map((d) => (
                  <input key={d} type="hidden" name="departments" value={d} />
                ))
              : selectedDepts[0]
                ? <input type="hidden" name="department" value={selectedDepts[0]} />
                : null
            : null}

          {/* Sweep no-branch staff into the home-branch batch (staff runs only). */}
          {!isNullScope && includeNullBranch ? (
            <input type="hidden" name="includeNullBranch" value="on" />
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3 items-end">
            {!isBranchScoped ? (
              <div className="sm:col-span-1 xl:col-span-2">
                <CheckboxMultiSelect
                  id="payroll-gen-branch"
                  label="Branch"
                  noun="branches"
                  required={!isAllScope}
                  options={branchOptions}
                  value={branchSel}
                  onChange={(next) => {
                    setBranchSel(next);
                    setPreview(null);
    setSelectionPreview(null);
                  }}
                />
              </div>
            ) : null}
            <div className="sm:col-span-1 xl:col-span-2">
              <CheckboxMultiSelect
                id="payroll-gen-department"
                label="Department"
                noun="departments"
                required
                selectAll={false}
                options={deptOptions}
                value={deptSel}
                onChange={onDeptChange}
              />
            </div>
            <FormSelect
              label="Month"
              name="_monthUi"
              required
              options={MONTH_OPTIONS}
              value={monthMm}
              onChange={(e) => {
                setMonthMm(e.target.value);
                setPreview(null);
    setSelectionPreview(null);
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
                setSelectionPreview(null);
              }}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <TextInput
              label="Run label (optional)"
              name="_runLabelUi"
              value={runLabel}
              onChange={(e) => setRunLabel(e.target.value)}
              placeholder="e.g. April 2026 CS run"
            />
            <Button
              type="button"
              variant="primary"
              disabled={!canGenerate}
              loading={generating}
              loadingText="…"
              className="h-10 md:h-9 w-full"
              onClick={() => setShowGenerateConfirm(true)}
            >
              Generate
            </Button>
          </div>

          {/* Hint: no-branch staff exist but the "Unassigned (no branch)" option is
              NOT checked, so this staff run would skip them. */}
          {!isNullScope && unassignedStaffCount > 0 && !includeNullBranch && (
            <p className="text-xs rounded-md border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 px-3 py-2 text-warning-800 dark:text-warning-200">
              <span className="font-medium">
                {unassignedStaffCount} staff {unassignedStaffCount === 1 ? 'has' : 'have'} no branch
              </span>{' '}
              and will be skipped. Check <span className="font-medium">Unassigned (no branch)</span> in
              the Branch list to include them.
            </p>
          )}
          {/* Confirmation: no-branch staff WILL be included this run. */}
          {!isNullScope && includeNullBranch && (
            <p className="text-xs text-app-fg-muted rounded-md border border-app-border bg-app-hover px-3 py-2">
              Staff with no branch will be paid in this run, attached to the first selected branch.
            </p>
          )}

          {isNullScope && (
            <p className="text-xs text-app-fg-muted rounded-md border border-app-border bg-app-hover px-3 py-2">
              {isAllScope ? (
                <>
                  Creates one batch covering{' '}
                  <span className="font-medium text-app-fg">all staff and contractors</span> for{' '}
                  <span className="font-medium text-app-fg">{formatMonthLabel}</span>. Branch and
                  department are ignored for this scope.
                </>
              ) : (
                <>
                  Creates one <span className="font-medium text-app-fg">contractors</span> batch for{' '}
                  <span className="font-medium text-app-fg">{formatMonthLabel}</span>
                  {contractorsBranchId ? ', pinned to the selected branch' : ''}. Departments are not
                  used for this scope.
                </>
              )}
            </p>
          )}

          {!isNullScope && (combinedBatch || isBulkDept) && (
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
                {isSingleSlot ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={
                      (!isBranchScoped && branchIds.length === 0) ||
                      selectedDepts.length !== 1 ||
                      previewFetcher.state === 'submitting'
                    }
                    loading={previewFetcher.state === 'submitting'}
                    loadingText="Previewing…"
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('intent', 'previewBatch');
                      if (homeBranchId) fd.set('branchId', homeBranchId);
                      fd.set('department', selectedDepts[0] ?? '');
                      fd.set('periodMonth', periodMonth.slice(0, 10));
                      for (const id of branchIds) fd.append('branchIds', id);
                      if (includeNullBranch) fd.set('includeNullBranch', 'on');
                      previewFetcher.submit(fd, { method: 'post', action: '/hr/payroll/generate' });
                    }}
                  >
                    Preview roster
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={selectionFetcher.state === 'submitting'}
                    loading={selectionFetcher.state === 'submitting'}
                    loadingText="Previewing…"
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('intent', 'previewSelection');
                      fd.set('periodMonth', periodMonth.slice(0, 10));
                      if (scopeType) fd.set('scopeType', scopeType);
                      if (isContractorsScope && contractorsBranchId) {
                        fd.set('branchId', contractorsBranchId);
                      }
                      if (!isNullScope) {
                        if (homeBranchId) fd.set('branchId', homeBranchId);
                        for (const id of branchIds) fd.append('branchIds', id);
                        for (const d of selectedDepts) fd.append('departments', d);
                        if (includeNullBranch) fd.set('includeNullBranch', 'on');
                      }
                      selectionFetcher.submit(fd, { method: 'post', action: '/hr/payroll/generate' });
                    }}
                  >
                    Preview total
                  </Button>
                )}
                {isSingleSlot && preview ? (
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
              {/* Indeterminate progress while the whole-selection total computes.
                  It runs full commission math per staff member, so it can take a
                  while on large selections — show visible progress. */}
              {!isSingleSlot && selectionFetcher.state !== 'idle' && (
                <div className="space-y-1.5" role="status" aria-live="polite">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-border">
                    <div className="payroll-preview-bar h-full w-1/3 rounded-full bg-brand-500" />
                  </div>
                  <p className="text-xs text-app-fg-muted">
                    Calculating payroll for {selectedDepts.length || 'the selected'}{' '}
                    {selectedDepts.length === 1 ? 'department' : 'departments'}
                    {includeNullBranch ? ' (including no-branch staff)' : ''}. This can take a moment.
                  </p>
                </div>
              )}
              {!isSingleSlot && (
                <ModalFetcherInlineError message={selectionSurface.errorMatchingIntent('previewSelection')} />
              )}
              {!isSingleSlot && selectionPreview ? (
                <div className="rounded-md border border-app-border bg-app-hover px-3 py-2.5 text-sm text-app-fg-muted">
                  Preview:{' '}
                  <span className="font-medium text-app-fg tabular-nums">{selectionPreview.staffCount}</span> staff
                  {' · '}
                  <span className="font-medium text-app-fg tabular-nums">{selectionPreview.contractorCount}</span> contractors
                  {' · '}
                  <span className="font-semibold text-app-fg tabular-nums">
                    <NairaPrice amount={selectionPreview.totalAmount} />
                  </span>{' '}
                  across{' '}
                  <span className="font-medium text-app-fg tabular-nums">{selectionPreview.batchCount}</span> batch
                  {selectionPreview.batchCount === 1 ? '' : 'es'} for{' '}
                  <span className="font-medium text-app-fg">{formatMonthLabel}</span>
                </div>
              ) : null}
              {!isSingleSlot && selectionPreview?.rows && selectionPreview.rows.length > 0 ? (
                <CompactTable
                  withCard={false}
                  columns={selectionColumns}
                  rows={selectionPreview.rows}
                  rowKey={(r) => r.staffId}
                  renderMobileCard={(r) => (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-app-fg leading-snug truncate">{r.staffName}</p>
                        <span className="shrink-0 text-sm font-semibold text-app-fg tabular-nums">
                          <NairaPrice amount={r.totalPayout} />
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <RoleBadge role={r.staffRole} size="sm" />
                        {r.branchName ? (
                          <span className="text-xs text-app-fg-muted">· {r.branchName}</span>
                        ) : null}
                      </div>
                      <p className="text-xs text-app-fg-muted tabular-nums">
                        Gross <NairaPrice amount={r.grossPay ?? r.totalPayout} />
                        {Number(r.payeTax) > 0 ? (
                          <>
                            {' · '}
                            <span className="text-danger-600 dark:text-danger-400">
                              PAYE −<NairaPrice amount={Number(r.payeTax)} />
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  )}
                />
              ) : null}
              {isSingleSlot ? (
                <ModalFetcherInlineError message={previewSurface.errorMatchingIntent('previewBatch')} />
              ) : null}
              {isSingleSlot && preview && (preview.missingConfigStaff?.length ?? 0) > 0 ? (
                <div className="rounded-md border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 px-3 py-2 text-warning-800 dark:text-warning-200">
                  <p className="text-xs font-semibold">
                    {preview.missingConfigStaff!.length}{' '}
                    {preview.missingConfigStaff!.length === 1 ? 'staff member has' : 'staff have'} no
                    salary config: they will generate at ₦0 base. Set their pay role or flat salary, then
                    preview again.
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {preview.missingConfigStaff!.slice(0, 8).map((s) => (
                      <li key={s.staffId} className="truncate">
                        {s.staffName} ({s.staffRole})
                      </li>
                    ))}
                    {preview.missingConfigStaff!.length > 8 ? (
                      <li className="text-warning-700 dark:text-warning-300">
                        and {preview.missingConfigStaff!.length - 8} more
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
              {isSingleSlot && preview ? (
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
      )}

      <ConfirmActionModal
        open={showGenerateConfirm}
        onClose={() => setShowGenerateConfirm(false)}
        title="Generate payroll batch"
        description={
          isAllScope ? (
            <>
              Create one payroll batch covering <strong>all staff and contractors</strong> for{' '}
              <strong>{formatMonthLabel}</strong>? Existing non-draft batches for the same scope are
              skipped.
            </>
          ) : isContractorsScope ? (
            <>
              Create one <strong>contractors</strong> payroll batch for{' '}
              <strong>{formatMonthLabel}</strong>
              {contractorsBranchId ? ' for the selected branch' : ''}? Existing non-draft batches for
              the same scope are skipped.
            </>
          ) : (
            <>
              Create payroll batch{slotCount > 1 ? 'es' : ''} for{' '}
              <strong>{formatMonthLabel}</strong>
              {combinedBatch ? ` combining ${branchIds.length} branches` : ''}
              {isBulkDept ? ` across ${resolvedDeptCount} departments` : ''}? Existing non-draft
              batches for the same home branch and department are skipped.
            </>
          )
        }
        details={
          <ul className="list-disc pl-4 space-y-1 text-sm">
            <li>Draft payouts are created from current rules and delivered orders</li>
            <li>You can review and adjust before submitting to HR</li>
            {isContractorsScope ? <li>Only agency contractors are included in this run</li> : null}
            {isAllScope ? <li>All staff and contractors are included in this run</li> : null}
            {combinedBatch ? (
              <li>Staff from all selected branches go into one batch per department</li>
            ) : null}
          </ul>
        }
        confirmLabel="Generate"
        variant="warning"
        loading={generating}
        onConfirm={() => {
          // The generate action redirects back to /hr/payroll, which is served
          // by cachedClientLoader. Bust that cached snapshot now so the new batch
          // shows immediately instead of only after a manual Refresh.
          invalidateCachedLoader('/hr/payroll');
          const form = document.getElementById('payroll-generate-form') as HTMLFormElement | null;
          form?.requestSubmit();
          setShowGenerateConfirm(false);
        }}
      />
    </div>
  );
}

/**
 * Supplementary (Track A) generate section. Lists staff who were UNDERPAID in an
 * already-settled month, lets HR deselect members, and generates a DRAFT
 * supplementary batch that completes the shortfall. Reuses the page's Month/Year
 * picker, branch picker, CompactTable, and NairaPrice components.
 */
function SupplementaryGenerate({
  formatMonthLabel,
  monthMm,
  yearYyyy,
  setMonthMm,
  setYearYyyy,
  yearOptions,
  isBranchScoped,
  branchOptions,
  branchIds,
  setBranchIds,
  supplementaryBranchId,
  runLabel,
  setRunLabel,
  columns,
  preview,
  setPreview,
  selectedIds,
  setSelectedIds,
  allSelected,
  previewing,
  generating,
  onPreview,
  previewError,
  generateError,
  periodMonth,
  fetcher,
}: {
  formatMonthLabel: string;
  monthMm: string;
  yearYyyy: string;
  setMonthMm: (v: string) => void;
  setYearYyyy: (v: string) => void;
  yearOptions: Array<{ value: string; label: string }>;
  isBranchScoped: boolean;
  branchOptions: Array<{ value: string; label: string }>;
  branchIds: string[];
  setBranchIds: (next: string[]) => void;
  supplementaryBranchId: string;
  runLabel: string;
  setRunLabel: (v: string) => void;
  columns: CompactTableColumn<SupplementaryRow>[];
  preview: SupplementaryPreview | null;
  setPreview: Dispatch<SetStateAction<SupplementaryPreview | null>>;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  allSelected: boolean;
  previewing: boolean;
  generating: boolean;
  onPreview: () => void;
  previewError: string | null;
  generateError: string | null;
  periodMonth: string;
  fetcher: ReturnType<typeof useFetcher>;
}) {
  const affected = preview?.affected ?? [];
  const selectedCount = affected.filter((r) => selectedIds.has(r.staffId)).length;
  const canGenerate = !generating && affected.length > 0 && selectedCount > 0;
  const [dismissedError, setDismissedError] = useState(false);
  const shownError = dismissedError ? null : generateError || previewError;
  useEffect(() => {
    if (generateError || previewError) setDismissedError(false);
  }, [generateError, previewError]);

  const toggleOne = (rowId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(affected.map((r) => r.staffId)) : new Set());
  };

  const submitGenerate = () => {
    const fd = new FormData();
    fd.set('intent', 'generateSupplementaryBatch');
    fd.set('periodMonth', periodMonth);
    if (supplementaryBranchId) fd.set('branchId', supplementaryBranchId);
    // Omit staffIds when all are selected — the backend then covers everyone.
    if (!allSelected) {
      for (const r of affected) {
        if (selectedIds.has(r.staffId)) fd.append('staffIds', r.staffId);
      }
    }
    if (runLabel) fd.set('runLabel', runLabel);
    invalidateCachedLoader('/hr/payroll');
    fetcher.submit(fd, { method: 'post', action: '/hr/payroll/generate' });
  };

  return (
    <div className="card space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-app-fg">Supplementary run</h3>
        <p className="text-xs text-app-fg-muted mt-0.5">
          Complete an already-settled month for staff who were underpaid. Preview the shortfall, then
          generate a draft batch.
        </p>
      </div>

      {shownError && (
        <PageNotification
          variant="error"
          title={generateError ? 'Could not generate' : 'Preview failed'}
          message={typeof shownError === 'string' ? shownError : ''}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 items-end">
        {!isBranchScoped ? (
          <FormSelect
            label="Branch (optional)"
            name="_supBranchUi"
            value={branchIds.length === 1 ? branchIds[0] : ''}
            onChange={(e) => {
              setBranchIds(e.target.value ? [e.target.value] : []);
              setPreview(null);
            }}
            options={[{ value: '', label: 'All branches' }, ...branchOptions]}
          />
        ) : null}
        <FormSelect
          label="Month"
          name="_supMonthUi"
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
          name="_supYearUi"
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
          variant="secondary"
          disabled={previewing}
          loading={previewing}
          loadingText="Previewing…"
          className="h-10 md:h-9 w-full"
          onClick={onPreview}
        >
          Preview
        </Button>
      </div>

      {preview ? (
        affected.length > 0 ? (
          <div className="space-y-3">
            {/* Summary strip: totals from the preview. */}
            <div className="rounded-md border border-app-border bg-app-hover px-3 py-2.5 text-sm text-app-fg-muted">
              <span className="font-medium text-app-fg tabular-nums">{selectedCount}</span> of{' '}
              <span className="font-medium text-app-fg tabular-nums">{affected.length}</span> underpaid{' '}
              {affected.length === 1 ? 'member' : 'members'} selected for{' '}
              <span className="font-medium text-app-fg">{formatMonthLabel}</span>
              {' · '}
              Net payable:{' '}
              <span className="font-semibold text-app-fg tabular-nums">
                <NairaPrice amount={preview.totalNetPayable} />
              </span>
              {' · '}
              Remaining PAYE:{' '}
              <span className="font-semibold text-app-fg tabular-nums">
                <NairaPrice amount={preview.totalRemainingPaye} />
              </span>
            </div>

            <CompactTable
              withCard={false}
              columns={columns}
              rows={affected}
              rowKey={(r) => r.staffId}
              selection={{
                selectedIds,
                onToggle: toggleOne,
                onToggleAll: toggleAll,
                getRowId: (r) => r.staffId,
              }}
              renderMobileCard={(r, _i, { rowSelection }) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {rowSelection}
                      <p className="text-sm font-semibold text-app-fg leading-snug truncate">{r.name}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-app-fg tabular-nums">
                      <NairaPrice amount={r.netPayable} />
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <RoleBadge role={r.role} size="sm" />
                  </div>
                  <p className="text-xs text-app-fg-muted tabular-nums">
                    Balance <NairaPrice amount={r.grossBalance} />
                    {Number(r.remainingPaye) > 0 ? (
                      <>
                        {' · '}
                        <span className="text-danger-600 dark:text-danger-400">
                          PAYE −<NairaPrice amount={r.remainingPaye} />
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <TextInput
                label="Run label (optional)"
                name="_supRunLabelUi"
                value={runLabel}
                onChange={(e) => setRunLabel(e.target.value)}
                placeholder="e.g. April 2026 supplementary"
              />
              <Button
                type="button"
                variant="primary"
                disabled={!canGenerate}
                loading={generating}
                loadingText="Generating…"
                className="h-10 md:h-9 w-full"
                onClick={submitGenerate}
              >
                Generate supplementary batch
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-app-fg-muted rounded-md border border-app-border bg-app-hover px-3 py-2.5">
            No underpaid staff found for this period.
          </p>
        )
      ) : null}
    </div>
  );
}
