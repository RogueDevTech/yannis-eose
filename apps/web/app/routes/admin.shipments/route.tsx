import { Outlet } from '@remix-run/react';

/**
 * Layout for `/admin/shipments/*`. Child routes (index list, receive flow,
 * shipment detail) render inside `<Outlet />`.
 */
export default function ShipmentsLayoutRoute() {
  return <Outlet />;
}
