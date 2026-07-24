import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { Pagination } from '~/components/ui/pagination';
import { useToast } from '~/components/ui/toast';
import type {
  MonthlyPayrollGroup,
  PayrollBatch,
  PayrollDepartment,
  BranchOption,
  ViewerInfo,
} from './types';
import { ADMIN_ROLES, DEPT_LABEL, DEPT_OWNER_ROLE, ALL_DEPARTMENTS } from './payroll-constants';

function formatMonth(periodMonth: string): string {
  const [yyyy, mm] = periodMonth.split('-');
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, 1));
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

interface MonthlyPayrollsProps {
  monthlyPayrolls: MonthlyPayrollGroup[];
  branches: BranchOption[];
  viewer: ViewerInfo;
}

export function MonthlyPayrolls({
  monthlyPayrolls,
  branches,
  viewer,
}: MonthlyPayrollsProps) {
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  // Client-side pagination over month groups (typically 1 group per calendar month).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const totalPages = Math.max(1, Math.ceil(monthlyPayrolls.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedMonthlyPayrolls = useMemo(
    () => monthlyPayrolls.slice((safePage - 1) * pageSize, safePage * pageSize),
    [monthlyPayrolls, safePage, pageSize],
  );
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  // If the URL has ?batchId=, redirect to the detail page (backwards compat for bookmarks).
  const initialBatchId = searchParams.get('batchId');
  useEffect(() => {
    if (initialBatchId) {
      navigate(`/hr/payroll-batch/${initialBatchId}`, { replace: true });
    }
  }, [initialBatchId, navigate]);

  // Available departments to GENERATE
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

  /** One-shot toast after bulk generate redirect from `/hr/payroll/generate`. */
  const generateSummaryFlash = searchParams.get('generateSummary');
  useEffect(() => {
    if (!generateSummaryFlash) return;
    toast.success(generateSummaryFlash);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('generateSummary');
        return next;
      },
      { replace: true },
    );
  }, [generateSummaryFlash, setSearchParams, toast]);

  const showGenerateButton = generatableDepartments.length > 0 && generatableBranches.length > 0;

  return (
    <div className="space-y-4">
      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[12rem]">
      {monthlyPayrolls.length === 0 && (
        <EmptyState
          title="No payroll batches yet"
          description={
            generatableDepartments.length > 0
              ? 'Click Generate Monthly Batch to create the first one for your department.'
              : 'No batches in your scope yet. Department heads will create them here at month-end.'
          }
        />
      )}

      {pagedMonthlyPayrolls.map((group) => (
        <MonthGroup key={group.month} group={group} branchById={branchById} />
      ))}
      </TableLoadingOverlay>

      {monthlyPayrolls.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-app-border pt-4">
          <p className="text-sm text-app-fg-muted">
            Showing {(safePage - 1) * pageSize + 1}–
            {Math.min(safePage * pageSize, monthlyPayrolls.length)} of {monthlyPayrolls.length}
          </p>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Month group ─────────────────────────────────────────────────

function MonthGroup({
  group,
  branchById,
}: {
  group: MonthlyPayrollGroup;
  branchById: Map<string, string>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="card p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-app-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-app-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <h3 className="text-base font-semibold text-app-fg">{formatMonth(group.month)}</h3>
          <span className="text-xs text-app-fg-muted">{group.staffCount} staff</span>
        </div>
        <div className="text-sm font-semibold text-app-fg">
          <NairaPrice amount={group.totalAmount} />
        </div>
      </button>

      {open && (
        <div className="border-t border-app-border">
          {group.items.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              branchName={branchById.get(batch.branchId) ?? batch.branchId.slice(0, 8)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single batch row ────────────────────────────────────────────

function BatchRow({
  batch,
  branchName,
}: {
  batch: PayrollBatch;
  branchName: string;
}) {
  return (
    <Link
      to={`/hr/payroll-batch/${batch.id}`}
      className="w-full flex items-center gap-4 px-4 py-3 hover:bg-app-hover transition-colors text-left border-t border-app-border first:border-t-0"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-app-fg">{DEPT_LABEL[batch.department]}</p>
        <p className="text-xs text-app-fg-muted">
          {branchName} {'\u00b7'} {batch.staffCount} staff {'\u00b7'} {batch.preparedAt
            ? `prepared ${new Date(batch.preparedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}`
            : 'not yet generated'}
        </p>
      </div>
      <div className="text-sm font-semibold text-app-fg whitespace-nowrap">
        <NairaPrice amount={Number(batch.totalAmount)} />
      </div>
      <StatusBadge status={batch.status} />
    </Link>
  );
}
