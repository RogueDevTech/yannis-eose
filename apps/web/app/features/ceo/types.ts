export interface CEODashboardFilters {
  startDate: string;
  endDate: string;
  periodAllTime?: boolean;
  topic?: 'orders' | 'media_buyers' | 'cs';
}

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
    /** Mean of (todayClosesCount / capacity) across CS agents — Lagos calendar day. */
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

  /** Daily buckets for Revenue & orders over time chart (Phase 2). */
  timeSeries?: { date: string; revenue: number; orderCount: number; createdCount?: number }[];

  /** Order pipeline chart: Volume, CS Engaged, Confirmed, Logistics distributed, Delivered. */
  orderPipelineChart?: {
    volume: number;
    csEngaged: number;
    confirmed: number;
    logisticsDistributed: number;
    delivered: number;
  };

  /** Topic-specific data for chart view (Media buyers / CS). */
  chartTopicData?: {
    mediaBuyerLeaderboard?: Array<{
      mediaBuyerId: string;
      name: string;
      email?: string;
      totalSpend: number;
      totalOrders: number;
      deliveredOrders: number;
      deliveredRevenue: number;
      confirmedOrders: number;
      confirmationRate: number;
      cpa: number;
      trueRoas: number;
      deliveryRate: number;
      profitabilityScore: number | null;
    }>;
    csWorkloads?: Array<{
      agentId: string;
      agentName: string;
      capacity: number;
      pendingCount: number;
      todayClosesCount?: number;
      lastActionAt?: string | null;
    }>;
  };
}

/** Payload returned by the /admin/chart-data resource route for chart view. */
export interface ChartDataPayload {
  error?: string;
  timeSeries?: { date: string; revenue: number; orderCount: number; createdCount?: number }[];
  orderPipelineChart?: {
    volume: number;
    csEngaged: number;
    confirmed: number;
    logisticsDistributed: number;
    delivered: number;
  };
  chartTopicData?: CEODashboardData['chartTopicData'];
}
