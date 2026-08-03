import type { PayslipPdfInput } from '~/lib/payslip-pdf';
import { formatRole } from '~/features/users/types';
import { batchScopeLabel } from './payroll-constants';

export type PayslipApiRow = {
  payout: {
    id: string;
    staffId?: string | null;
    baseSalary: string | number;
    performanceBonus: string | number;
    allowancesTotal: string | number;
    addOnsTotal: string | number;
    deductionsTotal: string | number;
    grossPay: string | number;
    payeTax: string | number;
    netPay: string | number;
    totalPayout?: string | number | null;
    payRoleName?: string | null;
    bonusBreakdown?: unknown;
    metricsSnapshot?: unknown;
    createdAt?: string | null;
  };
  batch: {
    id: string;
    periodMonth: string;
    // Null for null-scope batches (contractors / ALL).
    department: string | null;
    status?: string;
    disbursementDate?: string | null;
    financeProcessedAt?: string | null;
  };
  staffName: string | null;
  /** System role from users.role when staff-linked. */
  staffRole?: string | null;
  branchName?: string | null;
};

/** Prefer disbursement → finance marked paid → payout created. */
function resolveIssuedAt(row: PayslipApiRow): { issuedAt: string; issuedAtLabel: string } | null {
  if (row.batch.disbursementDate) {
    return { issuedAt: row.batch.disbursementDate, issuedAtLabel: 'Paid' };
  }
  if (row.batch.financeProcessedAt) {
    return { issuedAt: row.batch.financeProcessedAt, issuedAtLabel: 'Paid' };
  }
  if (row.payout.createdAt) {
    return { issuedAt: row.payout.createdAt, issuedAtLabel: 'Date' };
  }
  return null;
}

function formatPeriod(month: string): string {
  const d = new Date(month);
  if (Number.isNaN(d.getTime())) return month;
  return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

function parseBonusLines(breakdown: unknown): Array<{ label: string; amount: number }> {
  if (!Array.isArray(breakdown)) return [];
  return breakdown
    .map((line) => {
      if (!line || typeof line !== 'object') return null;
      const obj = line as Record<string, unknown>;
      const label = String(obj.label ?? obj.name ?? 'Bonus');
      const amount = Number(obj.amount ?? 0);
      if (!Number.isFinite(amount)) return null;
      return { label, amount };
    })
    .filter((x): x is { label: string; amount: number } => x != null);
}

/** Extract the "N of M days worked" note from a payout's metrics snapshot. */
function resolveProrationNote(metricsSnapshot: unknown): string | undefined {
  if (!metricsSnapshot || typeof metricsSnapshot !== 'object') return undefined;
  const p = (metricsSnapshot as { proration?: { activeDays?: number; periodDays?: number } }).proration;
  if (!p || !p.periodDays || p.activeDays == null || p.activeDays >= p.periodDays) return undefined;
  return `Prorated: ${p.activeDays} of ${p.periodDays} days worked`;
}

/** Map API payslip / listPayslips row into PDF + preview input. */
export function toPayslipPdfInput(row: PayslipApiRow): PayslipPdfInput {
  const periodLabel = formatPeriod(row.batch.periodMonth);
  const issued = resolveIssuedAt(row);
  const roleName = row.staffRole
    ? formatRole(row.staffRole)
    : row.payout.payRoleName?.trim() || undefined;
  return {
    periodLabel,
    reference: `Payslip · ${row.payout.id.slice(0, 8).toUpperCase()}`,
    issuedAt: issued?.issuedAt,
    issuedAtLabel: issued?.issuedAtLabel,
    employeeName: row.staffName ?? 'Unknown',
    employeeId: row.payout.staffId ?? undefined,
    roleName,
    department: batchScopeLabel(row.batch.department),
    branchName: row.branchName ?? undefined,
    periodMonth: row.batch.periodMonth,
    baseSalary: Number(row.payout.baseSalary),
    performanceBonus: Number(row.payout.performanceBonus),
    allowancesTotal: Number(row.payout.allowancesTotal),
    addOnsTotal: Number(row.payout.addOnsTotal),
    deductionsTotal: Number(row.payout.deductionsTotal),
    grossPay: Number(row.payout.grossPay),
    payeTax: Number(row.payout.payeTax),
    // Cash to bank (after clawbacks); falls back to netPay when totalPayout unset.
    netPay: Number(row.payout.totalPayout ?? row.payout.netPay),
    bonusLines: parseBonusLines(row.payout.bonusBreakdown),
    prorationNote: resolveProrationNote(row.payout.metricsSnapshot),
  };
}

export function payslipFilename(row: PayslipApiRow): string {
  const name = (row.staffName ?? 'staff').replace(/\s+/g, '-').toLowerCase();
  return `payslip-${name}-${row.batch.periodMonth.slice(0, 7)}.pdf`;
}
