import { uuid, pgTable, text, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
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
  /**
   * Optional pointer to a permission template row (`role_templates`).
   * Effective permissions are computed from template grants + `user_permissions` overrides.
   */
  roleTemplateId: uuid('role_template_id'),
  /**
   * Explicit access-scope flags (permission-first RBAC).
   * These replace implicit "org-wide head" behavior over time.
   */
  scopeGlobal: boolean('scope_global').default(false).notNull(),
  scopeOrgWideHead: boolean('scope_org_wide_head').default(false).notNull(),
  scopeTeamSupervisor: boolean('scope_team_supervisor').default(false).notNull(),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  capacity: integer('capacity').default(10).notNull(),
  // Links TPL_MANAGER and TPL_RIDER to their logistics location.
  // NULL for non-logistics roles.
  logisticsLocationId: uuid('logistics_location_id'),
  // Staff WhatsApp/phone number. ALWAYS masked in API responses (Lead Fortress).
  phone: text('phone'),
  // Array of order status strings this user can see (Sales closers).
  visibleOrderStatuses: jsonb('visible_order_statuses').$type<string[]>(),
  // Limit user to only their assigned products.
  restrictProductAccess: boolean('restrict_product_access').default(false).notNull(),
  // Optional FK to commission_plans for compensation settings.
  commissionPlanId: uuid('commission_plan_id'),
  // Last time this agent took any action (CS_ENGAGED, CONFIRMED, etc.)
  // Used for dispatch tiebreaker and inactivity detection.
  lastActionAt: timestamp('last_action_at', { withTimezone: true }),
  /** Default branch for this user. NULL for SuperAdmin (bypasses branch RLS). */
  primaryBranchId: uuid('primary_branch_id'),
  /** Explicit appearance theme; NULL = use org default from `client_ui_config`. */
  appTheme: text('app_theme'),
  /** Explicit font scale; NULL = base (default). One of 'base' | 'large' | 'xlarge'. */
  fontScale: text('font_scale'),
  /** Payout beneficiary bank name (finance-only visibility). */
  payoutBankName: text('payout_bank_name'),
  /** Payout beneficiary account name (finance-only visibility). */
  payoutAccountName: text('payout_account_name'),
  /** Payout beneficiary account number (finance-only visibility). */
  payoutAccountNumber: text('payout_account_number'),
  /** Payout beneficiary bank routing/sort code (finance-only visibility). */
  payoutBankCode: text('payout_bank_code'),
  /**
   * Per-user notification opt-outs. Map of notification-type → enabled.
   * Empty / missing key = enabled (default). `false` = skip this type entirely
   * (no in-app row, no socket emit, no push, no email) for this user.
   */
  notificationPreferences: jsonb('notification_preferences')
    .$type<Record<string, boolean>>()
    .default({})
    .notNull(),
  /**
   * Lifetime login counter — incremented on every successful login. Captured by the
   * temporal trigger so each tick lands in `users_history` and surfaces in the
   * audit log automatically (no separate audit_events table).
   */
  loginCount: integer('login_count').default(0).notNull(),
  /** Most recent successful login timestamp. Paired with `loginCount` for audit. */
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /**
   * Probation flag — when true, this user has the full permissions of their role
   * but can be terminated (PII-scrubbed) without affecting their transactional
   * history. Eligibility: any non-admin role. Set/unset gated to HR_MANAGER + SUPER_ADMIN.
   * See CLAUDE.md → "Probation user type" and migration 0126.
   */
  isProbation: boolean('is_probation').default(false).notNull(),
  probationStartedAt: timestamp('probation_started_at', { withTimezone: true }),
  probationStartedBy: uuid('probation_started_by'),
  probationUntil: timestamp('probation_until', { withTimezone: true }),
  /** Stamped only when the row was scrubbed via the probation termination flow. */
  terminatedAt: timestamp('terminated_at', { withTimezone: true }),
  terminatedBy: uuid('terminated_by'),
  /** Role snapshot taken at termination so the row stays filterable post-scrub. */
  originalRole: userRoleEnum('original_role'),
  /**
   * Denormalised "is supervisor anywhere" flag — kept in sync by
   * `BranchTeamsService` whenever a user is granted/revoked supervisor on any
   * `branch_team_members` row. Source of truth is the team-membership rows;
   * this column exists so UI surfaces (header chip, user-detail pill, Staff
   * Accounts list/filter) don't need a JOIN. See migration 0139.
   */
  isTeamSupervisor: boolean('is_team_supervisor').default(false).notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Email change requests — require SuperAdmin approval before taking effect
export const emailChangeRequests = pgTable('email_change_requests', {
  id: uuidv7Pk(),
  userId: uuid('user_id').notNull().references(() => users.id),
  requestedNewEmail: text('requested_new_email').notNull(),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  status: text('status').default('PENDING').notNull(),
  approverId: uuid('approver_id').references(() => users.id),
  approvalReason: text('approval_reason'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  ...temporalColumns,
  ...timestampColumns,
});

// Junction table: which products a user is assigned to work on
export const userProductAssignments = pgTable('user_product_assignments', {
  id: uuidv7Pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  ...temporalColumns,
  ...timestampColumns,
});
