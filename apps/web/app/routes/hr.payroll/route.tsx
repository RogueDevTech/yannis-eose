import { Outlet } from '@remix-run/react';

/**
 * Layout for `/hr/payroll/*`.
 * - Index: monthly payroll list (`hr.payroll._index`)
 * - Children: generate, config, reports, payslips, etc.
 */
export default function HRPayrollLayoutRoute() {
  return <Outlet />;
}
