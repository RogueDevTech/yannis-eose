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

export interface FinancePageData {
  invoices: Invoice[];
  totalInvoices: number;
  profit: ProfitReport;
  invoiceSummary: Record<string, { count: number; total: string }>;
  approvals: ApprovalRequest[];
  totalApprovals: number;
  pendingApprovals: number;
  budgets: Budget[];
  filters: {
    startDate: string;
    endDate: string;
    periodAllTime?: boolean;
    invoiceStatus: string;
    approvalStatus: string;
  };
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface FinanceStreamData {
  // Critical (resolved immediately)
  invoices: Invoice[];
  totalInvoices: number;
  profit: ProfitReport;
  filters: FinancePageData['filters'];
  // Deferred (streamed)
  invoiceSummary: Promise<Record<string, { count: number; total: string }>> | Record<string, { count: number; total: string }>;
  approvals: Promise<ApprovalRequest[]> | ApprovalRequest[];
  totalApprovals: Promise<number> | number;
  pendingApprovals: Promise<number> | number;
  budgets: Promise<Budget[]> | Budget[];
}
