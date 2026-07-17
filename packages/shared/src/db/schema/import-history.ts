import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';

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
