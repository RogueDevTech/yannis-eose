import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';

/**
 * Thin browser client for the resumable bulk-import tRPC procedures. Uses the
 * absolute API base + credentials:'include' (prod runs web and api on separate
 * hosts — see MEMORY project_browser_trpc_fetch_api_base).
 */

export type ImportJobStatus = 'PENDING' | 'PROCESSING' | 'PAUSED' | 'COMPLETED' | 'FAILED';

export interface ImportRowFailure {
  row: number;
  externalId: string | null;
  reason: string;
}

export interface ImportJob {
  id: string;
  status: ImportJobStatus;
  fileName: string | null;
  totalRows: number;
  processedRows: number;
  failedRows: number;
  cursor: number;
  errorLog: ImportRowFailure[] | null;
  lastError: string | null;
  /** Operator pause requested; the worker stops at the next chunk boundary. */
  pauseRequested?: boolean;
  createdAt: string;
  finishedAt: string | null;
}

export interface ImportJobConfig {
  // Optional: branch is derived per row from the media buyer / CS closer.
  branchId?: string;
  // Stamped server-side from the creator's active company.
  groupId?: string | null;
  mediaBuyerId?: string | null;
  assignedCsId?: string | null;
  targetStatus: string;
  externalIdColumn: string;
  columnMap: {
    customerName: string;
    customerPhone: string;
    customerAddress?: string;
    deliveryState?: string;
    totalAmount?: string;
    createdAt?: string;
    productId?: string;
    quantity?: string;
    unitPrice?: string;
    offerLabel?: string;
    // Per-row status label header (Confirmed / Delivered / Pending…). Parsed
    // server-side; blank/unknown falls back to the job's targetStatus.
    status?: string;
    // Display-code columns resolved to UUIDs server-side (PDT-N / USR-N). Branch
    // is derived from the MB / CS user, never taken from the sheet.
    productCode?: string;
    mediaBuyerCode?: string;
    closerCode?: string;
    currency?: string;
  };
  defaultProductId?: string;
  defaultQuantity?: number;
  defaultUnitPrice?: number;
}

async function trpcMutation<T>(proc: string, input: unknown): Promise<T> {
  const res = await fetch(`${getBrowserApiBaseUrl()}/trpc/${proc}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as {
    result?: { data?: T };
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Request failed (${proc})`);
  }
  return json.result?.data as T;
}

async function trpcQuery<T>(proc: string, input: unknown): Promise<T> {
  const url = `${getBrowserApiBaseUrl()}/trpc/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { credentials: 'include' });
  const json = (await res.json().catch(() => ({}))) as {
    result?: { data?: T };
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Request failed (${proc})`);
  }
  return json.result?.data as T;
}

export function createImportJob(input: {
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileType: 'xlsx' | 'csv';
  /** Client-counted data rows, shown as TOTAL until the worker recomputes it. */
  totalRows?: number;
  config: ImportJobConfig;
}): Promise<{ id: string }> {
  return trpcMutation('bulkImport.createJob', input);
}

export function getImportJobStatus(jobId: string): Promise<ImportJob> {
  return trpcQuery('bulkImport.getStatus', { jobId });
}

/** Recent import jobs for the history table (newest first). */
export function listImportJobs(limit = 20): Promise<ImportJob[]> {
  return trpcQuery('bulkImport.list', { limit });
}

export type ImportRowStatus = 'IMPORTED' | 'WARNING' | 'FAILED';

export interface ImportJobRow {
  rowIndex: number;
  status: ImportRowStatus;
  externalId: string | null;
  reason: string | null;
  // The imported order joined by external id (null for FAILED rows / no match).
  // Phone is intentionally omitted (Pillar 2 — raw phones never leave the API).
  orderId: string | null;
  orderNumber: number | null;
  customerName: string | null;
  deliveryState: string | null;
  totalAmount: string | null;
  currencyCode: string | null;
  orderStatus: string | null;
  productName: string | null;
  /** The imported order's date (ISO). Reflects the sheet date column if mapped. */
  orderCreatedAt: string | null;
  /**
   * True when this FAILED row still has its original source cells stored, so it
   * can be opened, fixed and resubmitted in place. False for rows that imported
   * cleanly, and for failures from before migration 0339 (no snapshot kept).
   */
  hasRawData?: boolean;
  /**
   * For FAILED rows: the source cells shown in place of the (non-existent)
   * order's values, so the row isn't a wall of dashes. `fromSource` is true when
   * the visible values came from the file rather than an imported order.
   */
  fromSource?: boolean;
  sourceProduct?: string | null;
  sourceDate?: string | null;
  sourceStatus?: string | null;
  /** The sheet's Order ID cell, when the row failed because the id was blank. */
  sourceExternalId?: string | null;
}

/** The header→field mapping chosen at upload time. */
export interface ImportColumnMap {
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  deliveryState?: string;
  totalAmount?: string;
  createdAt?: string;
  quantity?: string;
  unitPrice?: string;
  status?: string;
  productCode?: string;
  mediaBuyerCode?: string;
  closerCode?: string;
  currency?: string;
}

/** One row plus the source cells kept when it failed. */
export interface ImportJobRowDetail {
  rowIndex: number;
  status: ImportRowStatus;
  externalId: string | null;
  reason: string | null;
  /** Source cells keyed by the file's own header names. Null if unrecoverable. */
  rawData: Record<string, string> | null;
  /**
   * True when the cells were re-read from the uploaded file rather than a stored
   * snapshot (rows that failed before per-row values were captured).
   */
  recoveredFromFile?: boolean;
  columnMap: ImportColumnMap | null;
  externalIdColumn: string | null;
}

/** Valid values the fix form may offer, scoped to the job's company + country. */
export interface ImportRowOptions {
  products: Array<{ code: string; name: string }>;
  users: Array<{ code: string; name: string; role: string }>;
  currencies: Array<{ code: string; countryName: string | null }>;
  statuses: Array<{ label: string; status: string }>;
}

export interface ImportJobRowsPage {
  rows: ImportJobRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Counts behind the job page's filters. */
export interface ImportRowFacets {
  /** IMPORTED / WARNING / FAILED → count. */
  byStatus: Record<string, number>;
  /** The imported orders' own lifecycle statuses → count. */
  byOrderStatus: Record<string, number>;
  /** Failure-reason buckets that actually have rows. */
  reasons: Array<{ value: string; label: string; count: number }>;
}

export function getImportRowFacets(jobId: string): Promise<ImportRowFacets> {
  return trpcQuery('bulkImport.rowFacets', { jobId });
}

/** Paginated per-row outcomes for a job, with optional filters. */
export function listImportJobRows(input: {
  jobId: string;
  page?: number;
  limit?: number;
  status?: ImportRowStatus;
  /** Free text over external id, customer name, order number. */
  search?: string;
  /** The imported order's own lifecycle status. */
  orderStatus?: string;
  /** Failure-reason bucket. */
  reasonKind?: string;
}): Promise<ImportJobRowsPage> {
  return trpcQuery('bulkImport.listRows', input);
}

/** One failed row with its original cells, for the fix-and-resubmit form. */
export function getImportJobRow(jobId: string, rowIndex: number): Promise<ImportJobRowDetail> {
  return trpcQuery('bulkImport.getRow', { jobId, rowIndex });
}

/** Products / users / currencies / statuses this job can actually resolve. */
export function getImportRowOptions(jobId: string): Promise<ImportRowOptions> {
  return trpcQuery('bulkImport.getRowOptions', { jobId });
}

/**
 * Re-import one corrected row. Resolves to `{ ok: false, reason }` when the row
 * still fails validation, so the form can show the next problem inline.
 */
export function resubmitImportRow(input: {
  jobId: string;
  rowIndex: number;
  values: Record<string, string>;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  return trpcMutation('bulkImport.resubmitRow', input);
}

/** Delete an import job + its row records (does NOT delete imported orders). */
export function deleteImportJob(jobId: string): Promise<{ ok: boolean }> {
  return trpcMutation('bulkImport.delete', { jobId });
}

export function resumeImportJob(jobId: string): Promise<{ ok: boolean }> {
  return trpcMutation('bulkImport.resume', { jobId });
}

/**
 * Ask the worker to stop this job. A PROCESSING job stops at its next chunk
 * boundary, so `pending: true` means "requested, not yet stopped".
 */
export function pauseImportJob(jobId: string): Promise<{ ok: boolean; pending: boolean }> {
  return trpcMutation('bulkImport.pause', { jobId });
}

export function retryFailedImportRows(jobId: string): Promise<{ ok: boolean }> {
  return trpcMutation('bulkImport.retryFailed', { jobId });
}
