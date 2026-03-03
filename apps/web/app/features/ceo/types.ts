export interface CEODashboardData {
  // Revenue & Profit
  revenue: number;
  trueProfit: number;
  margin: number;
  costBreakdown: {
    landedCost: number;
    deliveryFee: number;
    adSpend: number;
    commission: number;
    fulfillmentCost: number;
    operationalLoss: number;
  };

  // Order Pipeline
  orderPipeline: {
    total: number;
    active: number;
    delivered: number;
    cancelled: number;
    returned: number;
    statusCounts: Record<string, number>;
  };

  // Marketing
  marketing: {
    totalSpend: number;
    cpa: number;
    roas: number;
    deliveryRate: number;
  };

  // CS Team
  csTeam: {
    agentCount: number;
    pendingOrders: number;
    utilization: number;
  };

  // HR / Payroll
  payroll: {
    totalPaid: number;
    totalPending: number;
    staffCount: number;
  };

  // Invoices
  invoiceSummary: Record<string, unknown>;
}
