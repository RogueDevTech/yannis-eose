import { Outlet } from '@remix-run/react';

/**
 * Layout for `/admin/marketing/forms/*`. Child routes (`_index`, `new`, `:id/builder` → redirect to edit, `:id/edit`)
 * render inside `<Outlet />`. Without this, nested URLs matched the parent but never displayed
 * their UI because the parent previously rendered only the list with no outlet.
 */
export default function MarketingFormsLayoutRoute() {
  return <Outlet />;
}
