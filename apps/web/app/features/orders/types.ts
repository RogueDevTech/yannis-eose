export interface Order {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  status: string;
  totalAmount: string | null;
  createdAt: string;
  assignedCsId: string | null;
}

export interface CallLogEntry {
  id: string;
  orderId: string;
  agentId: string;
  callToken: string | null;
  callStatus: string;
  durationSeconds: number | null;
  recordingUrl: string | null;
  startedAt: string;
}

export interface OrderDetail {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  customerAddress: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  status: string;
  totalAmount: string | null;
  createdAt: string;
  confirmedAt: string | null;
  allocatedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  assignedCsId: string | null;
  orderItems: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string;
  }>;
  callLogs: Array<{
    id: string;
    callStatus: string;
    durationSeconds: number | null;
    startedAt: string;
  }>;
  allowedTransitions: string[];
}

export interface HistoryEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: string;
  changedBy: string | null;
  validFrom: string;
  validTo: string | null;
  data: Record<string, unknown>;
}

export interface OrderDetailPageProps {
  order: OrderDetail;
  latestCall: CallLogEntry | null;
  history: HistoryEntry[];
}

/** What the loader returns — mix of resolved data + streaming promises */
export interface OrderDetailStreamData {
  // Critical (resolved immediately) — 404 check requires await
  order: OrderDetail;
  // Deferred (streaming promises)
  latestCall: Promise<CallLogEntry | null>;
  history: Promise<HistoryEntry[]>;
  // Strict Data Mode flag
  strictDataMode: boolean;
  // VOIP feature flag
  voipEnabled: boolean;
}
