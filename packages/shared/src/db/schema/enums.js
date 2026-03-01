"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordStatusEnum = exports.callStatusEnum = exports.stockStateEnum = exports.deploymentTypeEnum = exports.adjustmentCategoryEnum = exports.payoutStatusEnum = exports.invoiceStatusEnum = exports.fundingStatusEnum = exports.transferStatusEnum = exports.movementTypeEnum = exports.orderStatusEnum = exports.userRoleEnum = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.userRoleEnum = (0, pg_core_1.pgEnum)('user_role', [
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
exports.orderStatusEnum = (0, pg_core_1.pgEnum)('order_status', [
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
exports.movementTypeEnum = (0, pg_core_1.pgEnum)('movement_type', [
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
exports.transferStatusEnum = (0, pg_core_1.pgEnum)('transfer_status', [
    'PENDING',
    'IN_TRANSIT',
    'RECEIVED',
    'DISPUTED',
]);
exports.fundingStatusEnum = (0, pg_core_1.pgEnum)('funding_status', [
    'SENT',
    'COMPLETED',
    'DISPUTED',
]);
exports.invoiceStatusEnum = (0, pg_core_1.pgEnum)('invoice_status', [
    'DRAFT',
    'SENT',
    'PAID',
    'OVERDUE',
    'CANCELLED',
]);
exports.payoutStatusEnum = (0, pg_core_1.pgEnum)('payout_status', [
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'PAID',
    'REJECTED',
]);
exports.adjustmentCategoryEnum = (0, pg_core_1.pgEnum)('adjustment_category', [
    'BONUS',
    'EXTRA_SHIFT',
    'PERFORMANCE',
    'DEDUCTION',
    'CLAWBACK',
    'OTHER',
]);
exports.deploymentTypeEnum = (0, pg_core_1.pgEnum)('deployment_type', [
    'SNIPPET',
    'IFRAME',
    'HOSTED',
]);
exports.stockStateEnum = (0, pg_core_1.pgEnum)('stock_state', [
    'AVAILABLE',
    'RESERVED',
    'ALLOCATED_TO_3PL',
    'IN_TRANSIT',
    'DELIVERED',
    'RETURNED',
    'WRITTEN_OFF',
]);
exports.callStatusEnum = (0, pg_core_1.pgEnum)('call_status', [
    'INITIATED',
    'RINGING',
    'IN_PROGRESS',
    'COMPLETED',
    'FAILED',
    'NO_ANSWER',
    'BUSY',
]);
exports.recordStatusEnum = (0, pg_core_1.pgEnum)('record_status', [
    'ACTIVE',
    'INACTIVE',
    'ARCHIVED',
]);
//# sourceMappingURL=enums.js.map