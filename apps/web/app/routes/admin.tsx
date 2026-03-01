import { DashboardLayout } from '~/components/layout/dashboard-layout';

/**
 * Admin layout route — wraps all /admin/* routes with the dashboard layout.
 * Child routes render inside the <Outlet /> within DashboardLayout.
 */
export default function AdminLayout() {
  // TODO: Replace with actual user data from session/loader
  const mockUser = {
    name: 'Admin User',
    role: 'SUPER_ADMIN',
    email: 'admin@yannis.com',
  };

  return <DashboardLayout user={mockUser} />;
}
