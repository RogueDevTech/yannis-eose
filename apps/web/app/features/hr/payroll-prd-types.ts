export type ProductTierRow = {
  fromPct: number;
  toPct?: number | null;
  ratePerOrder: number;
};

export type ProductTierConfig = {
  id: string;
  productId: string | null;
  productName: string;
  branchIds: string[] | null;
  active: boolean;
  tierRows: ProductTierRow[];
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type PayRole = {
  id: string;
  name: string;
  category: string;
  reportsToRequired: boolean;
  perProductBonus: boolean;
  commissionPlanId: string | null;
  active: boolean;
  staffCount?: number;
};

export type PayeBandRow = {
  fromAmount: number;
  toAmount?: number | null;
  rate: number;
};

export type PayeReliefRow = {
  name: string;
  basis: 'PERCENT_OF_GROSS' | 'PERCENT_OF_MONTHLY_GROSS' | 'FLAT_ANNUAL';
  rate: number;
  amount?: number;
  cap?: number | null;
};

export type TaxBandConfig = {
  id: string;
  label: string;
  taxFreeThreshold: string;
  bands: PayeBandRow[];
  reliefs: PayeReliefRow[];
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type PayePreviewResult = {
  monthlyGross: number;
  annualGross: number;
  chargeableAnnual: number;
  annualTax: number;
  monthlyPaye: number;
  employerSubsidy: number;
  employeePaye: number;
  reliefBreakdown: Array<{ name: string; amount: number }>;
};

export type PayrollOnboardingQueueItem = {
  id: string;
  name: string;
  email: string;
  role: string;
  primaryBranchId: string | null;
  onboardingPayrollStatus: string;
  createdAt: string;
};

export type PayslipListItem = {
  payout: {
    id: string;
    staffId: string | null;
    baseSalary: string;
    performanceBonus: string;
    allowancesTotal: string;
    addOnsTotal: string;
    deductionsTotal: string;
    grossPay: string;
    payeTax: string;
    netPay: string;
    payRoleName: string | null;
    bonusBreakdown: unknown;
    periodStart: string;
    periodEnd: string;
  };
  batch: {
    id: string;
    periodMonth: string;
    branchId: string;
    department: string;
    status: string;
    disbursementDate?: string | null;
    financeProcessedAt?: string | null;
  };
  staffName: string | null;
  /** System user role (e.g. CS_CLOSER); null for contractors. */
  staffRole: string | null;
};

export type PayrollRegisterRow = {
  payout: {
    id: string;
    baseSalary: string;
    performanceBonus: string;
    allowancesTotal: string;
    addOnsTotal: string;
    deductionsTotal: string;
    grossPay: string;
    payeTax: string;
    netPay: string;
    totalPayout: string;
    payRoleName: string | null;
  };
  batch: {
    id: string;
    periodMonth: string;
    branchId: string;
    department: string;
    status: string;
  };
  staffName: string | null;
  staffRole: string | null;
};

export type PayrollContractor = {
  id: string;
  name: string;
  jobTitle: string | null;
  branchId: string | null;
  monthlyFee: string;
  bankName: string | null;
  bankCode: string | null;
  accountNumber: string | null;
  accountName: string | null;
  bankVerified: boolean;
  active: boolean;
  notes: string | null;
};

export type ContractorPayoutRow = {
  payoutId: string;
  batchId: string;
  periodMonth: string;
  department: string;
  branchId: string;
  branchName: string;
  batchStatus: string;
  payoutStatus: string;
  monthlyFee: string;
  grossPay: string;
  netPay: string;
  totalPayout: string;
  financeReference: string | null;
  disbursementDate: string | null;
  financeProcessedAt: string | null;
  createdAt: string;
};

export type BranchOption = { id: string; name: string; code?: string };
