export interface ReturnedOrder {
  id: string;
  customerName: string;
  status: string;
  items: unknown;
  logisticsLocationId: string | null;
  deliveryNotes: string | null;
  updatedAt: string;
}

export interface Location {
  id: string;
  name: string;
  address: string;
  dispatchLocked: boolean;
  status: string;
}

export interface Reconciliation {
  id: string;
  locationId: string;
  productId: string;
  digitalCount: number;
  physicalCount: number;
  discrepancy: number;
  reasonCode: string;
  notes: string | null;
  reconciliationStatus: string;
  submittedBy: string;
  approvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
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
}

export interface ReturnsLoaderData {
  returnedOrders: ReturnedOrder[];
  locations: Location[];
  reconciliations: Reconciliation[];
  products: Product[];
  levels: InventoryLevel[];
}

/** Streaming loader shape — reconciliations, products, levels arrive as deferred promises */
export interface ReturnsStreamData {
  returnedOrders: ReturnedOrder[];
  locations: Location[];
  reconciliations: Promise<Reconciliation[]>;
  products: Promise<Product[]>;
  levels: Promise<InventoryLevel[]>;
}
