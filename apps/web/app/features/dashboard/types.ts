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
    confirmedOrders: number;
    confirmationRate: number;
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

/** Orders + counts — deferred for navigate-first */
export interface OrdersAndCounts {
  orderCounts: Record<string, number>;
  totalOrders: number;
  recentOrders: DashboardData['recentOrders'];
  /** Offline order count for CS dashboard funnel. */
  offlineCount?: number;
}

/** What the loader returns — orders shell deferred; KPIs load post-mount via `/api/dashboard-secondary`. */
export interface DashboardLoaderData {
  ordersAndCounts: Promise<OrdersAndCounts>;
}

export interface DashboardFilters {
  startDate: string;
  endDate: string;
  periodAllTime?: boolean;
}

/** Data shape passed to DashboardPage (`ordersAndCounts` resolved in loader; metrics/profit/etc. via context). */
export type DashboardPageData = OrdersAndCounts;

export interface DashboardPageProps {
  data: DashboardPageData;
  role: string | null;
  userName: string;
  userId?: string;
  filters?: DashboardFilters;
  /**
   * True when the viewer is a Media Buyer who has been promoted to supervise
   * their branch's marketing team. The dashboard then renders the HoM-style
   * "Team Management" card and the metrics endpoint (`marketing.metrics`)
   * auto-aggregates across the supervisor's team via `supervisorScope`.
   */
  isMarketingTeamSupervisor?: boolean;
  /**
   * Symmetric for Sales — true when the viewer is a Sales Closer promoted to
   * supervise their branch's Sales team. Renders the HoCS-style "Team Management"
   * card; metrics already aggregate via `applySupervisorScope`.
   */
  isCsTeamSupervisor?: boolean;
}
