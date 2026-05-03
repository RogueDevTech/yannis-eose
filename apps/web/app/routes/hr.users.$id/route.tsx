import { Outlet } from '@remix-run/react';

/**
 * Layout for `/hr/users/:id/*`.
 * - Index: user detail (`hr.users.$id._index`)
 * - Child: HR onboarding workflow (`hr.users.$id.onboarding`)
 */
export default function HrUserIdLayoutRoute() {
  return <Outlet />;
}
