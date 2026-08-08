import { pgEnum } from 'drizzle-orm/pg-core';

/** Branch supervisor teams — CS vs Marketing squads within a branch. */
export const branchTeamDepartmentEnum = pgEnum('branch_team_department', ['CS', 'MARKETING']);

/**
 * Why Finance retracked an order (required on a direct retrack). Drives the
 * color-coded banner shown to closers + the retrack hold that blocks re-delivery
 * until CS/HoCS resolves it. Price/quantity categories also carry a corrected-value
 * hint. Keep in sync with 0303_retrack_category.sql and RETRACK_CATEGORY_META.
 */
export const retrackCategoryEnum = pgEnum('retrack_category', [
  'wrong_remittance_price',
  'understated_overstated_price',
  'wrong_quantity',
  'wrong_delivery_agent',
  'duplicate_delivery',
  'not_delivered_moved_by_cs',
]);

/** CS auto-dispatch routing: weighted vs equal split across target teams. */
export const csOrderRoutingStrategyEnum = pgEnum('cs_order_routing_strategy', ['WEIGHTED', 'EQUAL']);

/**
 * Per funnel branch routing mode:
 *   - BRANCH_DEFAULT       — orders served by CS in the same branch as marketing
 *   - PRODUCT_ALLOCATION   — orders served per per-product → CS branch mapping
 *   - SPLIT_ALL_BRANCHES   — orders distributed (load-balanced) across CS in every branch
 */
export const csRoutingRelationshipModeEnum = pgEnum('cs_routing_relationship_mode', [
  'BRANCH_DEFAULT',
  'PRODUCT_ALLOCATION',
  'SPLIT_ALL_BRANCHES',
]);

export const userRoleEnum = pgEnum('user_role', [
  'SUPER_ADMIN',
  // ADMIN = SuperAdmin-equivalent privileges EXCEPT cannot manage another Admin or the SuperAdmin.
  // Multiple ADMINs can exist; SUPER_ADMIN is a singleton.
  'ADMIN',
  'BRANCH_ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  // Renamed from `CS_AGENT` per CEO directive 2026-05-10 (migration 0132).
  // The DB enum value is `'CS_CLOSER'`; historical `'CS_AGENT'` references in
  // audit log payloads stay frozen as the truthful name at write time.
  'CS_CLOSER',
  'FINANCE_OFFICER',
  // ACCOUNTANT = bookkeeping role. Full accounting.* (GL, chart of accounts,
  // journals, reports) + read context. No money movement (no approve/disburse/
  // cash-remittance). Separated from FINANCE_OFFICER's operational finance hat.
  'ACCOUNTANT',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
  // SUPPORT = read-only tech support role with full SUPER_ADMIN visibility.
  // All tRPC mutations blocked at middleware layer. Can mirror any user.
  'SUPPORT',
  // AUDITOR = read-only finance-scoped role for external/internal auditors.
  // Sees GL, journal entries, trial balance, financial reports, and audit trail.
  // Cannot mutate any data (no write permissions granted).
  'AUDITOR',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'CANCELLED',
  // Renamed from `ALLOCATED` per CEO directive 2026-05-04 (migration 0110).
  // The 3PL location's agent has been assigned to deliver this order.
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  // Renamed from `COMPLETED` per CEO directive 2026-05-04 (migration 0110).
  // The order reaches this state when Finance confirms cash remittance for
  // the corresponding COD batch — distinct from `DELIVERED` (CS / Logistics
  // confirmation) which only signals the customer has the goods.
  'REMITTED',
  // Soft-removal: order excluded from ALL metrics/counts but row stays in DB.
  // Distinct from CANCELLED (which is a legitimate business event that counts
  // in metrics). Admin/SuperAdmin can restore to UNPROCESSED. Migration 0153.
  'DELETED',
]);

export const movementTypeEnum = pgEnum('movement_type', [
  'INTAKE',
  'RESERVATION',
  'ALLOCATION',
  'DISPATCH',
  'DELIVERY',
  'RETURN',
  'RESTOCK',
  'WRITE_OFF',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
]);

export const transferStatusEnum = pgEnum('transfer_status', [
  'PENDING',
  'IN_TRANSIT',
  'RECEIVED',
  'DISPUTED',
  'CANCELLED',
  'REJECTED',
]);

export const fundingStatusEnum = pgEnum('funding_status', [
  'SENT',
  'COMPLETED',
  'DISPUTED',
]);

export const fundingRequestStatusEnum = pgEnum('funding_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

export const mbFundTransferStatusEnum = pgEnum('mb_fund_transfer_status', [
  'PENDING',   // MB created, awaiting HoM/Supervisor approval
  'APPROVED',  // HoM/Supervisor approved, awaiting recipient acceptance
  'REJECTED',  // HoM/Supervisor rejected (with reason)
  'ACCEPTED',  // Recipient confirmed receipt, balances updated
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT',
  'SENT',
  'PAID',
  'OVERDUE',
  'CANCELLED',
]);

export const payoutStatusEnum = pgEnum('payout_status', [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'PAID',
  'REJECTED',
]);

export const adjustmentCategoryEnum = pgEnum('adjustment_category', [
  'BONUS',
  'EXTRA_SHIFT',
  'PERFORMANCE',
  'DEDUCTION',
  'CLAWBACK',
  'OTHER',
]);

export const deploymentTypeEnum = pgEnum('deployment_type', [
  'SNIPPET',
  'IFRAME',
  'HOSTED',
]);

export const stockStateEnum = pgEnum('stock_state', [
  'AVAILABLE',
  'RESERVED',
  'ALLOCATED_TO_3PL',
  'IN_TRANSIT',
  'DELIVERED',
  'RETURNED',
  'WRITTEN_OFF',
]);

export const callStatusEnum = pgEnum('call_status', [
  'INITIATED',
  'RINGING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'NO_ANSWER',
  'BUSY',
  'MANUAL_CALL',
]);

export const reconciliationStatusEnum = pgEnum('reconciliation_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

export const approvalRequestTypeEnum = pgEnum('approval_request_type', [
  'MEDIA_SPEND',
  'PROCUREMENT',
  'LOGISTICS_REIMBURSEMENT',
  'AD_HOC',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'QUERIED',
]);

export const settlementWindowEnum = pgEnum('settlement_window', [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
]);

/**
 * Payroll batch lifecycle. Distinct from payout_status (which lives on individual
 * payout_records) — the batch is the unit of HR review and Finance disbursement.
 *
 * DRAFT       — Head of Department is preparing it (their team's payouts).
 * PENDING_HR  — Submitted to HR for review + adjustments.
 * PENDING_FINANCE — HR approved; Finance must record disbursement.
 * PAID        — Finance recorded payment; immutable.
 *
 * Reject is an ACTION that transitions PENDING_* back one stage to DRAFT or PENDING_HR;
 * there is no terminal REJECTED state. See CLAUDE.md → "Payroll Workflow" for the full state machine.
 */
export const payrollBatchStatusEnum = pgEnum('payroll_batch_status', [
  'DRAFT',
  'PENDING_HR',
  'PENDING_FINANCE',
  'PAID',
]);

/**
 * Department a payroll batch belongs to. The owning Head role prepares the batch:
 *   CS        → HEAD_OF_CS prepares; covers CS_CLOSER
 *   MARKETING → HEAD_OF_MARKETING prepares; covers MEDIA_BUYER
 *   LOGISTICS → HEAD_OF_LOGISTICS prepares; covers LOGISTICS_MANAGER, TPL_MANAGER, TPL_RIDER, STOCK_MANAGER
 *   HR        → HR_MANAGER prepares (own bucket — covers Heads themselves, BRANCH_ADMIN, FINANCE_OFFICER, HR_MANAGER)
 */
export const payrollDepartmentEnum = pgEnum('payroll_department', [
  'CS',
  'MARKETING',
  'LOGISTICS',
  'HR',
  'OPERATIONS',
  'FINANCE',
  'SUPPORT',
]);

export const payrollPayRoleCategoryEnum = pgEnum('payroll_pay_role_category', [
  // Legacy department-level categories (kept for existing rows)
  'CS',
  'MEDIA_BUYING',
  'LOGISTICS',
  'OPERATIONS',
  'SUPPORT',
  'LEADERSHIP',
  'CONTRACTOR',
  'FINANCE',
  'HR_ADMIN',
  'STOCK_MANAGEMENT',
  // Per-role categories (maps 1:1 to user_role values)
  'SUPER_ADMIN',
  'ADMIN',
  'BRANCH_ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  'CS_CLOSER',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
  'AUDITOR',
]);

export const payrollEmploymentTypeEnum = pgEnum('payroll_employment_type', [
  'STAFF',
  'CONTRACTOR_AGENCY',
]);

/**
 * Which order pipelines feed the payroll delivered-order metrics for staff on a
 * pay role. Migration 0288.
 *   FUNNEL            — orders-table funnel only (default; existing behaviour).
 *   RECOVERY_COMBINED — orders WHERE is_delivered_follow_up = true (graduated
 *                       follow-ups + CS-created delivered-follow-up) PLUS
 *                       cart_orders. Excludes the follow_up_orders table to avoid
 *                       double-counting graduated follow-up deliveries.
 */
export const payrollDeliveredMetricSourceEnum = pgEnum('payroll_delivered_metric_source', [
  'FUNNEL',
  'RECOVERY_COMBINED',
]);

export const payrollSalaryBasisEnum = pgEnum('payroll_salary_basis', [
  'FORMULA_BASED',
  'FLAT_RATE',
]);

export const payrollTaxStatusEnum = pgEnum('payroll_tax_status', [
  'STANDARD_PAYE',
  'EMPLOYER_SUBSIDIZED_PAYE',
  'GROSS_NO_DEDUCTION',
]);

export const payrollOnboardingStatusEnum = pgEnum('payroll_onboarding_status', [
  'NOT_APPLICABLE',
  'PENDING_APPROVAL',
  'ACTIVE',
]);

/** Standardized exit reasons for the employment-lifecycle exit dropdown. */
export const employeeExitReasonEnum = pgEnum('employee_exit_reason', [
  'RESIGNATION',
  'THEFT',
  'ABANDONMENT',
  'FRAUD',
  'UNDERPERFORMANCE',
  'INSUBORDINATION',
  'ADMIN_DISMISSAL',
  'OTHER',
]);

export const payrollBatchScopeTypeEnum = pgEnum('payroll_batch_scope_type', [
  'ALL_BRANCHES',
  'BRANCHES',
  'EMPLOYEES',
  'DEPARTMENT',
  // Null-scope batches (branch_id / department NULL). Migration 0287.
  'CONTRACTORS',
  'ALL',
]);

export const payrollPayslipLineStatusEnum = pgEnum('payroll_payslip_line_status', [
  'OK',
  'NEEDS_ATTENTION',
  'MANUALLY_OVERRIDDEN',
]);

export const recordStatusEnum = pgEnum('record_status', [
  'ACTIVE',
  'INACTIVE',
  'ARCHIVED',
  'PENDING',
  'DEACTIVATED',
]);

export const cartStatusEnum = pgEnum('cart_status', [
  'PENDING',
  'CONVERTED',
  'ABANDONED',
]);

export const permissionRequestTypeEnum = pgEnum('permission_request_type', [
  'USER_CREATION',
  'ROLE_CHANGE',
  'PERMISSION_GRANT',
  'PRODUCT_ARCHIVE',
  'ORDER_LINE_PRICE_CHANGE',
  'ORDER_DELETION',
  'DELIVERED_ORDER_DELETION',
  'ORDER_STATUS_RETRACK',
]);

export const permissionRequestStatusEnum = pgEnum('permission_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

export const adSpendStatusEnum = pgEnum('ad_spend_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

/**
 * Ad platform for an ad_spend_logs entry. Default `FACEBOOK` (vast majority).
 * Adding new values is an additive `ALTER TYPE ... ADD VALUE` migration —
 * existing rows stay valid.
 */
export const adPlatformEnum = pgEnum('ad_platform', [
  'FACEBOOK',
  'TIKTOK',
  'GOOGLE',
  'OTHER',
]);

/**
 * Expense category for marketing expenses. Only `AD_SPEND` feeds into CPA/ROAS.
 * Other categories deduct from the MB's funded balance but don't affect performance metrics.
 */
export const expenseCategoryEnum = pgEnum('expense_category', [
  'AD_SPEND',
  'AD_ACCOUNT',
  'RECRUITMENT_AD',
  'WHATSAPP_CAMPAIGN',
  'UGC_PRODUCTION',
  'OTHER',
]);

/** Status of a 3PL→warehouse transfer remittance (receipt upload, HoL marks received). */
export const remittanceStatusEnum = pgEnum('remittance_status', [
  'SENT',
  'RECEIVED',
  'DISPUTED',
]);

/** Settlement line status for remittance outcomes (approved slice vs disputed slice). */
export const remittanceOutcomeStatusEnum = pgEnum('remittance_outcome_status', ['APPROVED', 'DISPUTED']);

/** Status of a delivery confirmation request (rider/3PL submit → HOL approve/reject). */
export const deliveryConfirmationRequestStatusEnum = pgEnum('delivery_confirmation_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

/** Status of a branch. */
export const branchStatusEnum = pgEnum('branch_status', [
  'ACTIVE',
  'INACTIVE',
]);

/** Channel for outbound messages (customer-facing CS comms + 3PL dispatch coordination). */
export const messageChannelEnum = pgEnum('message_channel', [
  'SMS',
  'WHATSAPP',
  'WHATSAPP_GROUP',
]);

/** Status of an outbound CS message. */
export const outboundMessageStatusEnum = pgEnum('outbound_message_status', [
  'SENT',
  'FAILED',
]);

/** Status of a message template. */
export const templateStatusEnum = pgEnum('template_status', [
  'ACTIVE',
  'ARCHIVED',
]);

/** Dispatch mode for CS order assignment. */
export const dispatchModeEnum = pgEnum('dispatch_mode', [
  'LOAD_BALANCED',
  'PERFORMANCE',
  'CLAIM',
]);

/** Trigger source for a push notification (who/what initiated it). */
export const pushTriggerTypeEnum = pgEnum('push_trigger_type', ['MIRROR', 'BROADCAST', 'AUTOMATION']);

/** Delivery status for a web push attempt. */
export const pushDeliveryStatusEnum = pgEnum('push_delivery_status', ['SENT', 'FAILED', 'SHOWN', 'CLICKED']);

/** Audience selector for push broadcasts and automation rules. */
export const pushTargetTypeEnum = pgEnum('push_target_type', ['ALL', 'ROLE', 'USER']);

/** How a push automation rule is triggered — time-based cron or event-based. */
export const pushAutomationTriggerEnum = pgEnum('push_automation_trigger', ['CRON', 'EVENT']);

/**
 * Device's PWA install mode at the time the subscription was saved / heartbeat ran.
 * STANDALONE = installed to home screen (matchMedia('(display-mode: standalone)').matches === true
 * on desktop/Android, or navigator.standalone === true on iOS). BROWSER = running in a regular tab.
 * UNKNOWN = client never reported (legacy rows, or browser too old to expose the signal).
 */
export const pushInstallModeEnum = pgEnum('push_install_mode', ['STANDALONE', 'BROWSER', 'UNKNOWN']);

/** Human-readable order lifecycle timeline event types. */
export const timelineEventTypeEnum = pgEnum('timeline_event_type', [
  'ORDER_RECEIVED',
  'ORDER_AUTO_ASSIGNED',
  'ORDER_MANUALLY_ASSIGNED',
  'ORDER_REASSIGNED',
  'ORDER_CLAIMED',
  'ORDER_VIEWED',
  'CALL_INITIATED',
  'CALL_COMPLETED',
  'CALL_NO_ANSWER',
  'CALL_FAILED',
  'MANUAL_CALL_LOGGED',
  'SMS_SENT',
  'WHATSAPP_SENT',
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'ADDRESS_UPDATED',
  'QUANTITY_UPDATED',
  'CALLBACK_SCHEDULED',
  'ORDER_ALLOCATED',
  'ORDER_DISPATCHED',
  'ORDER_IN_TRANSIT',
  'ORDER_DELIVERED',
  'ORDER_PARTIALLY_DELIVERED',
  'ORDER_RETURNED',
  'ORDER_RESTOCKED',
  'ORDER_WRITTEN_OFF',
  'SUPERVISOR_WATCHING',
  'PAYMENT_RECEIVED',
  'ORDER_ARCHIVED',
  'ORDER_DELETED',
  'LINE_PRICE_CHANGE_REQUESTED',
  'LINE_PRICE_CHANGE_APPROVED',
  'LINE_PRICE_CHANGE_REJECTED',
  'CS_ORDER_COMMENT',
  'ORDER_RESTORED',
  'ORDER_RETRACKED',
  'ORDER_RETRACK_RESOLVED',
  'ORDER_CS_TRANSFERRED_POST_STATUS',
  'ORDER_DUPLICATE_FLAGGED',
  'ORDER_UNFROZEN',
  'ORDER_FROZEN',
  'ORDER_REMITTED',
]);

/** Staff onboarding workflow — non-blocking record-keeping flow. */
export const onboardingStatusEnum = pgEnum('onboarding_status', [
  'NOT_STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'APPROVED',
]);

export const staffGenderEnum = pgEnum('staff_gender', [
  'MALE',
  'FEMALE',
  'OTHER',
  'PREFER_NOT_TO_SAY',
]);

/**
 * Inbound shipment lifecycle. Drives the parent `shipments` row through the
 * supplier → warehouse receipt flow:
 *
 *   CREATED     — planned, not yet shipped
 *   IN_TRANSIT  — supplier has dispatched
 *   ARRIVED     — physically at the destination warehouse, awaiting verification
 *   VERIFIED    — received quantities recorded; stock_batches + inventory_levels
 *                 + INTAKE movements written; landing cost allocated per line
 *   CLOSED      — final lock, audit point
 *   CANCELLED   — voided pre-VERIFY (reason required, no inventory side effects)
 *
 * See CLAUDE.md → "Shipment Lifecycle" for the full state machine.
 */
export const shipmentStatusEnum = pgEnum('shipment_status', [
  'CREATED',
  'IN_TRANSIT',
  'ARRIVED',
  'VERIFIED',
  'CLOSED',
  'CANCELLED',
]);

// ============================================
// Double-Entry General Ledger (Phase 1)
// ============================================

/** The 5 accounting roots. Every account rolls up to exactly one. */
export const glRootTypeEnum = pgEnum('gl_root_type', [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'INCOME',
  'EXPENSE',
]);

/**
 * Semantic account tag (mirrors ERPNext `account_type`). Drives posting logic
 * in later phases (which account is the Bank, the Receivable, COGS, etc.).
 * Nullable on group/root accounts. Superset so Phase 2 needn't touch enums.
 */
export const glAccountTypeEnum = pgEnum('gl_account_type', [
  'BANK',
  'CASH',
  'RECEIVABLE',
  'PAYABLE',
  'STOCK',
  'COST_OF_GOODS_SOLD',
  'TAX',
  'FIXED_ASSET',
  'INDIRECT_EXPENSE',
  'INDIRECT_INCOME',
  'DIRECT_INCOME',
  'EQUITY',
  'ROUND_OFF',
  'TEMPORARY',
  'DEPRECIATION',
  'EXPENSE_ACCOUNT',
  'CHARGEABLE',
  'STOCK_RECEIVED_BUT_NOT_BILLED',
]);

/** What kind of voucher produced a GL entry. */
export const glVoucherTypeEnum = pgEnum('gl_voucher_type', [
  'JOURNAL_ENTRY',
  'SALES_INVOICE',
  'PAYMENT',
  'PURCHASE_RECEIPT',
  'PAYROLL',
  'EXPENSE',
]);

/** Journal entry lifecycle. DRAFT = pending approval (Phase 5). */
export const journalEntryStatusEnum = pgEnum('journal_entry_status', [
  'POSTED',
  'CANCELLED',
  'DRAFT',
]);

/** Fiscal year state. CLOSED = period locked (no postings). */
export const fiscalYearStatusEnum = pgEnum('fiscal_year_status', [
  'OPEN',
  'CLOSED',
]);

// ============================================
// Fixed Asset Register
// ============================================

/** Depreciation calculation method for a fixed asset. */
export const assetDepreciationMethodEnum = pgEnum('asset_depreciation_method', [
  'STRAIGHT_LINE',
  'REDUCING_BALANCE',
  'UNITS_OF_PRODUCTION',
]);

/** Lifecycle status of a fixed asset. */
export const assetStatusEnum = pgEnum('asset_status', [
  'ACTIVE',
  'FULLY_DEPRECIATED',
  'DISPOSED',
]);

// ── Marketing Automation ─────────────────────────────────────
/** EVENT = per-customer reactive journey; SEGMENT = audience broadcast. */
export const automationRuleKindEnum = pgEnum('automation_rule_kind', ['EVENT', 'SEGMENT']);

/** Delivery channel for an automation. */
export const automationChannelEnum = pgEnum('automation_channel', ['EMAIL', 'SMS', 'WHATSAPP']);

/** Channel of an automation message template (own table, includes EMAIL + subject). */
export const automationMessageChannelEnum = pgEnum('automation_message_channel', ['EMAIL', 'SMS', 'WHATSAPP']);

/** Lifecycle of an automation message template. */
export const automationMessageTemplateStatusEnum = pgEnum('automation_message_template_status', [
  'ACTIVE',
  'ARCHIVED',
]);

/** How a target group is populated. */
export const targetGroupSourceKindEnum = pgEnum('target_group_source_kind', ['RULE', 'UPLOAD', 'MANUAL']);

/** How an individual member joined a target group. */
export const targetGroupMemberSourceEnum = pgEnum('target_group_member_source', ['RULE', 'UPLOAD', 'MANUAL']);

/** Lifecycle of a scheduled automation send. */
export const automationJobStatusEnum = pgEnum('automation_job_status', [
  'PENDING',
  'SENT',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
]);

/** Which channel(s) a suppression covers. ALL suppresses every channel. */
export const messageSuppressionChannelEnum = pgEnum('message_suppression_channel', [
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'ALL',
]);

/** Why a recipient landed on the suppression list. */
export const messageSuppressionReasonEnum = pgEnum('message_suppression_reason', [
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINED',
  'MANUAL',
]);
