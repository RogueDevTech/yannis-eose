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
