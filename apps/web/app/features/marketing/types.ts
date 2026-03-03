export interface FundingRecord {
  id: string;
  senderId: string;
  receiverId: string;
  amount: string;
  receiptUrl: string | null;
  status: string;
  sentAt: string;
  verifiedAt: string | null;
}

export interface AdSpendRecord {
  id: string;
  mediaBuyerId: string;
  productId: string;
  campaignId: string;
  spendAmount: string;
  screenshotUrl: string;
  spendDate: string;
}

export interface Metrics {
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredRevenue: number;
  cpa: number;
  trueRoas: number;
  deliveryRate: number;
}

export interface LeaderboardEntry {
  mediaBuyerId: string;
  name: string;
  email: string;
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredRevenue: number;
  cpa: number;
  trueRoas: number;
  deliveryRate: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
}

export interface MarketingPageProps {
  funding: FundingRecord[];
  totalFunding: number;
  adSpend: AdSpendRecord[];
  totalAdSpend: number;
  adSpendTotal: string;
  metrics: Metrics;
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
  users: User[];
  products: Product[];
  campaigns: Campaign[];
  leaderboard: LeaderboardEntry[];
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface MarketingStreamData {
  // Critical (resolved immediately)
  funding: FundingRecord[];
  totalFunding: number;
  adSpend: AdSpendRecord[];
  totalAdSpend: number;
  adSpendTotal: string;
  campaigns: Campaign[];
  // Deferred (streaming promises)
  metrics: Promise<Metrics>;
  fundingSummary: Promise<{ totalSent: string; totalCompleted: string; totalDisputed: string }>;
  leaderboard: Promise<LeaderboardEntry[]>;
  users: Promise<User[]>;
  products: Promise<Product[]>;
  leaderboardPeriod: 'this_month' | 'all_time';
}
