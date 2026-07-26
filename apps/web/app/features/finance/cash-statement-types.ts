export type CashLedgerStatementSummary = {
  awaitingCash: string;
  awaitingCount: number;
  pendingCash: string;
  pendingCount: number;
  remittedCash: string;
  remittedCount: number;
  disputedCash: string;
  disputedCount: number;
  deliveryFees: string;
  commitmentFees: string;
  posFees: string;
  failedDeliveryCosts: string;
  discounts: string;
  waybillCosts: string;
  batchFeesTotal: string;
  netOwedToFinance: string;
};

export type CashLedgerAwaitingOrder = {
  orderId: string;
  orderNumber: number | null;
  orderRef: string;
  deliveredAt: string | null;
  gross: string;
  deliveryFee: string;
  net: string;
};

export type CashLedgerBatch = {
  id: string;
  sentAt: string;
  status: string;
  orderCount: number;
  grossNets: string;
  deliveryFeeTotal: string;
  commitmentFee: string;
  posFee: string;
  failedDeliveryCost: string;
  discount: string;
  waybillCost: string;
  batchFeesTotal: string;
};

export type CashLedgerOrderLine = {
  orderId: string;
  orderNumber: number | null;
  orderRef: string;
  remittanceId: string;
  remittanceStatus: string;
  sentAt: string;
  deliveredAt: string | null;
  gross: string;
  deliveryFee: string;
  net: string;
};

export type CashLedgerLocationSection = {
  logisticsLocationId: string;
  locationName: string;
  providerName: string | null;
  summary: CashLedgerStatementSummary;
  awaitingOrders: CashLedgerAwaitingOrder[];
  batches: CashLedgerBatch[];
  orderLines: CashLedgerOrderLine[];
};

export type CashLedgerStatement = {
  header: {
    scope: 'location' | 'provider';
    providerId: string | null;
    providerName: string;
    logisticsLocationId: string | null;
    locationName: string | null;
    startDate: string | null;
    endDate: string | null;
    dateScope: 'createdAt' | 'deliveredAt';
    generatedAt: string;
  };
  summary: CashLedgerStatementSummary;
  locations: CashLedgerLocationSection[];
};
