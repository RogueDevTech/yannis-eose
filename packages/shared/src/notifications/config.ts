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
  'funding:request',
  'funding:approved',
  'funding:rejected',
  'finance:approval_processed',
  'logistics:shrinkage',
  'hr:payout_approved',
  'hr:deduction_created',
  'hr:addon_approved',
  'hr:deduction_applied',
  'transfer:sent',
  'delivery_remittance:sent',
  'delivery_remittance:received',
  'account:updated',
  'account:security',
  'account:finance_hat_assigned',
  'account:finance_hat_revoked',
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
    label: 'Order allocated to location',
    description: 'TPL Manager — order allocated to their 3PL location',
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
  'transfer:sent': {
    type: 'transfer:sent',
    label: 'Stock transfer incoming',
    description: 'TPL Manager — stock transfer on the way to their location',
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
  'account:finance_hat_assigned': {
    type: 'account:finance_hat_assigned',
    label: 'Finance hat assigned',
    description: 'User — you now hold the org-wide Finance hat and can act as Finance Officer',
    mandatory: false,
    category: 'account',
  },
  'account:finance_hat_revoked': {
    type: 'account:finance_hat_revoked',
    label: 'Finance hat revoked',
    description: 'User — the Finance hat has been reassigned; you no longer hold Finance Officer powers',
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
};
