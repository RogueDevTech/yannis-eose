import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { useToast } from '~/components/ui/toast';
import type {
  MonthlyPayrollGroup,
  PayrollBatch,
  BranchOption,
} from './types';
import { DEPT_LABEL } from './payroll-constants';

function formatMonth(periodMonth: string): string {
  const [yyyy, mm] = periodMonth.split('-');
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, 1));
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

interface MonthlyPayrollsProps {
  monthlyPayrolls: MonthlyPayrollGroup[];
  branches: BranchOption[];
}

export function MonthlyPayrolls({
  monthlyPayrolls,
  branches,
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

  return (
    <div className="space-y-4">
      <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[12rem]">
      {monthlyPayrolls.length === 0 && (
        <EmptyState
          title="No payroll batches yet"
          description="Click Generate Monthly Batch in the toolbar to create one."
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

type BatchRow = PayrollBatch & { _branchName: string };

function MonthGroup({
  group,
  branchById,
}: {
  group: MonthlyPayrollGroup;
  branchById: Map<string, string>;
}) {
  const [open, setOpen] = useState(true);
  const rows: BatchRow[] = group.items.map((b) => ({
    ...b,
    _branchName: branchById.get(b.branchId) ?? b.branchId.slice(0, 8),
  }));

  const columns: CompactTableColumn<BatchRow>[] = [
    {
      key: 'department',
      header: 'Department',
      hideable: false,
      render: (row) => <span className="text-sm font-medium text-app-fg">{DEPT_LABEL[row.department]}</span>,
    },
    {
      key: 'branch',
      header: 'Branch',
      render: (row) => <span className="text-sm text-app-fg-muted">{row._branchName}</span>,
    },
    {
      key: 'staff',
      header: 'Staff',
      align: 'right',
      render: (row) => <span className="text-sm text-app-fg-muted">{row.staffCount}</span>,
    },
    {
      key: 'prepared',
      header: 'Prepared',
      render: (row) => (
        <span className="text-sm text-app-fg-muted">
          {row.preparedAt
            ? new Date(row.preparedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
            : '\u2014'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (row) => (
        <span className="text-sm font-semibold text-app-fg">
          <NairaPrice amount={Number(row.totalAmount)} />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      hideable: false,
      render: (row) => (
        <CompactTableActionButton to={`/hr/payroll-batch/${row.id}`}>View</CompactTableActionButton>
      ),
    },
  ];

  return (
    <div className="list-panel p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-app-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3.5 h-3.5 text-app-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <h3 className="text-sm font-semibold text-app-fg">{formatMonth(group.month)}</h3>
          <span className="text-xs text-app-fg-muted">{group.staffCount} staff</span>
        </div>
        <div className="text-sm font-semibold text-app-fg">
          <NairaPrice amount={group.totalAmount} />
        </div>
      </button>

      {open && (
        <div className="border-t border-app-border">
          <CompactTable<BatchRow>
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            withCard={false}
            emptyTitle="No batches"
            emptyDescription=""
            renderMobileCard={(row) => (
              <Link
                to={`/hr/payroll-batch/${row.id}`}
                className="block p-4 space-y-3 hover:bg-app-hover transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-app-fg text-sm">{DEPT_LABEL[row.department]}</p>
                    <p className="text-xs text-app-fg-muted mt-0.5">{row._branchName}</p>
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-app-fg-muted">{row.staffCount} staff</span>
                  <span className="font-semibold text-app-fg">
                    <NairaPrice amount={Number(row.totalAmount)} />
                  </span>
                </div>
              </Link>
            )}
          />
        </div>
      )}
    </div>
  );
}
