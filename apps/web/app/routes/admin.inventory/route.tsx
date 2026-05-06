import { Outlet } from '@remix-run/react';

/**
 * Layout for `/admin/inventory/*`. Child routes (index hub, warehouses, shipment detail)
 * render inside `<Outlet />`. Without this, `/admin/inventory/warehouses` matched the
 * parent but never showed the warehouses module — only the index `InventoryPage` ran.
 */
export default function InventoryLayoutRoute() {
  return <Outlet />;
}
