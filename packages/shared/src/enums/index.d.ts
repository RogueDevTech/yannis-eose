export declare const ORDER_STATUS: {
    readonly UNPROCESSED: "UNPROCESSED";
    readonly CS_ENGAGED: "CS_ENGAGED";
    readonly CONFIRMED: "CONFIRMED";
    readonly CANCELLED: "CANCELLED";
    readonly ALLOCATED: "ALLOCATED";
    readonly DISPATCHED: "DISPATCHED";
    readonly IN_TRANSIT: "IN_TRANSIT";
    readonly DELIVERED: "DELIVERED";
    readonly PARTIALLY_DELIVERED: "PARTIALLY_DELIVERED";
    readonly RETURNED: "RETURNED";
    readonly RESTOCKED: "RESTOCKED";
    readonly WRITTEN_OFF: "WRITTEN_OFF";
    readonly COMPLETED: "COMPLETED";
};
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
export declare const USER_ROLE: {
    readonly SUPER_ADMIN: "SUPER_ADMIN";
    readonly HEAD_OF_MARKETING: "HEAD_OF_MARKETING";
    readonly MEDIA_BUYER: "MEDIA_BUYER";
    readonly HEAD_OF_CS: "HEAD_OF_CS";
    readonly CS_AGENT: "CS_AGENT";
    readonly FINANCE_OFFICER: "FINANCE_OFFICER";
    readonly HEAD_OF_LOGISTICS: "HEAD_OF_LOGISTICS";
    readonly WAREHOUSE_MANAGER: "WAREHOUSE_MANAGER";
    readonly TPL_MANAGER: "TPL_MANAGER";
    readonly TPL_RIDER: "TPL_RIDER";
    readonly HR_MANAGER: "HR_MANAGER";
};
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];
export declare const MOVEMENT_TYPE: {
    readonly INTAKE: "INTAKE";
    readonly RESERVATION: "RESERVATION";
    readonly ALLOCATION: "ALLOCATION";
    readonly DISPATCH: "DISPATCH";
    readonly DELIVERY: "DELIVERY";
    readonly RETURN: "RETURN";
    readonly RESTOCK: "RESTOCK";
    readonly WRITE_OFF: "WRITE_OFF";
    readonly TRANSFER_OUT: "TRANSFER_OUT";
    readonly TRANSFER_IN: "TRANSFER_IN";
    readonly ADJUSTMENT: "ADJUSTMENT";
};
export type MovementType = (typeof MOVEMENT_TYPE)[keyof typeof MOVEMENT_TYPE];
export declare const TRANSFER_STATUS: {
    readonly PENDING: "PENDING";
    readonly IN_TRANSIT: "IN_TRANSIT";
    readonly RECEIVED: "RECEIVED";
    readonly DISPUTED: "DISPUTED";
};
export type TransferStatus = (typeof TRANSFER_STATUS)[keyof typeof TRANSFER_STATUS];
export declare const FUNDING_STATUS: {
    readonly SENT: "SENT";
    readonly COMPLETED: "COMPLETED";
    readonly DISPUTED: "DISPUTED";
};
export type FundingStatus = (typeof FUNDING_STATUS)[keyof typeof FUNDING_STATUS];
export declare const INVOICE_STATUS: {
    readonly DRAFT: "DRAFT";
    readonly SENT: "SENT";
    readonly PAID: "PAID";
    readonly OVERDUE: "OVERDUE";
    readonly CANCELLED: "CANCELLED";
};
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];
export declare const PAYOUT_STATUS: {
    readonly DRAFT: "DRAFT";
    readonly PENDING_APPROVAL: "PENDING_APPROVAL";
    readonly APPROVED: "APPROVED";
    readonly PAID: "PAID";
    readonly REJECTED: "REJECTED";
};
export type PayoutStatus = (typeof PAYOUT_STATUS)[keyof typeof PAYOUT_STATUS];
export declare const ADJUSTMENT_CATEGORY: {
    readonly BONUS: "BONUS";
    readonly EXTRA_SHIFT: "EXTRA_SHIFT";
    readonly PERFORMANCE: "PERFORMANCE";
    readonly DEDUCTION: "DEDUCTION";
    readonly CLAWBACK: "CLAWBACK";
    readonly OTHER: "OTHER";
};
export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORY)[keyof typeof ADJUSTMENT_CATEGORY];
export declare const DEPLOYMENT_TYPE: {
    readonly SNIPPET: "SNIPPET";
    readonly IFRAME: "IFRAME";
    readonly HOSTED: "HOSTED";
};
export type DeploymentType = (typeof DEPLOYMENT_TYPE)[keyof typeof DEPLOYMENT_TYPE];
export declare const STOCK_STATE: {
    readonly AVAILABLE: "AVAILABLE";
    readonly RESERVED: "RESERVED";
    readonly ALLOCATED_TO_3PL: "ALLOCATED_TO_3PL";
    readonly IN_TRANSIT: "IN_TRANSIT";
    readonly DELIVERED: "DELIVERED";
    readonly RETURNED: "RETURNED";
    readonly WRITTEN_OFF: "WRITTEN_OFF";
};
export type StockState = (typeof STOCK_STATE)[keyof typeof STOCK_STATE];
