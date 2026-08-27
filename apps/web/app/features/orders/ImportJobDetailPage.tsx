import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from '@remix-run/react';
import { symbolForCurrencyCode } from '@yannis/shared';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { Pagination } from '~/components/ui/pagination';
import { InlineNotification } from '~/components/ui/inline-notification';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { ImportProgress } from './BulkImportPage';
import {
  getImportJobStatus,
  resumeImportJob,
  retryFailedImportRows,
  listImportJobRows,
  deleteImportJob,
  type ImportJob,
  type ImportJobRow,
  type ImportRowStatus,
} from './bulk-import-api';

/** Statuses that stop the poll — nothing more will change without user action. */
const TERMINAL_STATUSES: ImportJob['status'][] = ['COMPLETED', 'FAILED'];

const ROW_STATUS_STYLES: Record<ImportRowStatus, { label: string; cls: string }> = {
  IMPORTED: { label: 'Imported', cls: 'bg-success-500/15 text-success-600 dark:text-success-400' },
  WARNING: { label: 'Warning', cls: 'bg-warning-500/15 text-warning-600 dark:text-warning-400' },
  FAILED: { label: 'Failed', cls: 'bg-danger-500/15 text-danger-600 dark:text-danger-400' },
};

function RowStatusPill({ status }: { status: ImportRowStatus }) {
  const s = ROW_STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

const ROW_PAGE_SIZE = 100;

interface ImportJobDetailPageProps {
  jobId: string;
  /** Where "Back" returns (the import landing page). */
  backHref: string;
}

/**
 * Dedicated status page for a single import job. Reached from the "View" link in
 * the Recent imports table. Shows live progress + a paginated listing of EVERY
 * uploaded row with its per-row status (imported / warning / failed), and
 * exposes Continue / Retry-failed / Delete.
 */
export function ImportJobDetailPage({ jobId, backHref }: ImportJobDetailPageProps) {
  const navigate = useNavigate();
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Row listing ────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ImportJobRow[]>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowPage, setRowPage] = useState(1);
  const [rowStatusFilter, setRowStatusFilter] = useState<'' | ImportRowStatus>('');
  const [rowsError, setRowsError] = useState<string | null>(null);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Order peek ───────────────────────────────────────────────────────────
  // Tapping "View" on a row opens the imported order in a read-only modal
  // (built from the row data already loaded) instead of navigating away.
  const [peekRow, setPeekRow] = useState<ImportJobRow | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getImportJobStatus(jobId);
      setJob(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load this import.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const loadRows = useCallback(async () => {
    try {
      const page = await listImportJobRows({
        jobId,
        page: rowPage,
        limit: ROW_PAGE_SIZE,
        ...(rowStatusFilter ? { status: rowStatusFilter } : {}),
      });
      setRows(page.rows);
      setRowTotal(page.total);
      setRowsError(null);
    } catch (err) {
      setRowsError(err instanceof Error ? err.message : 'Failed to load rows.');
    }
  }, [jobId, rowPage, rowStatusFilter]);

  // Initial job load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load rows on mount + when paging/filter change.
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Reset to page 1 when the filter changes.
  useEffect(() => {
    setRowPage(1);
  }, [rowStatusFilter]);

  // Poll while the job is still active; refresh rows alongside so the list
  // fills in as chunks complete.
  useEffect(() => {
    if (!job) return;
    const terminal = TERMINAL_STATUSES.includes(job.status);
    if (terminal || job.status === 'PAUSED') {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return; // already polling
    pollRef.current = setInterval(() => {
      void refresh();
      void loadRows();
    }, 2500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [job, refresh, loadRows]);

  const onContinue = useCallback(async () => {
    setError(null);
    try {
      await resumeImportJob(jobId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue.');
    }
  }, [jobId, refresh]);

  const onRetryFailed = useCallback(async () => {
    setError(null);
    try {
      await retryFailedImportRows(jobId);
      await refresh();
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry.');
    }
  }, [jobId, refresh, loadRows]);

  const onConfirmDelete = useCallback(async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteImportJob(jobId);
      navigate(backHref);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete this import.');
      setDeleting(false);
    }
  }, [jobId, navigate, backHref]);

  const rowStatusOptions = useMemo(
    () => [
      { value: '', label: 'All rows' },
      { value: 'IMPORTED', label: 'Imported' },
      { value: 'WARNING', label: 'Warnings' },
      { value: 'FAILED', label: 'Failed' },
    ],
    [],
  );

  const rowTotalPages = Math.max(1, Math.ceil(rowTotal / ROW_PAGE_SIZE));
  // The worker only writes row records for rows it has REACHED; until then the
  // list is empty even though the job is valid.
  const noRowsYet = rowTotal === 0 && rows.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={job?.fileName || 'Import'}
        description={
          job?.createdAt
            ? `Uploaded ${new Date(job.createdAt).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}. Continue a paused job or retry failed rows.`
            : 'Live status for this bulk import. Continue a paused job or retry failed rows.'
        }
        backTo={backHref}
        actions={
          <div className="flex items-center gap-2">
            {job && job.processedRows > 0 && (
              <Link to="/admin/orders?period=all_time">
                <Button variant="secondary" size="sm">
                  View orders
                </Button>
              </Link>
            )}
            {job && job.status !== 'PROCESSING' && (
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                Delete import
              </Button>
            )}
          </div>
        }
      />

      {error && <InlineNotification variant="danger" message={error} />}

      {loading && !job ? (
        <div className="rounded-lg border border-app-border bg-app-surface p-6 text-center text-sm text-app-fg-muted">
          Loading import…
        </div>
      ) : !job ? (
        <div className="rounded-lg border border-app-border bg-app-surface p-6 text-center">
          <p className="text-sm text-app-fg-muted">This import could not be found.</p>
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" onClick={() => void refresh()}>Retry</Button>
          </div>
        </div>
      ) : (
        <>
          <ImportProgress job={job} onContinue={onContinue} onRetryFailed={onRetryFailed} />

          {/* Per-row listing */}
          <div className="rounded-lg border border-app-border bg-app-surface p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-app-fg">Rows</h3>
                <p className="text-xs text-app-fg-muted">
                  {rowTotal.toLocaleString()} row{rowTotal === 1 ? '' : 's'} recorded so far.
                </p>
              </div>
              <div className="w-full sm:w-48">
                <FormSelect
                  value={rowStatusFilter}
                  onChange={(e) => setRowStatusFilter(e.target.value as '' | ImportRowStatus)}
                  options={rowStatusOptions}
                  controlSize="sm"
                />
              </div>
            </div>

            {rowsError && <InlineNotification variant="danger" message={rowsError} />}

            {noRowsYet ? (
              <p className="py-6 text-center text-sm text-app-fg-muted">
                {job.status === 'PENDING' || job.status === 'PROCESSING'
                  ? 'No rows processed yet. This list fills in as the import runs.'
                  : 'No rows recorded for this import.'}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead>
                      <tr className="border-b border-app-border text-left text-xs uppercase tracking-wide text-app-fg-muted">
                        <th className="px-2 py-2 font-medium">Row</th>
                        <th className="px-2 py-2 font-medium">External ID</th>
                        <th className="px-2 py-2 font-medium">Order</th>
                        <th className="px-2 py-2 font-medium">Date</th>
                        <th className="px-2 py-2 font-medium">Customer</th>
                        <th className="px-2 py-2 font-medium">Product</th>
                        <th className="px-2 py-2 font-medium">Order status</th>
                        <th className="px-2 py-2 font-medium">Import</th>
                        <th className="px-2 py-2 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.rowIndex} className="border-b border-app-border/60 last:border-0">
                          {/* row_index is 0-based over DATA rows; +1 → spreadsheet-style row for the user */}
                          <td className="px-2 py-2 tabular-nums text-app-fg-muted">{r.rowIndex + 1}</td>
                          <td className="max-w-[160px] truncate px-2 py-2 text-app-fg" title={r.externalId ?? ''}>
                            {r.externalId || '—'}
                          </td>
                          {/* Order number, plain. The row's "View" action (last
                              column) opens the imported order in a peek modal.
                              Null for FAILED rows (no order was created). */}
                          <td className="px-2 py-2 tabular-nums text-app-fg">
                            {r.orderId
                              ? r.orderNumber != null
                                ? `YNS-${r.orderNumber}`
                                : '—'
                              : <span className="text-app-fg-muted">—</span>}
                          </td>
                          {/* Imported order's date (from the sheet's date column if mapped). */}
                          <td className="whitespace-nowrap px-2 py-2 text-app-fg-muted">
                            {r.orderCreatedAt
                              ? new Date(r.orderCreatedAt).toLocaleDateString(undefined, {
                                  year: 'numeric', month: 'short', day: 'numeric',
                                })
                              : '—'}
                          </td>
                          <td className="max-w-[160px] truncate px-2 py-2 text-app-fg" title={r.customerName ?? ''}>
                            {r.customerName || '—'}
                          </td>
                          <td className="max-w-[160px] truncate px-2 py-2 text-app-fg-muted" title={r.productName ?? ''}>
                            {r.productName || '—'}
                          </td>
                          {/* The imported order's own lifecycle status (Pending, etc.). */}
                          <td className="px-2 py-2">
                            {r.orderStatus ? (
                              <OrderStatusBadge status={r.orderStatus} />
                            ) : (
                              <span className="text-app-fg-muted">—</span>
                            )}
                          </td>
                          {/* This row's import outcome (imported / warning / failed). */}
                          <td className="px-2 py-2">
                            <RowStatusPill status={r.status} />
                          </td>
                          {/* View opens the imported order in a peek modal.
                              FAILED rows have no order, so no action. */}
                          <td className="px-2 py-2 text-right">
                            {r.orderId ? (
                              <TableActionButton variant="primary" onClick={() => setPeekRow(r)}>
                                View
                              </TableActionButton>
                            ) : (
                              <span className="text-app-fg-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rowTotalPages > 1 && (
                  <div className="mt-3">
                    <Pagination
                      page={rowPage}
                      totalPages={rowTotalPages}
                      onPageChange={setRowPage}
                      showLabel
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      <ConfirmActionModal
        open={deleteOpen}
        onClose={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        title="Delete this import?"
        description="Removes the import job and its row records. Orders already imported are NOT deleted."
        confirmLabel="Delete import"
        variant="danger"
        loading={deleting}
        error={deleteError}
        onConfirm={onConfirmDelete}
      />

      <OrderPeekModal row={peekRow} onClose={() => setPeekRow(null)} />
    </div>
  );
}

/**
 * Read-only peek at an imported order, built from the row data already loaded
 * (no extra fetch). Shows the key fields so the user can eyeball the import
 * without leaving the page, with a link to the full order detail. Customer
 * phone is intentionally absent — raw phones never leave the API (Pillar 2).
 */
function OrderPeekModal({ row, onClose }: { row: ImportJobRow | null; onClose: () => void }) {
  const open = !!row?.orderId;
  const amount =
    row?.totalAmount != null
      ? `${symbolForCurrencyCode(row.currencyCode)}${Number(row.totalAmount).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      : '—';

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-lg" aria-labelledby="order-peek-title">
      {row && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-app-fg-muted">Imported order</p>
              <h2 id="order-peek-title" className="text-lg font-semibold text-app-fg tabular-nums">
                {row.orderNumber != null ? `YNS-${row.orderNumber}` : 'Order'}
              </h2>
            </div>
            {row.orderStatus && <OrderStatusBadge status={row.orderStatus} />}
          </div>

          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <PeekField label="Customer" value={row.customerName} />
            <PeekField
              label="Order date"
              value={
                row.orderCreatedAt
                  ? new Date(row.orderCreatedAt).toLocaleDateString(undefined, {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })
                  : null
              }
            />
            <PeekField label="Delivery state" value={row.deliveryState} />
            <PeekField label="Product" value={row.productName} />
            <PeekField label="Amount" value={amount} />
            <PeekField label="External ID" value={row.externalId} className="sm:col-span-2" />
          </dl>

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            {row.orderId && (
              <Link to={`/admin/orders/${row.orderId}`}>
                <Button size="sm">Open full order</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function PeekField({
  label,
  value,
  className,
}: {
  label: string;
  value: string | null | undefined;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <dt className="text-xs font-medium text-app-fg-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-app-fg" title={value ?? undefined}>
        {value || '—'}
      </dd>
    </div>
  );
}
