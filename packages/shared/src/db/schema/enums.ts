import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'SUPER_ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  'CS_AGENT',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'WAREHOUSE_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'UNPROCESSED',
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
