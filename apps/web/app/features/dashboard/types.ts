export interface DashboardData {
  orderCounts: Record<string, number>;
  totalOrders: number;
  totalUsers: number;
  totalProducts: number;
  recentOrders: Array<{
    id: string;
    customerName: string;
    customerPhoneDisplay: string;
    status: string;
    totalAmount: string | null;
    createdAt: string;
  }>;
  metrics: {
    totalSpend: number;
    totalOrders: number;
    deliveredOrders: number;
    deliveredRevenue: number;
    cpa: number;
    trueRoas: number;
    deliveryRate: number;
  };
  profit: {
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
  };
  payoutSummary: Record<string, { count: number; total: string }>;
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface DashboardLoaderData {
  // Critical (resolved immediately)
  orderCounts: Record<string, number>;
  totalOrders: number;
  recentOrders: DashboardData['recentOrders'];
  // Deferred (streaming promises)
  metrics: Promise<DashboardData['metrics']>;
  profit: Promise<DashboardData['profit']>;
  totalUsers: Promise<number>;
  totalProducts: Promise<number>;
  payoutSummary: Promise<DashboardData['payoutSummary']>;
}

export interface DashboardFilters {
  startDate: string;
  endDate: string;
  periodAllTime?: boolean;
}

export interface DashboardPageProps {
  data: DashboardLoaderData;
  role: string | null;
  userName: string;
  filters?: DashboardFilters;
}
