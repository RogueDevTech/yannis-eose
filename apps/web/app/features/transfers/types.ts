export interface Transfer {
  id: string;
  productId: string;
  quantitySent: number;
  quantityReceived: number | null;
  fromLocationId: string;
  toLocationId: string;
  transferStatus: string;
  shrinkageReason: string | null;
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

export const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge',
  IN_TRANSIT: 'badge-warning',
  RECEIVED: 'badge-success',
  DISPUTED: 'badge-danger',
};

/** Streaming loader shape — products and levels arrive as deferred promises */
export interface TransfersStreamData {
  transfers: Transfer[];
  locations: Location[];
  products: Promise<Product[]>;
  levels: Promise<InventoryLevel[]>;
}
