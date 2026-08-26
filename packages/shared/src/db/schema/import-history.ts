import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns } from './helpers';
import { users } from './users';

// ============================================
// Import History — tracks every bulk import
// (orders, users, products, transfers, etc.)
// for audit and troubleshooting.
// ============================================

/**
 * import_batches — one row per bulk import operation.
 * Records who imported what, how many rows succeeded/failed,
 * and optional metadata (e.g. mediaBuyerId, csCloserId used).
 */
export const importBatches = pgTable('import_batches', {
  id: uuidv7Pk(),
  resourceType: text('resource_type').notNull(),
  fileName: text('file_name'),
  totalRows: integer('total_rows').notNull(),
  successCount: integer('success_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  createdBy: uuid('created_by').notNull(),
  branchId: uuid('branch_id'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ============================================
// Import Jobs — resumable, background large-file import
// (see migration 0332). Unlike import_batches (a post-hoc summary),
// this is a live job/progress record a @Cron worker drains in chunks,
// persisting a cursor so it can RESUME after a stop / error / restart.
// ============================================

export type ImportJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED';

/**
 * One flagged row, kept in error_log for the Retry Failed action + row viewer.
 *
 * `severity` distinguishes two outcomes:
 *  - 'error'   → the row was NOT imported (missing name/phone/product, etc.).
 *               Counts toward failedRows and is what Retry Failed re-runs.
 *  - 'warning' → the row WAS imported, but one or more display codes did not
 *               resolve (unknown media buyer / closer / branch). The field was
 *               left NULL; fix the code on the sheet and re-import to back-fill
 *               it (the upsert is idempotent). Does NOT count as a failure.
 * `severity` is optional for backward compatibility: a row with no severity is
 * treated as an 'error' (the original behaviour).
 */
export interface ImportRowFailure {
  row: number;
  externalId: string | null;
  reason: string;
  severity?: 'error' | 'warning';
  /** For warnings: which reference fields were left unresolved, and the raw code. */
  unresolved?: Array<{ field: 'mediaBuyer' | 'closer' | 'branch'; code: string }>;
}

/** Outcome of a single imported row. */
export type ImportRowStatus = 'IMPORTED' | 'WARNING' | 'FAILED';

/**
 * import_job_rows — one row per DATA row of an import file, recording that row's
 * outcome so the job page can list EVERY uploaded row (not just failures).
 *
 * TRANSIENT / non-audited by design: no _history twin, no temporal triggers (a
 * 100k-row import would otherwise double every write). ON DELETE CASCADE from
 * import_jobs. Upserted on (job_id, row_index) so resume/retry re-stamps a row
 * instead of duplicating. See migration 0336.
 */
export const importJobRows = pgTable('import_job_rows', {
  id: uuidv7Pk(),
  jobId: uuid('job_id')
    .notNull()
    .references(() => importJobs.id, { onDelete: 'cascade' }),
  /** 0-based index over data rows (matches import_jobs.cursor space). */
  rowIndex: integer('row_index').notNull(),
  status: text('status').$type<ImportRowStatus>().notNull(),
  externalId: text('external_id'),
  /** Reason for WARNING/FAILED; NULL for a clean IMPORTED row. */
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const importJobs = pgTable('import_jobs', {
  id: uuidv7Pk(),
  resourceType: text('resource_type').notNull().default('orders'),
  status: text('status').$type<ImportJobStatus>().notNull().default('PENDING'),
  fileUrl: text('file_url').notNull(),
  /** Object-storage key, used by the worker to download the file server-side. */
  fileKey: text('file_key'),
  fileName: text('file_name'),
  /** 'xlsx' | 'csv' */
  fileType: text('file_type'),
  /**
   * Column mapping + import options chosen in the UI: branchId, mediaBuyerId,
   * assignedCsId, targetStatus, header→field map, and which column holds the
   * unique external id. Consumed by the worker.
   */
  config: jsonb('config'),
  totalRows: integer('total_rows').notNull().default(0),
  processedRows: integer('processed_rows').notNull().default(0),
  failedRows: integer('failed_rows').notNull().default(0),
  /**
   * Resume cursor: 0-based row index the NEXT chunk starts from. On resume the
   * worker skips rows [0, cursor). Upserts make any re-touch idempotent.
   */
  cursor: integer('cursor').notNull().default(0),
  /** Per-row failures: ImportRowFailure[]. Capped in app code. */
  errorLog: jsonb('error_log').$type<ImportRowFailure[]>(),
  /** Last fatal/pause reason for the UI banner. */
  lastError: text('last_error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  branchId: uuid('branch_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  ...temporalColumns,
});
