/**
 * Payroll Reconciliation Export (Track B) — for an already-settled month, the
 * correct-vs-paid comparison per staff, flagging UNDERPAID (feeds supplementary
 * payroll) and OVERPAID (excess to recover). Mirrors the other payroll CSV
 * exports (toCsv + downloadCsv).
 */
import { toCsv, downloadCsv } from './csv-export';

export interface PayrollReconciliationRow {
  staffName: string;
  role: string;
  expectedGross: number;
  paidGross: number;
  grossBalance: number;
  excessGross?: number;
  correctPaye: number;
  paidPaye: number;
  remainingPaye: number;
  netPayable: number;
  status?: 'UNDERPAID' | 'OVERPAID' | 'OK';
}

export interface PayrollReconciliationDoc {
  periodMonth: string;
  rows: PayrollReconciliationRow[];
}

const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'staffName', label: 'Staff Name' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'expectedGross', label: 'Correct Salary' },
  { key: 'paidGross', label: 'Salary Paid' },
  { key: 'grossBalance', label: 'Underpaid Balance' },
  { key: 'excessGross', label: 'Overpaid Excess' },
  { key: 'correctPaye', label: 'Correct PAYE' },
  { key: 'paidPaye', label: 'PAYE Deducted' },
  { key: 'remainingPaye', label: 'Remaining PAYE' },
  { key: 'netPayable', label: 'Net Payable Now' },
];

export function payrollReconciliationRows(doc: PayrollReconciliationDoc) {
  return doc.rows.map((r) => ({
    staffName: r.staffName || '',
    role: r.role || '',
    status: r.status ?? 'OK',
    expectedGross: Number(r.expectedGross).toFixed(2),
    paidGross: Number(r.paidGross).toFixed(2),
    grossBalance: Number(r.grossBalance).toFixed(2),
    excessGross: Number(r.excessGross ?? 0).toFixed(2),
    correctPaye: Number(r.correctPaye).toFixed(2),
    paidPaye: Number(r.paidPaye).toFixed(2),
    remainingPaye: Number(r.remainingPaye).toFixed(2),
    netPayable: Number(r.netPayable).toFixed(2),
  }));
}

export function payrollReconciliationCsv(doc: PayrollReconciliationDoc): string {
  return toCsv(payrollReconciliationRows(doc), COLUMNS);
}

export function downloadPayrollReconciliationCsv(doc: PayrollReconciliationDoc, filename: string): void {
  downloadCsv(payrollReconciliationCsv(doc), filename);
}
