import {
  pgTable,
  text,
  uuid,
  numeric,
  integer,
  date,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';
import { branchGroups } from './branch-groups';
import {
  assetDepreciationMethodEnum,
  assetStatusEnum,
} from './enums';

// ============================================
// Fixed Asset Register & Depreciation
//
// Tracks company-owned physical assets (vehicles, IT equipment, furniture, etc.)
// with automated monthly depreciation that posts to the General Ledger.
// ============================================

/**
 * fixed_assets — the asset register. Each row is one physical asset owned by
 * the company. `accumulated_depreciation` is a running cache updated on each
 * depreciation run; authoritative figures are always derivable from
 * `depreciation_entries`.
 */
export const fixedAssets = pgTable('fixed_assets', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  assetName: text('asset_name').notNull(),
  assetCategory: text('asset_category').notNull(),
  acquisitionDate: date('acquisition_date').notNull(),
  cost: numeric('cost', { precision: 14, scale: 2 }).notNull(),
  residualValue: numeric('residual_value', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  usefulLifeMonths: integer('useful_life_months'),
  depreciationRate: numeric('depreciation_rate', { precision: 5, scale: 2 }),
  depreciationMethod: assetDepreciationMethodEnum('depreciation_method')
    .notNull()
    .default('STRAIGHT_LINE'),
  accumulatedDepreciation: numeric('accumulated_depreciation', {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default('0'),
  status: assetStatusEnum('status').notNull().default('ACTIVE'),
  location: text('location'),
  serialNumber: text('serial_number'),
  invoiceUrl: text('invoice_url'),
  disposalDate: date('disposal_date'),
  disposalProceeds: numeric('disposal_proceeds', { precision: 14, scale: 2 }),
  disposalGainLoss: numeric('disposal_gain_loss', { precision: 14, scale: 2 }),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * depreciation_entries — one row per asset per monthly depreciation run.
 * Forms the authoritative depreciation schedule; the parent asset's
 * `accumulated_depreciation` is a denormalised cache of SUM(depreciation_amount).
 */
export const depreciationEntries = pgTable('depreciation_entries', {
  id: uuidv7Pk(),
  fixedAssetId: uuid('fixed_asset_id')
    .notNull()
    .references(() => fixedAssets.id),
  postingDate: date('posting_date').notNull(),
  openingNbv: numeric('opening_nbv', { precision: 14, scale: 2 }).notNull(),
  depreciationAmount: numeric('depreciation_amount', {
    precision: 14,
    scale: 2,
  }).notNull(),
  closingNbv: numeric('closing_nbv', { precision: 14, scale: 2 }).notNull(),
  glVoucherId: uuid('gl_voucher_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
