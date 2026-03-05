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
  adjustments: Adjustment[];
  payoutSummary: PayoutSummary;
  users: HRUser[];
  settlementConfig: SettlementConfig | null;
  currentPeriod: SettlementPeriod | null;
}
