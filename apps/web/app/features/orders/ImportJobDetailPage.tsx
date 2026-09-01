import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from '@remix-run/react';
import { symbolForCurrencyCode } from '@yannis/shared';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { InlineNotification } from '~/components/ui/inline-notification';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { ImportProgress } from './BulkImportPage';
import { FixImportRowModal } from './FixImportRowModal';
import {
  getImportJobStatus,
  resumeImportJob,
  retryFailedImportRows,
  pauseImportJob,
  listImportJobRows,
  getImportRowFacets,
  deleteImportJob,
  type ImportJob,
  type ImportJobRow,
  type ImportRowStatus,
  type ImportRowFacets,
} from './bulk-import-api';
import { useImportJobPoll } from '~/hooks/useImportJobPoll';

/** Statuses that stop the poll — nothing more will change without user action. */
const TERMINAL_STATUSES: ImportJob['status'][] = ['COMPLETED', 'FAILED'];

const ROW_STATUS_STYLES: Record<ImportRowStatus, { label: string; cls: string }> = {
  IMPORTED: { label: 'Imported', cls: 'bg-success-500/15 text-success-600 dark:text-success-400' },
  WARNING: { label: 'Warning', cls: 'bg-warning-500/15 text-warning-600 dark:text-warning-400' },
  FAILED: { label: 'Failed', cls: 'bg-danger-500/15 text-danger-600 dark:text-danger-400' },
};

/**
 * Which display column the failure reason blames, so the offending cell can be
 * highlighted while the fields that were fine render normally. Presentation only
 * — the server remains the authority on validity.
 */
type BlamedField = 'externalId' | 'customer' | 'product' | 'status' | 'amount' | null;

function blamedField(reason: string | null | undefined): BlamedField {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes('external id')) return 'externalId';
  if (r.includes('product')) return 'product';
  if (r.includes('status')) return 'status';
  if (r.includes('totalamount') || r.includes('unitprice') || r.includes('quantity')) return 'amount';
  if (r.includes('name') || r.includes('phone') || r.includes('email')) return 'customer';
  return null;
}

/**
 * A value read from the uploaded FILE rather than from an imported order.
 *
 * Failed rows have no order, so their columns would otherwise be dashes even
 * though the sheet held a perfectly good name, date and product. Showing the
 * source value tells the user what the row actually contained; the dotted
 * underline + muted italic keeps it visually distinct from a real imported
 * value, so nobody mistakes an unimported row for an imported one.
 */
function SourceValue({ value, blamed }: { value: string; blamed?: boolean }) {
  return (
    <span
      title={
        blamed
          ? `This is the field that blocked the row: ${value}`
          : `From the uploaded file: ${value}`
      }
      className={
        blamed
          ? 'font-medium text-danger-600 decoration-dotted underline underline-offset-2 dark:text-danger-400'
          : 'italic text-app-fg-muted decoration-dotted underline underline-offset-2'
      }
    >
      {value}
    </span>
  );
}

function RowStatusPill({ status }: { status: ImportRowStatus }) {
  const s = ROW_STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

/** Page-size choices for the rows table (mirrors the Audit / Orders lists). */
const ROW_PAGE_SIZE_OPTIONS = [20, 50, 100, 200, 500];
const ROW_PAGE_SIZE_DEFAULT = 100;

/** CS_ASSIGNED → "Cs assigned". Enough for a filter label. */
function humanStatus(s: string): string {
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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

  // ── Row listing ────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ImportJobRow[]>([]);
  const [rowTotal, setRowTotal] = useState(0);
  const [rowPage, setRowPage] = useState(1);
  const [rowLimit, setRowLimit] = useState(ROW_PAGE_SIZE_DEFAULT);
  const [rowStatusFilter, setRowStatusFilter] = useState<'' | ImportRowStatus>('');
  // Filters over the imported rows. Applied server-side (the row list is
  // paginated, so filtering client-side would only search the current page).
  const [rowSearch, setRowSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [facets, setFacets] = useState<ImportRowFacets | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  // True until the FIRST rows fetch settles. Without this the table rendered its
  // "No rows yet" empty state while the very first request was still in flight,
  // which reads as "the import produced nothing" rather than "still loading".
  const [rowsLoading, setRowsLoading] = useState(true);
  // A refetch (paging, filtering, or the poll) is in flight over rows we already
  // show. Dims the existing list instead of replacing it, so the table doesn't
  // blink empty every poll tick while an import is running.
  const [rowsRefetching, setRowsRefetching] = useState(false);
  const hasLoadedRowsRef = useRef(false);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Order peek ───────────────────────────────────────────────────────────
  // Tapping "View" on a row opens the imported order in a read-only modal
  // (built from the row data already loaded) instead of navigating away.
  const [peekRow, setPeekRow] = useState<ImportJobRow | null>(null);
  // Row whose failure/warning reason is open in the reason modal.
  const [reasonRow, setReasonRow] = useState<ImportJobRow | null>(null);
  /** The FAILED row currently open in the fix-and-resubmit modal. */
  const [fixRow, setFixRow] = useState<ImportJobRow | null>(null);

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
    // `hasLoadedRowsRef` (not `rows.length`) decides first-load vs refetch: an
    // empty first page is still a completed load, and a genuinely empty result
    // must be allowed to show the empty state.
    if (hasLoadedRowsRef.current) setRowsRefetching(true);
    try {
      const page = await listImportJobRows({
        jobId,
        page: rowPage,
        limit: rowLimit,
        ...(rowStatusFilter ? { status: rowStatusFilter } : {}),
        ...(rowSearch.trim() ? { search: rowSearch.trim() } : {}),
        ...(orderStatusFilter ? { orderStatus: orderStatusFilter } : {}),
        ...(reasonFilter ? { reasonKind: reasonFilter } : {}),
      });
      setRows(page.rows);
      setRowTotal(page.total);
      setRowsError(null);
    } catch (err) {
      setRowsError(err instanceof Error ? err.message : 'Failed to load rows.');
    } finally {
      hasLoadedRowsRef.current = true;
      setRowsLoading(false);
      setRowsRefetching(false);
    }
  }, [jobId, rowPage, rowLimit, rowStatusFilter, rowSearch, orderStatusFilter, reasonFilter]);

  // A different job is a fresh first load, not a refetch.
  useEffect(() => {
    hasLoadedRowsRef.current = false;
    setRowsLoading(true);
  }, [jobId]);

  // Initial job load.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load rows on mount + when paging/filter change.
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Facet counts for the filter chrome. Re-fetched whenever the job's counters
  // move, so "Failed (133)" stays truthful while an import is still running.
  useEffect(() => {
    let cancelled = false;
    getImportRowFacets(jobId)
      .then((f) => {
        if (!cancelled) setFacets(f);
      })
      .catch(() => {
        // Non-fatal: the filters still work, they just show no counts.
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, job?.processedRows, job?.failedRows]);

  // Reset to page 1 whenever any filter changes — otherwise a narrow filter can
  // land the user on a page number that no longer exists.
  useEffect(() => {
    setRowPage(1);
  }, [rowStatusFilter, rowSearch, orderStatusFilter, reasonFilter, rowLimit]);

  // Poll while the job is still active; refresh rows alongside so the list
  // fills in as chunks complete. `useImportJobPoll` keeps the timer alive across
  // dep changes (the job object is replaced on every tick, and `loadRows`
  // changes whenever the user pages or filters mid-import).
  const isPolling =
    !!job && !TERMINAL_STATUSES.includes(job.status) && job.status !== 'PAUSED';

  const pollTick = useCallback(async () => {
    await Promise.all([refresh(), loadRows()]);
  }, [refresh, loadRows]);

  useImportJobPoll(isPolling, pollTick);

  // Pause the running import from the page you're watching it on. Confirmed
  // first: the worker only stops at its next chunk boundary, so the click is not
  // instant, and the operator should know that before committing. Reversible via
  // Continue, hence the `warning` variant rather than `danger`.
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);

  const onConfirmPause = useCallback(async () => {
    setPausing(true);
    setPauseError(null);
    try {
      await pauseImportJob(jobId);
      await refresh();
      setPauseOpen(false);
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : 'Failed to pause this import.');
    } finally {
      setPausing(false);
    }
  }, [jobId, refresh]);

  // Continue restarts the worker from the saved cursor. It only moves FORWARD
  // (no re-processing), but it does start writing orders again, so it is
  // confirmed like the other job-level actions.
  const [continueOpen, setContinueOpen] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  const onConfirmContinue = useCallback(async () => {
    setContinuing(true);
    setContinueError(null);
    setError(null);
    try {
      await resumeImportJob(jobId);
      await refresh();
      setContinueOpen(false);
    } catch (err) {
      setContinueError(err instanceof Error ? err.message : 'Failed to continue.');
    } finally {
      setContinuing(false);
    }
  }, [jobId, refresh]);

  // Retry-failed re-streams the file from the FIRST failed row and re-upserts
  // everything from there, so it is a bulk re-import, not a per-row nudge. Ask
  // first — both from the header action and from a row's "Re-run to fix".
  const [retryOpen, setRetryOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const onConfirmRetryFailed = useCallback(async () => {
    setRetrying(true);
    setRetryError(null);
    setError(null);
    try {
      await retryFailedImportRows(jobId);
      await refresh();
      await loadRows();
      setRetryOpen(false);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Failed to retry.');
    } finally {
      setRetrying(false);
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

  const orderStatusOptions = useMemo(() => {
    const counts = facets?.byOrderStatus ?? {};
    return [
      { value: '', label: 'Any order status' },
      ...Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([st, n]) => ({ value: st, label: `${humanStatus(st)} (${n})` })),
    ];
  }, [facets]);

  const reasonOptions = useMemo(
    () => [
      { value: '', label: 'Any failure reason' },
      ...(facets?.reasons ?? []).map((r) => ({
        value: r.value,
        label: `${r.label} (${r.count})`,
      })),
    ],
    [facets],
  );

  const activeFilterCount =
    (rowStatusFilter ? 1 : 0) +
    (orderStatusFilter ? 1 : 0) +
    (reasonFilter ? 1 : 0) +
    (rowSearch.trim() ? 1 : 0);

  const clearAllFilters = useCallback(() => {
    setRowStatusFilter('');
    setOrderStatusFilter('');
    setReasonFilter('');
    setRowSearch('');
  }, []);

  const rowStatusOptions = useMemo(
    () => [
      { value: '', label: 'All rows' },
      { value: 'IMPORTED', label: 'Imported' },
      { value: 'WARNING', label: 'Warnings' },
      { value: 'FAILED', label: 'Failed' },
    ],
    [],
  );

  const rowTotalPages = Math.max(1, Math.ceil(rowTotal / rowLimit));

  /**
   * Row columns for `CompactTable`. Same cells the hand-rolled table rendered —
   * moving to the shared component gets column show/hide, the mobile card
   * layout, the sticky header and the per-page picker for free.
   */
  const rowColumns: CompactTableColumn<ImportJobRow>[] = useMemo(() => [
    {
      key: 'row',
      header: 'Row',
      // row_index is 0-based over DATA rows; +1 -> spreadsheet-style row number.
      render: (r) => <span className="tabular-nums text-app-fg-muted">{r.rowIndex + 1}</span>,
      hideable: false,
      tight: true,
    },
    {
      key: 'externalId',
      header: 'External ID',
      minWidth: 'min-w-[180px]',
      cellTitle: (r) => r.externalId ?? undefined,
      // The failure reason used to be printed under this cell, which made every
      // failed row two lines tall and buried the ID. It now lives behind the
      // info button on the Import column.
      render: (r) => (
        <span className="block truncate">
          {r.externalId
            ? r.externalId
            : r.sourceExternalId
              ? <SourceValue value={r.sourceExternalId} blamed />
              : '\u2014'}
        </span>
      ),
    },
    {
      key: 'order',
      header: 'Order',
      // Plain order number; the row's View action opens the peek modal.
      // Null for FAILED rows (no order was created).
      render: (r) =>
        r.orderId
          ? r.orderNumber != null
            ? <span className="tabular-nums text-app-fg">{`YNS-${r.orderNumber}`}</span>
            : '\u2014'
          : <span className="text-app-fg-muted">{'\u2014'}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      nowrap: true,
      // The imported order's date (from the sheet's date column if mapped).
      render: (r) =>
        r.orderCreatedAt
          ? new Date(r.orderCreatedAt).toLocaleDateString(undefined, {
              year: 'numeric', month: 'short', day: 'numeric',
            })
          : r.sourceDate
            ? <SourceValue value={r.sourceDate} />
            : '\u2014',
      cellClassName: 'text-app-fg-muted',
    },
    {
      key: 'customer',
      header: 'Customer',
      minWidth: 'min-w-[140px]',
      cellTitle: (r) => r.customerName ?? undefined,
      render: (r) =>
        r.customerName
          ? r.fromSource
            ? <SourceValue value={r.customerName} blamed={blamedField(r.reason) === 'customer'} />
            : r.customerName
          : '\u2014',
    },
    {
      key: 'product',
      header: 'Product',
      minWidth: 'min-w-[140px]',
      cellTitle: (r) => r.productName ?? r.sourceProduct ?? undefined,
      render: (r) =>
        r.productName
          ? r.productName
          : r.sourceProduct
            ? <SourceValue value={r.sourceProduct} blamed={blamedField(r.reason) === 'product'} />
            : '\u2014',
      cellClassName: 'text-app-fg-muted',
    },
    {
      key: 'orderStatus',
      header: 'Order status',
      // The imported order's own lifecycle status (Pending, etc.).
      render: (r) =>
        r.orderStatus ? (
          <OrderStatusBadge status={r.orderStatus} />
        ) : r.sourceStatus ? (
          <SourceValue value={r.sourceStatus} blamed={blamedField(r.reason) === 'status'} />
        ) : (
          <span className="text-app-fg-muted">{'\u2014'}</span>
        ),
    },
    {
      key: 'import',
      header: 'Import',
      // This row's import outcome (imported / warning / failed). A row that did
      // not import cleanly carries an info button that opens the full reason —
      // reasons are often long, so listing them inline pushed the table wide and
      // truncated the text anyway.
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <RowStatusPill status={r.status} />
          {r.reason && r.status !== 'IMPORTED' && (
            <button
              type="button"
              onClick={() => setReasonRow(r)}
              aria-label={`Why row ${r.rowIndex + 1} ${r.status === 'FAILED' ? 'failed' : 'has a warning'}`}
              title="See why"
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                r.status === 'FAILED'
                  ? 'text-danger-600 hover:bg-danger-500/15 dark:text-danger-400'
                  : 'text-warning-600 hover:bg-warning-500/15 dark:text-warning-400'
              }`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 11v5" />
                <path strokeLinecap="round" d="M12 7.75v.5" />
              </svg>
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'action',
      header: '',
      mobileLabel: 'Actions',
      mobileShowLabel: false,
      align: 'right',
      tight: true,
      hideable: false,
      render: (r) =>
        r.orderId ? (
          <TableActionButton variant="primary" onClick={() => setPeekRow(r)}>
            View
          </TableActionButton>
        ) : r.status === 'FAILED' ? (
          /* Every failed row is editable. Rows with a stored snapshot load
             instantly; older rows (failed before per-row values were captured)
             have their cells re-read from the uploaded file on open. */
          <TableActionButton variant="primary" onClick={() => setFixRow(r)}>
            Fix
          </TableActionButton>
        ) : (
          <span className="text-app-fg-muted">{'\u2014'}</span>
        ),
    },
  ], []);
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
          <ImportProgress
            job={job}
            onContinue={() => setContinueOpen(true)}
            onRetryFailed={() => setRetryOpen(true)}
            onPause={() => setPauseOpen(true)}
          />

          {/* Per-row listing */}
          <div className="rounded-lg border border-app-border bg-app-surface p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-app-fg">Rows</h3>
                <p className="text-xs text-app-fg-muted">
                  {/* Don't announce "0 rows" before the first fetch settles —
                      that reads as "the import produced nothing". */}
                  {rowsLoading
                    ? 'Loading rows…'
                    : activeFilterCount > 0
                      ? `${rowTotal.toLocaleString()} matching row${rowTotal === 1 ? '' : 's'}.`
                      : `${rowTotal.toLocaleString()} row${rowTotal === 1 ? '' : 's'} recorded so far.`}
                </p>
              </div>
            </div>

            {/* Filters. Applied server-side so they search the WHOLE import, not
                just the page on screen. Reason buckets only list causes that
                actually occurred in this job. */}
            <div className="mb-3">
              <ToolbarFiltersCollapsible
                badgeCount={activeFilterCount}
                onClearAll={activeFilterCount > 0 ? clearAllFilters : undefined}
                sheetTitle="Filter rows"
                searchRow={
                  <PageSearchControl
                    value={rowSearch}
                    onApply={setRowSearch}
                    title="Search rows"
                    placeholder="Search Order ID, customer, or order number"
                  />
                }
                desktopInlineFilters={
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <FormSelect
                      label="Import outcome"
                      value={rowStatusFilter}
                      onChange={(e) => setRowStatusFilter(e.target.value as '' | ImportRowStatus)}
                      options={rowStatusOptions}
                      controlSize="sm"
                    />
                    <FormSelect
                      label="Order status"
                      value={orderStatusFilter}
                      onChange={(e) => setOrderStatusFilter(e.target.value)}
                      options={orderStatusOptions}
                      controlSize="sm"
                    />
                    <FormSelect
                      label="Failure reason"
                      value={reasonFilter}
                      onChange={(e) => setReasonFilter(e.target.value)}
                      options={reasonOptions}
                      controlSize="sm"
                      disabled={reasonOptions.length <= 1}
                    />
                  </div>
                }
              />
            </div>

            {rowsError && <InlineNotification variant="danger" message={rowsError} />}

            <CompactTable<ImportJobRow>
              withCard={false}
              // Skeleton rows on the very first load; a dimming overlay for
              // paging / filtering / poll refetches so the visible list stays put.
              loading={rowsLoading || rowsRefetching}
              loadingVariant={rowsLoading ? 'skeleton' : 'overlay'}
              columnVisibilityKey="admin.data.import.jobRows"
              columns={rowColumns}
              rows={rows}
              rowKey={(r) => String(r.rowIndex)}
              emptyTitle={activeFilterCount > 0 ? 'No rows match these filters' : 'No rows yet'}
              emptyDescription={
                activeFilterCount > 0
                  ? 'Try clearing a filter or widening your search.'
                  : job.status === 'PENDING' || job.status === 'PROCESSING'
                    ? 'No rows processed yet. This list fills in as the import runs.'
                    : 'No rows recorded for this import.'
              }
              pagination={{
                page: rowPage,
                totalPages: rowTotalPages,
                onPageChange: setRowPage,
                pageSize: rowLimit,
                pageSizeOptions: ROW_PAGE_SIZE_OPTIONS,
                onPageSizeChange: setRowLimit,
                showWhenSinglePage: true,
                summary: rowTotal > 0 ? (
                  <span className="text-xs text-app-fg-muted">
                    Showing {(rowPage - 1) * rowLimit + 1}
                    {'\u2013'}
                    {Math.min(rowPage * rowLimit, rowTotal)} of {rowTotal}
                  </span>
                ) : undefined,
                wrapperClassName: 'mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
                controlsClassName: 'sm:justify-end',
              }}
            />
          </div>
        </>
      )}

      <ConfirmActionModal
        open={continueOpen}
        onClose={() => {
          if (continuing) return;
          setContinueOpen(false);
          setContinueError(null);
        }}
        title="Continue this import?"
        description={
          job
            ? `The import restarts from row ${job.cursor.toLocaleString()} and works through the rest of the file.`
            : 'The import restarts from where it stopped and works through the rest of the file.'
        }
        details={
          <ul className="list-disc space-y-1 pl-4">
            <li>Rows already imported are not touched: it only moves forward.</li>
            <li>New orders start being created again as soon as it resumes.</li>
          </ul>
        }
        confirmLabel="Continue import"
        variant="warning"
        loading={continuing}
        error={continueError}
        onConfirm={onConfirmContinue}
      />

      <ConfirmActionModal
        open={retryOpen}
        onClose={() => {
          if (retrying) return;
          setRetryOpen(false);
          setRetryError(null);
        }}
        title="Re-run the failed rows?"
        description={
          job && job.failedRows > 0
            ? `The import restarts from the first failed row and re-processes everything from there, including the ${job.failedRows.toLocaleString()} failed row${job.failedRows === 1 ? '' : 's'}.`
            : 'The import restarts from the first failed row and re-processes everything from there.'
        }
        details={
          <ul className="list-disc space-y-1 pl-4">
            <li>Rows that already imported are re-saved with the same values, not duplicated.</li>
            <li>Rows still failing stay failed, with their reason updated.</li>
            <li>Fix the underlying data first (product, user or currency codes), or they will fail again.</li>
          </ul>
        }
        confirmLabel="Re-run failed rows"
        variant="warning"
        loading={retrying}
        error={retryError}
        onConfirm={onConfirmRetryFailed}
      />

      <ConfirmActionModal
        open={pauseOpen}
        onClose={() => {
          if (pausing) return;
          setPauseOpen(false);
          setPauseError(null);
        }}
        title="Pause this import?"
        description={
          job?.fileName
            ? `"${job.fileName}" will stop at the end of the row it is currently working on, not instantly.`
            : 'This import will stop at the end of the row it is currently working on, not instantly.'
        }
        details={
          <ul className="list-disc space-y-1 pl-4">
            <li>Rows already imported stay imported. Nothing is rolled back.</li>
            <li>Continue picks up from the exact row it stopped on, with no duplicates.</li>
          </ul>
        }
        confirmLabel="Pause import"
        variant="warning"
        loading={pausing}
        error={pauseError}
        onConfirm={onConfirmPause}
      />

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
      <RowReasonModal row={reasonRow} onClose={() => setReasonRow(null)} />

      {/* Correct a FAILED row and import it in place. On success we refresh both
          the job (counters) and the row list so the row flips to Imported. */}
      <FixImportRowModal
        open={fixRow != null}
        jobId={jobId}
        row={fixRow}
        onClose={() => setFixRow(null)}
        onFixed={() => {
          void refresh();
          void loadRows();
        }}
      />
    </div>
  );
}

/**
 * Read-only peek at an imported order, built from the row data already loaded
 * (no extra fetch). Shows the key fields so the user can eyeball the import
 * without leaving the page, with a link to the full order detail. Customer
 * phone is intentionally absent — raw phones never leave the API (Pillar 2).
 */
/**
 * Why a row did not import cleanly. Opened from the red (failed) / amber
 * (warning) info button on the Import column, so the reason text does not have
 * to be squeezed into a table cell where it was truncated anyway.
 */
function RowReasonModal({ row, onClose }: { row: ImportJobRow | null; onClose: () => void }) {
  if (!row) return null;
  const failed = row.status === 'FAILED';
  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" contentClassName="p-5" aria-labelledby="row-reason-title">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            failed
              ? 'bg-danger-500/15 text-danger-600 dark:text-danger-400'
              : 'bg-warning-500/15 text-warning-600 dark:text-warning-400'
          }`}
          aria-hidden
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 11v5" />
            <path strokeLinecap="round" d="M12 7.75v.5" />
          </svg>
        </span>
        <div className="min-w-0">
          <h3 id="row-reason-title" className="text-sm font-semibold text-app-fg">
            {failed ? 'This row failed' : 'Imported with a warning'}
          </h3>
          <p className="mt-0.5 text-xs text-app-fg-muted">
            {/* rowIndex is 0-based over data rows; +1 matches the Row column. */}
            Row {row.rowIndex + 1}
            {row.externalId ? ` \u00b7 ${row.externalId}` : ''}
          </p>
        </div>
      </div>

      {/* `break-words` because reasons can carry long unbroken tokens (ids,
          codes) that would otherwise overflow the dialog. */}
      <p className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-app-hover p-3 text-sm text-app-fg">
        {row.reason}
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

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
