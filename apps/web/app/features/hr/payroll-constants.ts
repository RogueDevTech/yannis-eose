import type { PayrollDepartment } from './types';

export const ALL_BRANCHES_SENTINEL = '__ALL__';
export const ALL_DEPARTMENTS_SENTINEL = '__ALL_DEPTS__';

export const ALL_DEPARTMENTS: PayrollDepartment[] = ['CS', 'MARKETING', 'LOGISTICS', 'HR', 'OPERATIONS', 'FINANCE', 'SUPPORT'];

export const DEPT_LABEL: Record<PayrollDepartment, string> = {
  CS: 'CS',
  MARKETING: 'Marketing',
  LOGISTICS: 'Logistics',
  HR: 'HR',
  OPERATIONS: 'Operations',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
};

export const DEPT_OWNER_ROLE: Record<PayrollDepartment, string> = {
  CS: 'HEAD_OF_CS',
  MARKETING: 'HEAD_OF_MARKETING',
  LOGISTICS: 'HEAD_OF_LOGISTICS',
  HR: 'HR_MANAGER',
  OPERATIONS: 'SUPER_ADMIN',
  FINANCE: 'FINANCE_OFFICER',
  SUPPORT: 'SUPER_ADMIN',
};

// SUPPORT is a platform-level actor (bypasses permissionProcedure) and acts as a
// full admin on payroll — parity with the backend canReviewBatch / canPrepareDept
// gates. Without it, SUPPORT sees batches but can't Adjust/Remove/Regenerate/Delete.
export const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);

/**
 * Human label for a batch's department, tolerant of null-scope batches
 * (scopeType CONTRACTORS / ALL) which have no department.
 */
export function batchScopeLabel(
  department: PayrollDepartment | string | null | undefined,
  scopeType?: string | null,
): string {
  if (department) return DEPT_LABEL[department as PayrollDepartment] ?? department;
  if (scopeType === 'CONTRACTORS') return 'Contractors';
  if (scopeType === 'ALL') return 'All staff & contractors';
  return 'Payroll';
}

/** Human label for a batch's branch, tolerant of null-branch (org-wide) batches. */
export function batchBranchLabel(
  branchName: string | null | undefined,
  branchId: string | null | undefined,
  scopeType?: string | null,
): string {
  if (branchName) return branchName;
  if (branchId) return branchId.slice(0, 8);
  if (scopeType === 'CONTRACTORS' || scopeType === 'ALL') return 'Org-wide';
  return 'Unknown';
}
