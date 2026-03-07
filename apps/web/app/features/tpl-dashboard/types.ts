export interface TplDashboardData {
  recentOrders: Array<{
    id: string;
    customerName: string;
    status: string;
    totalAmount: string | null;
    createdAt: string;
    preferredDeliveryDate: string | null;
  }>;
  orderCounts: Record<string, number>;
  totalOrders: number;
  inTransitTransfers: number;
  returnsQueue: number;
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}
