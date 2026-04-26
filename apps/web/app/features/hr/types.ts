export interface CommissionPlan {
  id: string;
  role: string;
  planName: string;
  rules: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface Payout {
  id: string;
  staffId: string;
  periodStart: string;
  periodEnd: string;
  baseSalary: string;
  performanceBonus: string;
  addOnsTotal: string;
  deductionsTotal: string;
  totalPayout: string;
  status: string;
}

export interface Adjustment {
  id: string;
  staffId: string;
  amount: string;
  category: string;
  reason: string;
  approvedBy: string | null;
  createdAt: string;
}

export interface HRUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SettlementConfig {
  windowType: string;
  startDay: number;
  createdAt: string;
}

export interface SettlementPeriod {
  periodStart: string;
  periodEnd: string;
  windowType: string;
}

export interface PayoutSummary {
  [status: string]: { count: number; total: string };
}

// ── Payroll Batches (multi-stage monthly workflow) ─────────────

export type PayrollBatchStatus = 'DRAFT' | 'PENDING_HR' | 'PENDING_FINANCE' | 'PAID';
export type PayrollDepartment = 'CS' | 'MARKETING' | 'LOGISTICS' | 'HR';

export interface PayrollBatch {
  id: string;
  branchId: string;
  periodMonth: string;
  department: PayrollDepartment;
  status: PayrollBatchStatus;
  preparedBy: string | null;
  preparedAt: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  hrReviewedAt: string | null;
  hrReviewedBy: string | null;
  hrNotes: string | null;
  financeProcessedAt: string | null;
  financeProcessedBy: string | null;
  financeReference: string | null;
  rejectionReason: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  staffCount: number;
  totalAmount: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyPayrollGroup {
  month: string;
  totalAmount: number;
  staffCount: number;
  items: PayrollBatch[];
}

export interface BranchOption {
  id: string;
  name: string;
  code?: string;
}

/** Lightweight session info passed from loader → page. */
export interface ViewerInfo {
  id: string;
  role: string;
  currentBranchId: string | null;
  isFinanceOfficer: boolean;
}

export interface HRPageProps {
  plans: CommissionPlan[];
  totalPlans: number;
  payouts: Payout[];
  totalPayouts: number;
  adjustments: Adjustment[];
  payoutSummary: PayoutSummary;
  users: HRUser[];
  settlementConfig: SettlementConfig | null;
  currentPeriod: SettlementPeriod | null;
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface HRStreamData {
  // Critical (resolved immediately)
  plans: CommissionPlan[];
  totalPlans: number;
  payouts: Payout[];
  totalPayouts: number;
  /** Current page for the payouts table (from URL `payoutPage` param). */
  payoutPage: number;
  /** Total pages available for the current filter. */
  totalPayoutPages: number;
  /** Current status filter for payouts (`'ALL'` or a PayoutStatus). */
  payoutStatus: string;
  adjustments: Adjustment[];
  payoutSummary: PayoutSummary;
  users: HRUser[];
  settlementConfig: SettlementConfig | null;
  currentPeriod: SettlementPeriod | null;
  // Multi-stage payroll batches
  monthlyPayrolls: MonthlyPayrollGroup[];
  branches: BranchOption[];
  viewer: ViewerInfo;
  /** When set, batch detail panel opens for this batch on mount. */
  initialBatchId: string | null;
}
