/**
 * Notification types and email configuration.
 * SuperAdmin can toggle email for configurable types.
 * Mandatory types always send email (cannot be disabled).
 */

export const NOTIFICATION_EMAIL_CONFIG_KEY = 'NOTIFICATION_EMAIL_CONFIG';

/** Notification types that ALWAYS send email — action required, cannot be disabled */
export const MANDATORY_EMAIL_TYPES = [
  'approval:email_change',
  'finance:approval_required',
  'funding:sent',
  'funding:disputed',
] as const;

/** Notification types that SuperAdmin can toggle email for */
export const CONFIGURABLE_EMAIL_TYPES = [
  'order:new',
  'order:new_campaign',
  'order:assigned',
  'order:assigned_bulk',
  'order:reassigned',
  'order:allocated',
  'order:transfer_requested',
  'order:transfer_accepted',
  'order:transfer_rejected',
  'order:callback_scheduled',
  'order:callback_due',
  'delivery:assigned',
  'marketing:high_cpa',
  'marketing:ad_spend_submitted',
  'funding:request',
  'funding:approved',
  'funding:rejected',
  'finance:approval_processed',
  'logistics:shrinkage',
  'hr:payout_approved',
  'hr:deduction_created',
  'hr:addon_approved',
  'hr:deduction_applied',
  'hr:batch_submitted',
  'hr:batch_approved',
  'hr:batch_rejected',
  'hr:batch_paid',
  'hr:onboarding_submitted',
  'hr:onboarding_approved',
  'hr:onboarding_changes_requested',
  'transfer:sent',
  'inventory:transfer_pending_approval',
  'inventory:transfer_approved',
  'inventory:transfer_rejected',
  'delivery_remittance:sent',
  'delivery_remittance:received',
  'account:updated',
  'account:security',
  'account:probation_assigned',
  'account:probation_extended',
  'account:probation_passed',
  'account:probation_review_due',
  'account:probation_terminated',
  'approval:permission_request',
] as const;

export const ALL_NOTIFICATION_TYPES = [
  ...MANDATORY_EMAIL_TYPES,
  ...CONFIGURABLE_EMAIL_TYPES,
] as const;

export type NotificationType = (typeof ALL_NOTIFICATION_TYPES)[number];

export interface NotificationTypeMeta {
  type: NotificationType;
  label: string;
  description: string;
  mandatory: boolean;
  category: 'approvals' | 'orders' | 'marketing' | 'finance' | 'logistics' | 'hr' | 'account';
}

export const NOTIFICATION_TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  'approval:email_change': {
    type: 'approval:email_change',
    label: 'Email change approval',
    description: 'SuperAdmin must approve user email change requests',
    mandatory: true,
    category: 'approvals',
  },
  'finance:approval_required': {
    type: 'finance:approval_required',
    label: 'Finance approval required',
    description: 'New approval request needs Finance Officer review',
    mandatory: true,
    category: 'finance',
  },
  'funding:sent': {
    type: 'funding:sent',
    label: 'Funding received',
    description: 'Media Buyer must mark funding as Received or Not Received',
    mandatory: true,
    category: 'marketing',
  },
  'funding:disputed': {
    type: 'funding:disputed',
    label: 'Funding disputed',
    description: 'Media Buyer marked funding as Not Received — needs resolution',
    mandatory: true,
    category: 'marketing',
  },
  'funding:request': {
    type: 'funding:request',
    label: 'Funding request',
    description: 'Head of Marketing — Media Buyer requested funds',
    mandatory: false,
    category: 'marketing',
  },
  'funding:approved': {
    type: 'funding:approved',
    label: 'Funding request approved',
    description: 'Media Buyer — their funding request was approved; receipt attached',
    mandatory: false,
    category: 'marketing',
  },
  'funding:rejected': {
    type: 'funding:rejected',
    label: 'Funding request rejected',
    description: 'Media Buyer — their funding request was not approved',
    mandatory: false,
    category: 'marketing',
  },
  'order:new': {
    type: 'order:new',
    label: 'New order',
    description: 'Head of CS / Head of Marketing — new order created',
    mandatory: false,
    category: 'orders',
  },
  'order:new_campaign': {
    type: 'order:new_campaign',
    label: 'New order from campaign',
    description: 'Media Buyer — new order from their campaign',
    mandatory: false,
    category: 'orders',
  },
  'order:assigned': {
    type: 'order:assigned',
    label: 'Order assigned',
    description: 'CS Agent — order assigned to them',
    mandatory: false,
    category: 'orders',
  },
  'order:assigned_bulk': {
    type: 'order:assigned_bulk',
    label: 'Orders bulk-assigned',
    description: 'CS Agent — orders reassigned to them (Hot Swap)',
    mandatory: false,
    category: 'orders',
  },
  'order:reassigned': {
    type: 'order:reassigned',
    label: 'Orders reassigned',
    description: 'CS Agent — their orders were reassigned to another agent',
    mandatory: false,
    category: 'orders',
  },
  'order:allocated': {
    type: 'order:allocated',
    label: 'Agent-assigned order at location',
    description: 'TPL Manager — order assigned for delivery at their 3PL location',
    mandatory: false,
    category: 'orders',
  },
  'order:transfer_requested': {
    type: 'order:transfer_requested',
    label: 'Order transfer requested',
    description: 'CS Agent — a colleague requested to transfer an order to you',
    mandatory: false,
    category: 'orders',
  },
  'order:transfer_accepted': {
    type: 'order:transfer_accepted',
    label: 'Transfer accepted',
    description: 'CS Agent — your order transfer request was accepted',
    mandatory: false,
    category: 'orders',
  },
  'order:transfer_rejected': {
    type: 'order:transfer_rejected',
    label: 'Transfer rejected',
    description: 'CS Agent — your order transfer request was rejected',
    mandatory: false,
    category: 'orders',
  },
  'order:callback_scheduled': {
    type: 'order:callback_scheduled',
    label: 'Callback scheduled',
    description: 'CS Agent — callback has been scheduled for an order',
    mandatory: false,
    category: 'orders',
  },
  'order:callback_due': {
    type: 'order:callback_due',
    label: 'Callback due',
    description: 'CS Agent — scheduled callback is now due, call the customer',
    mandatory: false,
    category: 'orders',
  },
  'delivery:assigned': {
    type: 'delivery:assigned',
    label: 'Delivery assigned',
    description: 'Rider — delivery assigned to them',
    mandatory: false,
    category: 'orders',
  },
  'marketing:high_cpa': {
    type: 'marketing:high_cpa',
    label: 'High CPA warning',
    description: 'SuperAdmin / Head of Marketing — Media Buyer CPA exceeds threshold',
    mandatory: false,
    category: 'marketing',
  },
  'marketing:ad_spend_submitted': {
    type: 'marketing:ad_spend_submitted',
    label: 'New ad spend submitted',
    description: 'Head of Marketing — Media Buyer submitted a daily ad spend batch for review',
    mandatory: false,
    category: 'marketing',
  },
  'finance:approval_processed': {
    type: 'finance:approval_processed',
    label: 'Approval processed',
    description: 'Requester — their approval request was approved or rejected',
    mandatory: false,
    category: 'finance',
  },
  'logistics:shrinkage': {
    type: 'logistics:shrinkage',
    label: 'Stock shrinkage',
    description: 'SuperAdmin / Head of Logistics — transfer received with shortage',
    mandatory: false,
    category: 'logistics',
  },
  'hr:payout_approved': {
    type: 'hr:payout_approved',
    label: 'Payout approved',
    description: 'Staff — their payout has been approved',
    mandatory: false,
    category: 'hr',
  },
  'hr:deduction_created': {
    type: 'hr:deduction_created',
    label: 'Deduction added',
    description: 'Staff — clawback or deduction added to earnings',
    mandatory: false,
    category: 'hr',
  },
  'hr:addon_approved': {
    type: 'hr:addon_approved',
    label: 'Add-on approved',
    description: 'Staff — their add-on earnings have been approved',
    mandatory: false,
    category: 'hr',
  },
  'hr:deduction_applied': {
    type: 'hr:deduction_applied',
    label: 'Deduction applied',
    description: 'Staff — deduction applied to their earnings',
    mandatory: false,
    category: 'hr',
  },
  'hr:batch_submitted': {
    type: 'hr:batch_submitted',
    label: 'Payroll batch submitted',
    description: 'HR Manager — a department head submitted a monthly payroll batch for review',
    mandatory: false,
    category: 'hr',
  },
  'hr:batch_approved': {
    type: 'hr:batch_approved',
    label: 'Payroll batch approved by HR',
    description: 'Finance — HR approved a payroll batch and forwarded it for disbursement',
    mandatory: false,
    category: 'hr',
  },
  'hr:batch_rejected': {
    type: 'hr:batch_rejected',
    label: 'Payroll batch sent back',
    description: 'Department head / HR — payroll batch was rejected and returned for edits',
    mandatory: false,
    category: 'hr',
  },
  'hr:batch_paid': {
    type: 'hr:batch_paid',
    label: 'Payroll batch paid',
    description: 'Department head + HR — Finance recorded payment for a monthly payroll batch',
    mandatory: false,
    category: 'hr',
  },
  'hr:onboarding_submitted': {
    type: 'hr:onboarding_submitted',
    label: 'Onboarding submitted',
    description: 'HR Manager — a staff member submitted their onboarding profile for review',
    mandatory: false,
    category: 'hr',
  },
  'hr:onboarding_approved': {
    type: 'hr:onboarding_approved',
    label: 'Onboarding approved',
    description: 'Staff — HR approved their onboarding profile',
    mandatory: false,
    category: 'hr',
  },
  'hr:onboarding_changes_requested': {
    type: 'hr:onboarding_changes_requested',
    label: 'Onboarding — changes requested',
    description: 'Staff — HR sent the onboarding back for edits with a reason',
    mandatory: false,
    category: 'hr',
  },
  'transfer:sent': {
    type: 'transfer:sent',
    label: 'Stock transfer incoming',
    description: 'TPL Manager — stock transfer on the way to their location',
    mandatory: false,
    category: 'logistics',
  },
  'inventory:transfer_pending_approval': {
    type: 'inventory:transfer_pending_approval',
    label: 'Transfer awaiting approval',
    description: 'Source authority (Stock Manager / TPL Manager / Branch Admin / HoLogistics) — a transfer needs approval before stock leaves',
    mandatory: false,
    category: 'logistics',
  },
  'inventory:transfer_approved': {
    type: 'inventory:transfer_approved',
    label: 'Transfer approved',
    description: 'Initiator — your pending transfer was approved by the source authority and is now in transit',
    mandatory: false,
    category: 'logistics',
  },
  'inventory:transfer_rejected': {
    type: 'inventory:transfer_rejected',
    label: 'Transfer rejected',
    description: 'Initiator — your pending transfer was rejected by the source authority',
    mandatory: false,
    category: 'logistics',
  },
  'delivery_remittance:sent': {
    type: 'delivery_remittance:sent',
    label: 'Delivery remittance submitted',
    description: 'Finance — 3PL submitted a delivery remittance for review',
    mandatory: false,
    category: 'finance',
  },
  'delivery_remittance:received': {
    type: 'delivery_remittance:received',
    label: 'Delivery remittance received',
    description: '3PL — Finance marked your delivery remittance as received',
    mandatory: false,
    category: 'logistics',
  },
  'account:updated': {
    type: 'account:updated',
    label: 'Account updated by admin',
    description: 'User — profile, access, or settings were changed by an administrator',
    mandatory: false,
    category: 'account',
  },
  'account:security': {
    type: 'account:security',
    label: 'Account security',
    description: 'User — password reset, deactivation, or similar security-related change',
    mandatory: false,
    category: 'account',
  },
  'approval:permission_request': {
    type: 'approval:permission_request',
    label: 'Permission request',
    description: 'SuperAdmin — HR submitted a user creation or role change for approval',
    mandatory: false,
    category: 'approvals',
  },
  'account:probation_assigned': {
    type: 'account:probation_assigned',
    label: 'Probation assigned',
    description: 'User — placed on probation; review window is set',
    mandatory: false,
    category: 'account',
  },
  'account:probation_extended': {
    type: 'account:probation_extended',
    label: 'Probation extended',
    description: 'User — probation review date was moved',
    mandatory: false,
    category: 'account',
  },
  'account:probation_passed': {
    type: 'account:probation_passed',
    label: 'Probation passed',
    description: 'User — probation cleared; you are now a permanent staff member',
    mandatory: false,
    category: 'account',
  },
  'account:probation_review_due': {
    type: 'account:probation_review_due',
    label: 'Probation review due',
    description: 'HR — a probation review window is approaching for one of your staff',
    mandatory: false,
    category: 'hr',
  },
  'account:probation_terminated': {
    type: 'account:probation_terminated',
    label: 'Probation terminated',
    description: 'HR / SuperAdmin — a probation user was terminated; their PII has been scrubbed',
    mandatory: false,
    category: 'hr',
  },
};

/**
 * Per-user notification opt-out support.
 *
 * For each role, the list of notification types that user could realistically receive.
 * The Settings → Notifications tab renders one toggle per type in this list. Default for
 * every type is "enabled" — a user only ever opts OUT, never IN. Mandatory types
 * (action-required) cannot be disabled and are not included here.
 *
 * Notes:
 * - Account-level types (`account:*`) and request-status types (`finance:approval_processed`,
 *   `funding:approved`, `funding:rejected`, `order:transfer_*`) apply to anyone who could be
 *   the requester, so they're listed under every role that participates in those flows.
 * - SuperAdmin / Admin / Branch Admin see everything because broadcast targeting and
 *   future automation rules can reach them.
 */
const COMMON_ACCOUNT_TYPES: NotificationType[] = [
  'account:updated',
  'account:security',
  'account:probation_assigned',
  'account:probation_extended',
  'account:probation_passed',
];

const ALL_CONFIGURABLE: NotificationType[] = [...CONFIGURABLE_EMAIL_TYPES];

export const RELEVANT_NOTIFICATION_TYPES_BY_ROLE: Record<string, NotificationType[]> = {
  // Admin tier — visibility into everything; broadcasts often target them.
  SUPER_ADMIN: ALL_CONFIGURABLE,
  ADMIN: ALL_CONFIGURABLE,
  BRANCH_ADMIN: ALL_CONFIGURABLE,

  // CS
  HEAD_OF_CS: [
    'order:new',
    'order:assigned_bulk',
    'order:reassigned',
    'order:callback_scheduled',
    'order:callback_due',
    'hr:batch_rejected',
    'hr:batch_paid',
    ...COMMON_ACCOUNT_TYPES,
  ],
  CS_AGENT: [
    'order:assigned',
    'order:assigned_bulk',
    'order:reassigned',
    'order:transfer_requested',
    'order:transfer_accepted',
    'order:transfer_rejected',
    'order:callback_scheduled',
    'order:callback_due',
    'hr:payout_approved',
    'hr:deduction_created',
    'hr:addon_approved',
    'hr:deduction_applied',
    ...COMMON_ACCOUNT_TYPES,
  ],

  // Marketing
  HEAD_OF_MARKETING: [
    'order:new',
    'marketing:high_cpa',
    'marketing:ad_spend_submitted',
    'funding:request',
    'funding:approved',
    'funding:rejected',
    'hr:batch_rejected',
    'hr:batch_paid',
    ...COMMON_ACCOUNT_TYPES,
  ],
  MEDIA_BUYER: [
    'order:new_campaign',
    'funding:approved',
    'funding:rejected',
    'hr:payout_approved',
    'hr:deduction_created',
    'hr:addon_approved',
    'hr:deduction_applied',
    ...COMMON_ACCOUNT_TYPES,
  ],

  // Logistics
  HEAD_OF_LOGISTICS: [
    'logistics:shrinkage',
    'transfer:sent',
    'inventory:transfer_pending_approval',
    'inventory:transfer_approved',
    'inventory:transfer_rejected',
    'order:allocated',
    'hr:batch_rejected',
    'hr:batch_paid',
    ...COMMON_ACCOUNT_TYPES,
  ],
  STOCK_MANAGER: [
    'logistics:shrinkage',
    'transfer:sent',
    'inventory:transfer_pending_approval',
    'inventory:transfer_approved',
    'inventory:transfer_rejected',
    'hr:payout_approved',
    'hr:deduction_created',
    'hr:addon_approved',
    'hr:deduction_applied',
    ...COMMON_ACCOUNT_TYPES,
  ],
  TPL_MANAGER: [
    'order:allocated',
    'transfer:sent',
    'inventory:transfer_pending_approval',
    'inventory:transfer_approved',
    'inventory:transfer_rejected',
    'delivery_remittance:received',
    'hr:payout_approved',
    'hr:deduction_created',
    'hr:addon_approved',
    'hr:deduction_applied',
    ...COMMON_ACCOUNT_TYPES,
  ],
  TPL_RIDER: [
    'delivery:assigned',
    'hr:payout_approved',
    'hr:deduction_created',
    'hr:addon_approved',
    'hr:deduction_applied',
    ...COMMON_ACCOUNT_TYPES,
  ],

  // Finance / HR
  FINANCE_OFFICER: [
    'finance:approval_processed',
    'delivery_remittance:sent',
    'funding:request',
    'hr:batch_approved',
    'hr:batch_paid',
    ...COMMON_ACCOUNT_TYPES,
  ],
  HR_MANAGER: [
    'hr:batch_submitted',
    'hr:batch_rejected',
    'hr:batch_paid',
    'approval:permission_request',
    'account:probation_review_due',
    'account:probation_terminated',
    ...COMMON_ACCOUNT_TYPES,
  ],
};

/**
 * Returns the notification types this user can opt out of, given their role.
 */
export function getRelevantNotificationTypesForRole(role: string): NotificationType[] {
  const base = RELEVANT_NOTIFICATION_TYPES_BY_ROLE[role] ?? COMMON_ACCOUNT_TYPES;
  return [...new Set(base)];
}
