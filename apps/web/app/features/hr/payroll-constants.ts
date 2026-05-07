import type { PayrollDepartment } from './types';

export const ALL_BRANCHES_SENTINEL = '__ALL__';
export const ALL_DEPARTMENTS_SENTINEL = '__ALL_DEPTS__';

export const ALL_DEPARTMENTS: PayrollDepartment[] = ['CS', 'MARKETING', 'LOGISTICS', 'HR'];

export const DEPT_LABEL: Record<PayrollDepartment, string> = {
  CS: 'Customer Service',
  MARKETING: 'Marketing',
  LOGISTICS: 'Logistics',
  HR: 'HR & Admin',
};

export const DEPT_OWNER_ROLE: Record<PayrollDepartment, string> = {
  CS: 'HEAD_OF_CS',
  MARKETING: 'HEAD_OF_MARKETING',
  LOGISTICS: 'HEAD_OF_LOGISTICS',
  HR: 'HR_MANAGER',
};

export const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);
