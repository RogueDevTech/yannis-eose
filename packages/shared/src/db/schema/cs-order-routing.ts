import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { branches } from './branches';
import { branchTeams } from './branch-teams';
import { products } from './products';
import { csOrderRoutingStrategyEnum, csRoutingRelationshipModeEnum } from './enums';
import { uuidv7Pk, timestampColumns, temporalColumns } from './helpers';

/**
 * Per-branch CS auto-dispatch routing: match orders (by owning branch + optional product)
 * to servicing-branch pools (optional CS squad) using EQUAL or WEIGHTED selection.
 *
 * `owner_branch_id` matches `orders.branch_id` at dispatch time (marketing/campaign branch).
 */
export const csOrderRoutingRules = pgTable('cs_order_routing_rules', {
  id: uuidv7Pk(),
  ownerBranchId: uuid('owner_branch_id')
    .notNull()
    .references(() => branches.id),
  /** When null, rule applies to any product (catch-all) after more specific rules. */
  productId: uuid('product_id').references(() => products.id),
  /**
   * Multi-country (mig 0331): match the order's currency/country. When null, the
   * rule applies to ANY country (catch-all) after more country-specific rules.
   * This is where "Ghana orders → Ghana servicing branch" is configured.
   * Order country = orders.currency_code.
   */
  currencyCode: text('currency_code'),
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  strategy: csOrderRoutingStrategyEnum('strategy').notNull().default('EQUAL'),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * Super Admin chooses relationship mode per funnel branch before editing rules.
 * Drives which rows apply at dispatch and which product_id shapes are allowed on create.
 */
export const csOrderRoutingBranchSettings = pgTable('cs_order_routing_branch_settings', {
  ownerBranchId: uuid('owner_branch_id')
    .primaryKey()
    .references(() => branches.id, { onDelete: 'cascade' }),
  relationshipMode: csRoutingRelationshipModeEnum('relationship_mode').notNull().default('BRANCH_DEFAULT'),
  ...temporalColumns,
  ...timestampColumns,
});

export const csOrderRoutingRuleTargets = pgTable('cs_order_routing_rule_targets', {
  id: uuidv7Pk(),
  ruleId: uuid('rule_id')
    .notNull()
    .references(() => csOrderRoutingRules.id, { onDelete: 'cascade' }),
  /** Where CS capacity is drawn from (may differ from rule owner / order attribution branch). */
  servicingBranchId: uuid('servicing_branch_id')
    .notNull()
    .references(() => branches.id),
  /** When set, eligibles must be CS_CLOSER members of this CS squad on `servicing_branch_id`. When null, any CS_CLOSER on that branch (via user_branches). */
  teamId: uuid('team_id').references(() => branchTeams.id, { onDelete: 'cascade' }),
  /** Used when strategy = WEIGHTED; minimum 1 at validation time. */
  weight: integer('weight').notNull().default(1),
  ...temporalColumns,
  ...timestampColumns,
});
