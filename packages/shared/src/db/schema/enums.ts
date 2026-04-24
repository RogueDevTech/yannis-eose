import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'SUPER_ADMIN',
  // ADMIN = SuperAdmin-equivalent privileges EXCEPT cannot manage another Admin or the SuperAdmin.
  // Multiple ADMINs can exist; SUPER_ADMIN is a singleton.
  'ADMIN',
  'BRANCH_ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  'CS_AGENT',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'CANCELLED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  'COMPLETED',
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
]);

export const permissionRequestStatusEnum = pgEnum('permission_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

export const adSpendStatusEnum = pgEnum('ad_spend_status', [
  'PENDING',
  'APPROVED',
]);

/** Status of a 3PL→warehouse transfer remittance (receipt upload, HoL marks received). */
export const remittanceStatusEnum = pgEnum('remittance_status', [
  'SENT',
  'RECEIVED',
  'DISPUTED',
]);

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
]);
