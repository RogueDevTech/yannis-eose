import { uuid, pgTable, text, integer, numeric, timestamp } from 'drizzle-orm/pg-core';
import {
  stockStateEnum,
  movementTypeEnum,
  transferStatusEnum,
  remittanceStatusEnum,
  remittanceOutcomeStatusEnum,
} from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { products } from './products';
import { users } from './users';
import { logisticsLocations } from './logistics';

// Table 3: stock_batches — FIFO batch costing
export const stockBatches = pgTable('stock_batches', {
  id: uuidv7Pk(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  factoryCost: numeric('factory_cost', { precision: 12, scale: 2 }).notNull(),
  landingCost: numeric('landing_cost', { precision: 12, scale: 2 }).notNull(),
  totalLandedCost: numeric('total_landed_cost', { precision: 12, scale: 2 }).notNull(),
  quantity: integer('quantity').notNull(),
  remainingQuantity: integer('remaining_quantity').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 6: inventory_levels — stock tracked by location
export const inventoryLevels = pgTable('inventory_levels', {
  id: uuidv7Pk(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  locationId: uuid('location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  batchId: uuid('batch_id').references(() => stockBatches.id),
  stockCount: integer('stock_count').default(0).notNull(),
  reservedCount: integer('reserved_count').default(0).notNull(),
  status: stockStateEnum('status').default('AVAILABLE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 12: stock_movements — append-only inventory log
export const stockMovements = pgTable('stock_movements', {
  id: uuidv7Pk(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  movementType: movementTypeEnum('movement_type').notNull(),
  quantity: integer('quantity').notNull(),
  fromLocationId: uuid('from_location_id').references(() => logisticsLocations.id),
  toLocationId: uuid('to_location_id').references(() => logisticsLocations.id),
  referenceId: uuid('reference_id'),
  reason: text('reason'),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});

// Table 13: stock_transfers — warehouse-to-3PL transfers
export const stockTransfers = pgTable('stock_transfers', {
  id: uuidv7Pk(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  quantitySent: integer('quantity_sent').notNull(),
  quantityReceived: integer('quantity_received'),
  fromLocationId: uuid('from_location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  toLocationId: uuid('to_location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  transferStatus: transferStatusEnum('transfer_status').default('PENDING').notNull(),
  shrinkageReason: text('shrinkage_reason'),
  /** Optional free-text comment written by the receiver when marking received. */
  receiverNotes: text('receiver_notes'),
  transferCost: numeric('transfer_cost', { precision: 12, scale: 2 }),
  /**
   * Initiator — the actor who created the transfer row. Stored explicitly so PENDING
   * transfers (which have no TRANSFER_OUT movement yet) still surface a sender name
   * in the UI, and so approve/reject can notify the original initiator.
   */
  initiatedBy: uuid('initiated_by').references(() => users.id),
  /**
   * Approval audit — set when a non-source-authority initiated the transfer
   * and a source-authority then approved it. Source stock deducts at this point,
   * not at initiate. See CLAUDE.md → Transfer Approval Gate.
   */
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  /** Rejection audit — terminal state for PENDING rows that the source authority refuses. */
  rejectedBy: uuid('rejected_by').references(() => users.id),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  ...temporalColumns,
});

// Table: transfer_remittances — 3PL sends stock back to main warehouse (manual); receipt required; HoL marks received
export const transferRemittances = pgTable('transfer_remittances', {
  id: uuidv7Pk(),
  fromLocationId: uuid('from_location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  toLocationId: uuid('to_location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  quantitySent: integer('quantity_sent').notNull(),
  quantityReceived: integer('quantity_received'),
  receiptUrl: text('receipt_url').notNull(),
  status: remittanceStatusEnum('status').default('SENT').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  sentBy: uuid('sent_by')
    .notNull()
    .references(() => users.id),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  receivedBy: uuid('received_by').references(() => users.id),
  shrinkageReason: text('shrinkage_reason'),
  ...temporalColumns,
});

// Table: stock_transfer_outcomes — settlement lines for transfer receipt outcomes
export const stockTransferOutcomes = pgTable('stock_transfer_outcomes', {
  id: uuidv7Pk(),
  transferId: uuid('transfer_id')
    .notNull()
    .references(() => stockTransfers.id, { onDelete: 'cascade' }),
  status: remittanceOutcomeStatusEnum('status').notNull(),
  quantity: integer('quantity').notNull(),
  reason: text('reason'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  recordedBy: uuid('recorded_by')
    .notNull()
    .references(() => users.id),
  ...temporalColumns,
});
