export interface Invoice {
  id: string;
  referenceNumber: number;
  referenceFormatted: string;
  orderId: string | null;
  recipientInfo: { name: string; address?: string; email?: string; phone?: string };
  lineItems: { description: string; quantity: number; unitPrice: string }[];
  totalAmount: string;
  taxRate: string | null;
  status: string;
  dueDate: string | null;
  createdAt: string;
}

export interface ProductProfitBreakdownRow {
  productId: string;
  productName: string;
  revenue: number;
  landedCost: number;
  deliveryFee: number;
  adSpend: number;
  allocatedCommission: number;
  allocatedFulfillment: number;
  allocatedOperationalLoss: number;
  contribution: number;
  marginPct: number;
  orderCount: number;
}

export interface ProfitReport {
  revenue: number;
  landedCost: number;
  deliveryFee: number;
  adSpend: number;
  commission: number;
  fulfillmentCost: number;
  operationalLoss: number;
  trueProfit: number;
  orderCount: number;
  margin: number;
  /** Present when `groupBy: 'product'` on `finance.profitReport`. */
  byProduct?: ProductProfitBreakdownRow[];
}

/** Live ops counts for the finance overview rail (not tied to profit date range). */
export interface FinanceOverviewPulse {
  awaitingCash: number;
  awaitingOrderCount: number;
  pendingRemittanceAmount: number;
  pendingRemittanceBatchCount: number;
  disputedRemittanceBatchCount: number;
  payrollPendingFinanceCount: number;
  approvalsPendingCount: number;
}

export interface ApprovalRequest {
  id: string;
  type: string;
  requesterId: string;
  amount: string;
  description: string;
  status: string;
  approverId: string | null;
  approvalReason: string | null;
  approvedAt: string | null;
  budgetId: string | null;
  createdAt: string;
}

export interface Budget {
  id: string;
  name: string;
  departmentOrCampaign: string;
  totalBudget: string;
  periodStart: string;
  periodEnd: string;
}

export interface BudgetWithUtilization extends Budget {
  approved: number;
  committed: number;
  remaining: number;
  total: number;
  utilizationPct: number;
  isActive: boolean;
}

/** `/admin/finance/overview` loader shape */
export interface FinanceOverviewLoaderData {
  profit: ProfitReport;
  pulse: FinanceOverviewPulse;
  filters: {
    startDate: string;
    endDate: string;
    periodAllTime?: boolean;
  };
}
