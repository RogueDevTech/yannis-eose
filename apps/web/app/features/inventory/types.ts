export interface InventoryLevel {
  id: string;
  productId: string;
  locationId: string;
  stockCount: number;
  reservedCount: number;
  status: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  movementType: string;
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  reason: string | null;
  actorId: string;
  createdAt: string;
}

export const MOVEMENT_COLORS: Record<string, string> = {
  INTAKE: 'badge-success',
  RESERVATION: 'badge-info',
  ALLOCATION: 'badge-brand',
  DISPATCH: 'badge-brand',
  DELIVERY: 'badge-success',
  RETURN: 'badge-warning',
  RESTOCK: 'badge-success',
  WRITE_OFF: 'badge-danger',
  TRANSFER_OUT: 'badge-warning',
  TRANSFER_IN: 'badge-info',
  ADJUSTMENT: 'badge-warning',
};

export function formatMovementType(type: string): string {
  return type.replace(/_/g, ' ');
}

/** Product option for Stock Intake */
export interface ProductOption {
  id: string;
  name: string;
}

/** Location option for Stock Intake */
export interface LocationOption {
  id: string;
  name: string;
}

/** Streaming loader shape — movements arrive as a deferred promise */
export interface InventoryStreamData {
  levels: InventoryLevel[];
  totalLevels: number;
  movements: StockMovement[];
  totalMovements: number;
  products: ProductOption[];
  locations: LocationOption[];
  /** When false, Stock Intake button and form are hidden (view-only). */
  canIntake?: boolean;
}
