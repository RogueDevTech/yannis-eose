import { uuid, pgTable, text, jsonb, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { recordStatusEnum, reconciliationStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { branchGroups } from './branch-groups';

// Table 4: logistics_providers
export const logisticsProviders = pgTable('logistics_providers', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  contactInfo: text('contact_info'),
  coverageArea: text('coverage_area'),
  rateCard: jsonb('rate_card'),
  /**
   * Discriminator — `THIRD_PARTY` (default; external 3PL companies) or
   * `WAREHOUSE` (company-owned facilities / “our warehouses”, managed via `/admin/inventory/warehouses`).
   * Migration 0114 adds the column with a CHECK constraint enforcing these two values.
   */
  kind: text('kind').default('THIRD_PARTY').notNull(),
  /** Company-group isolation. NULL = legacy/global (backfilled to default group). */
  groupId: uuid('group_id').references(() => branchGroups.id),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 5: logistics_locations
export const logisticsLocations = pgTable('logistics_locations', {
  id: uuidv7Pk(),
  providerId: uuid('provider_id')
    .notNull()
    .references(() => logisticsProviders.id),
  name: text('name').notNull(),
  address: text('address').notNull(),
  coordinates: text('coordinates'),
  // Branch this location belongs to (added in migration 0041, later converted to uuid).
  branchId: uuid('branch_id'),
  dispatchLocked: boolean('dispatch_locked').default(false).notNull(),
  /**
   * Optional WhatsApp group invite link used by the CS "Share to logistics company" flow.
   * When set, CS can click a button on an allocated order that (a) copies the
   * rendered dispatch message to clipboard and (b) opens this group link in a new tab.
   * Group invites cannot be pre-filled with text (WhatsApp platform limit), so the
   * copy + open pattern is the best one-click UX available.
   */
  whatsappGroupLink: text('whatsapp_group_link'),
  /**
   * Per-location low-stock alert threshold (units). NULL = inherit the org-wide
   * threshold (`system_settings.INVENTORY_LOW_STOCK_CONFIG.threshold`). Effective
   * threshold for any (product, location) = COALESCE(this, global).
   */
  lowStockThreshold: integer('low_stock_threshold'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table: stock_reconciliations — Ghost Stock Prevention
export const stockReconciliations = pgTable('stock_reconciliations', {
  id: uuidv7Pk(),
  locationId: uuid('location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  digitalCount: integer('digital_count').notNull(),
  physicalCount: integer('physical_count').notNull(),
  discrepancy: integer('discrepancy').notNull(),
  reasonCode: text('reason_code').notNull(),
  notes: text('notes'),
  reconciliationStatus: reconciliationStatusEnum('reconciliation_status').default('PENDING').notNull(),
  submittedBy: uuid('submitted_by')
    .notNull()
    .references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...temporalColumns,
});
