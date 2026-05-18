import { useEffect, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { Button } from '~/components/ui/button';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { PageNotification } from '~/components/ui/page-notification';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import type { BranchOption, ViewerInfo, PayrollDepartment } from './types';
import {
  ALL_BRANCHES_SENTINEL,
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

export function PayrollGeneratePage({ branches, viewer }: PayrollGenerateLoaderData) {
  const fetcher = useFetcher();
  const previewFetcher = useFetcher<{ success?: boolean; preview?: PayrollPreview | null; error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const previewSurface = useFetcherActionSurface(previewFetcher);

  const firstNow = new Date();
  const [monthMm, setMonthMm] = useState(() => String(firstNow.getMonth() + 1).padStart(2, '0'));
  const [yearYyyy, setYearYyyy] = useState(() => String(firstNow.getFullYear()));
  const [branchSel, setBranchSel] = useState('');
  const [deptSel, setDeptSel] = useState('');
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [dismissedPreviewError, setDismissedPreviewError] = useState(false);
  const [dismissedGenerateError, setDismissedGenerateError] = useState(false);

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
    if (!branchSel && generatableBranches[0]) setBranchSel(generatableBranches[0].id);
  }, [branchSel, generatableBranches]);

  useEffect(() => {
    const first = generatableDepartments[0];
    if (first && !generatableDepartments.includes(deptSel as PayrollDepartment) && deptSel !== ALL_DEPARTMENTS_SENTINEL) {
      setDeptSel(first);
    }
  }, [deptSel, generatableDepartments]);

  const branchOptions = useMemo(() => {
    const base = generatableBranches.map((b) => ({ value: b.id, label: b.name }));
    if (generatableBranches.length > 1) {
      return [{ value: ALL_BRANCHES_SENTINEL, label: 'All branches' }, ...base];
    }
    return base;
  }, [generatableBranches]);

  const deptOptions = useMemo(() => {
    const base = generatableDepartments.map((d) => ({ value: d, label: DEPT_LABEL[d] }));
    if (generatableDepartments.length > 1) {
      return [{ value: ALL_DEPARTMENTS_SENTINEL, label: 'All departments' }, ...base];
    }
    return base;
  }, [generatableDepartments]);

  const isBulkBranch = branchSel === ALL_BRANCHES_SENTINEL;
  const isBulkDept = deptSel === ALL_DEPARTMENTS_SENTINEL;
  const showScopeHint = isBulkBranch || isBulkDept;
  const resolvedBranchCount = isBulkBranch ? generatableBranches.length : branchSel ? 1 : 0;
  const resolvedDeptCount = isBulkDept ? generatableDepartments.length : deptSel ? 1 : 0;
  const slotCount = resolvedBranchCount * resolvedDeptCount;

  const periodMonth = `${yearYyyy}-${monthMm}-01`;

  const showPreview = !isBulkBranch && !isBulkDept && branchSel && deptSel;

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
          <p className="text-xs text-app-fg-muted">{r.staffRole.replace(/_/g, ' ')}</p>
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
          '—'
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

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Generate Payroll Batch"
        mobileInlineActions
        description="Generate payroll for a selected month and scope."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Payroll tools"
            sheetSubtitle={<span>Navigation</span>}
            triggerAriaLabel="Payroll generator toolbar"
            showMobileRefresh={false}
            desktop={
              <Link to="/hr/payroll" className="btn-ghost btn-sm shrink-0">
                ← Back to payroll
              </Link>
            }
            sheet={
              <Link to="/hr/payroll" className="btn-secondary btn-sm w-full justify-center">
                Back to payroll
              </Link>
            }
          />
        }
      />

      {(previewError ?? previewActionError) && (
        <PageNotification
          variant="error"
          title="Preview failed"
          message={typeof previewError === 'string' ? previewError : typeof previewActionError === 'string' ? previewActionError : ''}
          onDismiss={() => {
            setDismissedPreviewError(true);
          }}
        />
      )}

      {(surface.errorMatchingIntent(['generateBatch', 'generateBatchesBulk']) ?? generateActionError) && (
        <PageNotification
          variant="error"
          title="Could not generate"
          message={(() => {
            const e = surface.errorMatchingIntent(['generateBatch', 'generateBatchesBulk']);
            return typeof e === 'string' ? e : typeof generateActionError === 'string' ? generateActionError : '';
          })()}
          onDismiss={() => setDismissedGenerateError(true)}
        />
      )}

      <div className="card p-5 space-y-4">
        <fetcher.Form method="post" id="payroll-generate-form" className="space-y-4">
          {isBulkBranch || isBulkDept ? (
            <input type="hidden" name="intent" value="generateBatchesBulk" />
          ) : (
            <input type="hidden" name="intent" value="generateBatch" />
          )}
          <input type="hidden" name="periodMonth" value={periodMonth} />

          {isBulkBranch
            ? generatableBranches.map((b) => (
                <input key={b.id} type="hidden" name="branchIds" value={b.id} />
              ))
            : branchSel && branchSel !== ALL_BRANCHES_SENTINEL ? (
                <input type="hidden" name="branchId" value={branchSel} />
              ) : null}

          {isBulkDept
            ? generatableDepartments.map((d) => (
                <input key={d} type="hidden" name="departments" value={d} />
              ))
            : deptSel && deptSel !== ALL_DEPARTMENTS_SENTINEL ? (
                <input type="hidden" name="department" value={deptSel} />
              ) : null}

          <SearchableSelect
            id="payroll-gen-branch"
            label="Branch"
            required
            value={branchSel}
            onChange={(v) => {
              setBranchSel(v);
              setPreview(null);
            }}
            options={branchOptions}
            searchPlaceholder="Search branches..."
          />

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          </div>

          {showScopeHint && (
            <p className="text-xs text-app-fg-muted rounded-md border border-app-border bg-app-hover px-3 py-2">
              Will check up to <span className="font-medium text-app-fg">{slotCount}</span> batch slot
              {slotCount === 1 ? '' : 's'} ({resolvedBranchCount} branch{resolvedBranchCount === 1 ? '' : 'es'} ×{' '}
              {resolvedDeptCount} department{resolvedDeptCount === 1 ? '' : 's'}) for{' '}
              <span className="font-medium text-app-fg">{formatMonthLabel}</span>. Existing batches are skipped.
            </p>
          )}

          {showPreview && (
            <div className="rounded-md border border-app-border bg-app-hover p-3 space-y-3">
              <ModalFetcherInlineError message={previewSurface.errorMatchingIntent('previewBatch')} />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!branchSel || !deptSel || previewFetcher.state === 'submitting'}
                loading={previewFetcher.state === 'submitting'}
                loadingText="Previewing…"
                onClick={() => {
                  previewFetcher.submit(
                    {
                      intent: 'previewBatch',
                      branchId: branchSel,
                      department: deptSel,
                      periodMonth: periodMonth.slice(0, 10),
                    },
                    { method: 'post', action: '/hr/payroll/generate' },
                  );
                }}
              >
                Preview roster &amp; expected pay
              </Button>
              {preview && (
                <div className="space-y-2">
                  <p className="text-xs text-app-fg-muted">
                    Staff:{' '}
                    <span className="font-medium text-app-fg">{preview.staffCount}</span> · Expected total:{' '}
                    <span className="font-medium text-app-fg">
                      <NairaPrice amount={preview.totalAmount} />
                    </span>
                  </p>
                  {preview.rows.length > 0 ? (
                    <CompactTable
                      withCard={false}
                      columns={previewColumns}
                      rows={preview.rows}
                      rowKey={(r) => r.staffId}
                    />
                  ) : (
                    <p className="text-xs text-app-fg-muted">No staff in scope for this branch and department.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={
                !branchSel ||
                !deptSel ||
                (fetcher.state === 'submitting' &&
                  (fetcher.formData?.get('intent') === 'generateBatch' ||
                    fetcher.formData?.get('intent') === 'generateBatchesBulk'))
              }
              loading={
                fetcher.state === 'submitting' &&
                (fetcher.formData?.get('intent') === 'generateBatch' ||
                  fetcher.formData?.get('intent') === 'generateBatchesBulk')
              }
              loadingText="Generating…"
            >
              Generate
            </Button>
            <Link to="/hr/payroll" className="btn-secondary btn-sm inline-flex items-center justify-center">
              Cancel
            </Link>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
