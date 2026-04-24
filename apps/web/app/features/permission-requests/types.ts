export interface PermissionRequest {
  id: string;
  type: 'USER_CREATION' | 'ROLE_CHANGE' | 'PERMISSION_GRANT';
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
}

export type PermissionRequestStatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';
