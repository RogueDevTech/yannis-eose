import { pgTable, text, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { userRoleEnum, recordStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { products } from './products';

// Table 1: users
export const users = pgTable('users', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull(),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  capacity: integer('capacity').default(10).notNull(),
  // Links TPL_MANAGER and TPL_RIDER to their logistics location.
  // NULL for non-logistics roles.
  logisticsLocationId: text('logistics_location_id'),
  // Staff WhatsApp/phone number. ALWAYS masked in API responses (Lead Fortress).
  phone: text('phone'),
  // Array of order status strings this user can see (CS agents).
  visibleOrderStatuses: jsonb('visible_order_statuses').$type<string[]>(),
  // Limit user to only their assigned products.
  restrictProductAccess: boolean('restrict_product_access').default(false).notNull(),
  // Optional FK to commission_plans for compensation settings.
  commissionPlanId: text('commission_plan_id'),
  // Last time this agent took any action (CS_ENGAGED, CONFIRMED, etc.)
  // Used for dispatch tiebreaker and inactivity detection.
  lastActionAt: timestamp('last_action_at', { withTimezone: true }),
  /** Default branch for this user. NULL for SuperAdmin (bypasses branch RLS). */
  primaryBranchId: text('primary_branch_id'),
  /** Explicit appearance theme; NULL = use org default from `client_ui_config`. */
  appTheme: text('app_theme'),
  ...temporalColumns,
  ...timestampColumns,
});

// Email change requests — require SuperAdmin approval before taking effect
export const emailChangeRequests = pgTable('email_change_requests', {
  id: uuidv7Pk(),
  userId: text('user_id').notNull().references(() => users.id),
  requestedNewEmail: text('requested_new_email').notNull(),
  requesterId: text('requester_id').notNull().references(() => users.id),
  status: text('status').default('PENDING').notNull(),
  approverId: text('approver_id').references(() => users.id),
  approvalReason: text('approval_reason'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  ...temporalColumns,
  ...timestampColumns,
});

// Junction table: which products a user is assigned to work on
export const userProductAssignments = pgTable('user_product_assignments', {
  id: uuidv7Pk(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  ...temporalColumns,
  ...timestampColumns,
});
