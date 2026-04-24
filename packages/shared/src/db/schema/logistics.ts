import { pgTable, text, jsonb, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { recordStatusEnum, reconciliationStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';

// Table 4: logistics_providers
export const logisticsProviders = pgTable('logistics_providers', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  contactInfo: text('contact_info'),
  coverageArea: text('coverage_area'),
  rateCard: jsonb('rate_card'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 5: logistics_locations
export const logisticsLocations = pgTable('logistics_locations', {
  id: uuidv7Pk(),
  providerId: text('provider_id')
    .notNull()
    .references(() => logisticsProviders.id),
  name: text('name').notNull(),
  address: text('address').notNull(),
  coordinates: text('coordinates'),
  dispatchLocked: boolean('dispatch_locked').default(false).notNull(),
  /**
   * Optional WhatsApp group invite link used by the CS "Share to 3PL" flow.
   * When set, CS can click a button on an allocated order that (a) copies the
   * rendered dispatch message to clipboard and (b) opens this group link in a new tab.
   * Group invites cannot be pre-filled with text (WhatsApp platform limit), so the
   * copy + open pattern is the best one-click UX available.
   */
  whatsappGroupLink: text('whatsapp_group_link'),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table: stock_reconciliations — Ghost Stock Prevention
export const stockReconciliations = pgTable('stock_reconciliations', {
  id: uuidv7Pk(),
  locationId: text('location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  digitalCount: integer('digital_count').notNull(),
  physicalCount: integer('physical_count').notNull(),
  discrepancy: integer('discrepancy').notNull(),
  reasonCode: text('reason_code').notNull(),
  notes: text('notes'),
  reconciliationStatus: reconciliationStatusEnum('reconciliation_status').default('PENDING').notNull(),
  submittedBy: text('submitted_by')
    .notNull()
    .references(() => users.id),
  approvedBy: text('approved_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...temporalColumns,
});
