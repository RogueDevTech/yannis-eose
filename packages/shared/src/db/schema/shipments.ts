import {
  uuid,
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  serial,
} from 'drizzle-orm/pg-core';
import { shipmentStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { products } from './products';
import { users } from './users';
import { logisticsLocations } from './logistics';
import { stockBatches } from './inventory';

/**
 * Inbound shipment from a supplier into a destination warehouse.
 *
 * One shipment carries N SKUs (`shipment_lines`) under one freight/duty/clearing
 * cost. Verification on arrival writes a `stock_batches` row + upserts
 * `inventory_levels` + logs an `INTAKE` movement per line — atomically inside
 * one `withActorAndBranch` transaction. See CLAUDE.md → "Shipment Lifecycle".
 *
 * Branch context is inferred from `destination_location_id → logistics_locations.branch_id`
 * — no separate `branch_id` column on this table.
 */
export const shipments = pgTable('shipments', {
  id: uuidv7Pk(),
  /**
   * Sequential reference number — surfaced as `SHIP-YYYY-XXXX` at read time.
   * Mirrors the invoice numbering pattern (`finance.service.ts::formatReference`).
   */
  referenceNumber: serial('reference_number').notNull().unique(),
  /** Optional human label so ops can write "Lagos container, ETA May 12". */
  label: text('label'),
  status: shipmentStatusEnum('status').default('CREATED').notNull(),
  /** Destination warehouse — required, one per shipment. */
  destinationLocationId: uuid('destination_location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  /** Supplier name (free-text for v1; no separate suppliers table yet). */
  supplierName: text('supplier_name'),
  /** Bill of lading / waybill / supplier invoice number. */
  supplierReference: text('supplier_reference'),
  expectedArrivalAt: timestamp('expected_arrival_at', { withTimezone: true }),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  /** Total freight + duty + clearing for the whole shipment, allocated to lines on VERIFY. */
  totalLandingCost: numeric('total_landing_cost', { precision: 14, scale: 2 })
    .default('0')
    .notNull(),
  cancelledReason: text('cancelled_reason'),
  verifiedBy: uuid('verified_by').references(() => users.id),
  closedBy: uuid('closed_by').references(() => users.id),
  cancelledBy: uuid('cancelled_by').references(() => users.id),
  notes: text('notes'),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * One row per SKU on a shipment. `received_quantity` and `allocated_landing_cost`
 * are populated on VERIFY; `batch_id` links the line to the `stock_batches` row
 * it produced so the FIFO trail traces back to the receipt.
 */
export const shipmentLines = pgTable('shipment_lines', {
  id: uuidv7Pk(),
  shipmentId: uuid('shipment_id')
    .notNull()
    .references(() => shipments.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  expectedQuantity: integer('expected_quantity').notNull(),
  /** Set on VERIFY — what physically arrived. */
  receivedQuantity: integer('received_quantity'),
  factoryCost: numeric('factory_cost', { precision: 12, scale: 2 }).notNull(),
  /** Per-line slice of `shipments.total_landing_cost`, computed on VERIFY. */
  allocatedLandingCost: numeric('allocated_landing_cost', { precision: 12, scale: 2 }),
  /** Backref to the FIFO batch produced on VERIFY. */
  batchId: uuid('batch_id').references(() => stockBatches.id),
  /** Short-ship / over-ship / damage narrative. Required when received != expected. */
  varianceReason: text('variance_reason'),
  ...temporalColumns,
  ...timestampColumns,
});
