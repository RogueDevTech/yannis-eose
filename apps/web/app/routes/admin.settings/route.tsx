import { Outlet } from '@remix-run/react';

/**
 * Layout for `/admin/settings/*`. Child routes (e.g. role-templates) render in `<Outlet />`.
 * The main Settings UI lives in `admin.settings._index`.
 */
export default function AdminSettingsLayoutRoute() {
  return <Outlet />;
}
