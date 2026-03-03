import { Outlet } from '@remix-run/react';

/**
 * Auth layout route — wraps /auth and /auth/logout.
 * Renders child routes (login form, logout handler) inside the outlet.
 */
export default function AuthLayout() {
  return <Outlet />;
}
