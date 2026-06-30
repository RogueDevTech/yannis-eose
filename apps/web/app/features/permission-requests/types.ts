export interface PermissionRequest {
  id: string;
  type:
    | 'USER_CREATION'
    | 'ROLE_CHANGE'
    | 'PERMISSION_GRANT'
    | 'PRODUCT_ARCHIVE'
    | 'ORDER_LINE_PRICE_CHANGE'
    | 'ORDER_DELETION'
    | 'DELIVERED_ORDER_DELETION';
  status: string;
  requesterId: string;
  targetUserId: string | null;
  requestedRole: string | null;
  permissionCode: string | null;
  reason: string;
  payload: Record<string, unknown> | null;
  approverId: string | null;
  approvalReason: string | null;
  approvedAt: string | null;
  createdAt: string;
  requesterName: string;
  requesterEmail: string;
  targetUserName: string | null;
  targetUserEmail: string | null;
  approverName: string | null;
  /** Dual-approval fields for DELIVERED_ORDER_DELETION */
  csApprovedBy?: string | null;
  csApprovedAt?: string | null;
  csNote?: string | null;
  csApproverName?: string | null;
  logiApprovedBy?: string | null;
  logiApprovedAt?: string | null;
  logiNote?: string | null;
  logiApproverName?: string | null;
}

export type PermissionRequestStatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';
