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
}

export interface ImportJobRowsPage {
  rows: ImportJobRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Paginated per-row outcomes for a job. Optional status filter. */
export function listImportJobRows(input: {
  jobId: string;
  page?: number;
  limit?: number;
  status?: ImportRowStatus;
}): Promise<ImportJobRowsPage> {
  return trpcQuery('bulkImport.listRows', input);
}

/** Delete an import job + its row records (does NOT delete imported orders). */
export function deleteImportJob(jobId: string): Promise<{ ok: boolean }> {
  return trpcMutation('bulkImport.delete', { jobId });
}

export function resumeImportJob(jobId: string): Promise<{ ok: boolean }> {
  return trpcMutation('bulkImport.resume', { jobId });
}

export function retryFailedImportRows(jobId: string): Promise<{ ok: boolean }> {
  return trpcMutation('bulkImport.retryFailed', { jobId });
}
