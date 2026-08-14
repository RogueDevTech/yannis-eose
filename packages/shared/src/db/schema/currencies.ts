import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, boolean, integer, numeric, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { branchGroups } from './branch-groups';

/**
 * currencies — per-group ("company") currency + country config.
 *
 * The whole multi-currency feature stays DORMANT until a group has a 2nd ACTIVE
 * currency. With only the seeded NGN default, `hasMultipleCurrencies()` is false
 * and no operational UI changes anywhere.
 *
 * FX (`fxRateToBase`) is a REPORTING LENS ONLY (ROAS / future consolidation). It
 * NEVER converts stored operational money — an order in GHS stays GHS, cash in
 * GHS stays GHS. Direction: 1 unit of THIS currency = `fxRateToBase` units of the
 * group's DEFAULT (base) currency. The base row is 1. NULL until an admin sets it
 * → ratio metrics render "Set FX rate" instead of a wrong number.
 *
 * group_id NULL = legacy/global fallback (mirrors system_settings).
 */
export const currencies = pgTable('currencies', {
  id: uuidv7Pk(),
  /** Branch group ("company") this currency belongs to. NULL = legacy/global. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  /** ISO 4217, e.g. 'NGN', 'GHS'. Unique per group. */
  code: text('code').notNull(),
  /** Display symbol, e.g. '₦', 'GH₵'. */
  symbol: text('symbol').notNull(),
  /** Country label paired with this currency, e.g. 'Nigeria', 'Ghana'. */
  countryName: text('country_name').notNull(),
  /** Decimal places for display/formatting. */
  precision: integer('precision').notNull().default(2),
  /** The group's base currency. Exactly one per group (partial unique index). */
  isDefault: boolean('is_default').notNull().default(false),
  /** Deactivated currencies stop appearing in dropdowns but keep historical rows valid. */
  active: boolean('active').notNull().default(true),
  /** 1 unit of THIS currency = N base-currency units. NULL until set. Base = 1. */
  fxRateToBase: numeric('fx_rate_to_base', { precision: 18, scale: 6 }),
  fxRateUpdatedAt: timestamp('fx_rate_updated_at', { withTimezone: true }),
  fxRateUpdatedBy: uuid('fx_rate_updated_by').references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
}, (t) => ({
  // COALESCE the group to a sentinel so NULL-group rows are deduplicated too
  // (SQL treats NULL as DISTINCT in unique indexes). Matches migration 0316.
  uniqGroupCode: uniqueIndex('currencies_group_code_uniq').on(
    sql`COALESCE(${t.groupId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    t.code,
  ),
  uniqGroupDefault: uniqueIndex('currencies_group_default_uniq')
    .on(sql`COALESCE(${t.groupId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
    .where(sql`is_default`),
  groupActiveIdx: index('currencies_group_active_idx').on(t.groupId, t.active),
}));

export type Currency = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;
