export interface Transfer {
  id: string;
  productId: string;
  quantitySent: number;
  quantityReceived: number | null;
  fromLocationId: string;
  toLocationId: string;
  transferStatus: string;
  shrinkageReason: string | null;
  /** Optional comment the receiver added when marking received. */
  receiverNotes?: string | null;
  transferCost: string | null;
  createdAt: string;
  verifiedAt: string | null;
  /** Initiator (set on create — needed for PENDING rows to surface a sender name). */
  initiatedBy?: string | null;
  /** Approval / rejection audit columns — set when status flips to IN_TRANSIT or REJECTED. */
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  /**
   * Source provider kind enriched server-side (`WAREHOUSE` | `THIRD_PARTY`).
   * Used by the client to mirror the source-authority gate when deciding whether
   * to render Approve / Reject buttons. Server is canonical.
   */
  sourceProviderKind?: 'WAREHOUSE' | 'THIRD_PARTY' | null;
  /**
   * Server-computed: true when the current viewer is the source-authority for
   * this transfer's source location AND the row is `PENDING`. Used to gate
   * Approve / Reject buttons in the UI. The server re-checks on submit so this
   * flag is just a UI hint — never trust it to decide who can approve.
   */
  canApprove?: boolean;
  /** Sender / initiator name resolved server-side. */
  senderName?: string | null;
}

export interface Location {
  id: string;
  providerId: string;
  name: string;
  address: string;
  status: string;
  providerName: string | null;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  status: string;
}

export interface InventoryLevel {
  id: string;
  productId: string;
  locationId: string;
  stockCount: number;
  reservedCount: number;
  status: string;
}

/** Streaming loader shape — products and levels arrive as deferred promises */
export interface TransfersStreamData {
  transfers: Transfer[];
  transfersTotal?: number;
  transfersPage?: number;
  transfersTotalPages?: number;
  locations: Location[];
  /** Loaded post-mount from `/api/transfers-form-data`. */
  products: Product[] | null;
  /** Loaded post-mount from `/api/transfers-form-data`. */
  levels: InventoryLevel[] | null;
  /** When false (e.g. TPL view), hide Initiate Transfer button and form */
  canInitiate?: boolean;
  /** `logistics` — copy tuned for Head of Logistics partner-to-partner moves */
  transfersPageVariant?: 'stock' | 'logistics';
}
