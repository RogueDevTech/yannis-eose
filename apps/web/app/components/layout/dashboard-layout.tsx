import { useState, useEffect } from 'react';
import { Outlet } from '@remix-run/react';
import { Sidebar, SidebarIcons, type SidebarGroup } from './sidebar';
import { Header } from './header';
import { useSocket, useRealtimeNotifications } from '~/hooks/useSocket';
import { ToastProvider } from '~/components/ui/toast';
import { subscribeToPush } from '~/lib/offline-sync';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
  data?: Record<string, unknown> | null;
}

export type NotificationsPromise = Promise<{ notifications: Notification[]; unreadCount: number }>;

interface DashboardLayoutProps {
  user: {
    name: string;
    role: string;
    email: string;
    permissions?: string[];
  } | null;
  notificationsPromise: NotificationsPromise;
}

interface NavItemDef {
  label: string;
  href: string;
  icon: React.ReactNode;
  permission?: string; // undefined = all authenticated users
}

interface NavGroupDef {
  group: string | null;
  items: NavItemDef[];
}

const navStructure: NavGroupDef[] = [
  {
    group: null,
    items: [
      { label: 'Dashboard', href: '/admin', icon: SidebarIcons.dashboard },
    ],
  },
  {
    group: 'Sales & CS',
    items: [
      { label: 'CS Orders', href: '/admin/cs/orders', icon: SidebarIcons.orders, permission: 'orders.read' },
      { label: 'CS Overview', href: '/admin/cs', icon: SidebarIcons.cs, permission: 'cs.teamOverview' },
      { label: 'CS Leaderboard', href: '/admin/cs-leaderboard', icon: SidebarIcons.leaderboards, permission: 'cs.leaderboard' },
    ],
  },
  {
    group: 'Marketing',
    items: [
      { label: 'Marketing Orders', href: '/admin/marketing/orders', icon: SidebarIcons.orders, permission: 'marketing.orders' },
      { label: 'Team Overview', href: '/admin/marketing-overview', icon: SidebarIcons.marketing, permission: 'marketing.teamOverview' },
      { label: 'Funding & Ad Spend', href: '/admin/marketing', icon: SidebarIcons.marketing, permission: 'marketing.read' },
      { label: 'Forms', href: '/admin/forms', icon: SidebarIcons.campaigns, permission: 'marketing.campaigns' },
      { label: 'Marketing Leaderboard', href: '/admin/marketing-leaderboard', icon: SidebarIcons.leaderboards, permission: 'marketing.leaderboard' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { label: 'Finance', href: '/admin/finance', icon: SidebarIcons.finance, permission: 'finance.read' },
      { label: 'Disbursements', href: '/admin/disbursements', icon: SidebarIcons.finance, permission: 'finance.disburse' },
    ],
  },
  {
    group: 'Warehouse & Logistics',
    items: [
      { label: 'Inventory', href: '/admin/inventory', icon: SidebarIcons.inventory, permission: 'inventory.read' },
      { label: 'Logistics', href: '/admin/logistics', icon: SidebarIcons.logistics, permission: 'logistics.read' },
      { label: 'Transfers', href: '/admin/transfers', icon: SidebarIcons.transfers, permission: 'transfers.read' },
      { label: 'Returns', href: '/admin/returns', icon: SidebarIcons.returns, permission: 'returns.read' },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { label: 'Products', href: '/admin/products', icon: SidebarIcons.products, permission: 'products.read' },
      { label: 'Categories', href: '/admin/categories', icon: SidebarIcons.categories, permission: 'categories.read' },
    ],
  },
  {
    group: 'HR',
    items: [
      { label: 'Payroll', href: '/hr/payroll', icon: SidebarIcons.hr, permission: 'hr.read' },
      { label: 'Users', href: '/hr/users', icon: SidebarIcons.users, permission: 'users.read' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { label: 'Settings', href: '/admin/settings', icon: SidebarIcons.settings },
      { label: 'Audit Trail', href: '/admin/audit', icon: SidebarIcons.audit, permission: 'audit.read' },
      { label: 'Permission Requests', href: '/admin/permission-requests', icon: SidebarIcons.audit, permission: 'audit.read' },
    ],
  },
];

function getNavGroupsForUser(user: { role: string; permissions?: string[] } | null): SidebarGroup[] {
  const result: SidebarGroup[] = [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];

  for (const groupDef of navStructure) {
    const visibleItems = groupDef.items
      .filter((item) => {
        if (!item.permission) return true;
        if (isSuperAdmin) return true;
        return perms.includes(item.permission);
      })
      .map(({ label, href, icon }) => ({ label, href, icon }));

    if (visibleItems.length === 0) continue;

    result.push({ group: groupDef.group, items: visibleItems });
  }

  return result;
}

export function DashboardLayout({ user, notificationsPromise }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const { isConnected } = useSocket();
  const { realtimeNotifications, realtimeCount } = useRealtimeNotifications();

  // Initialize dark mode and sidebar collapse from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('yannis_theme');
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }
    const savedCollapsed = localStorage.getItem('yannis_sidebar_collapsed');
    if (savedCollapsed === 'true') {
      setCollapsed(true);
    }
  }, []);

  // Request push notification subscription (once, silently)
  useEffect(() => {
    const vapidKey = typeof window !== 'undefined' ? (window as Record<string, unknown>).__ENV?.VAPID_PUBLIC_KEY : undefined;
    if (typeof vapidKey === 'string' && vapidKey) {
      subscribeToPush(vapidKey).catch(() => {
        // Push not supported or permission denied — silent fail
      });
    }
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('yannis_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('yannis_theme', 'light');
    }
  };

  const navGroups = getNavGroupsForUser(user);

  const handleToggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('yannis_sidebar_collapsed', String(next));
  };

  return (
    <ToastProvider>
      <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
        <Sidebar
          groups={navGroups}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onToggle={handleToggleCollapse}
          onMobileClose={() => setMobileOpen(false)}
        />
        <Header
          user={user}
          sidebarCollapsed={collapsed}
          darkMode={darkMode}
          notificationsPromise={notificationsPromise}
          realtimeNotifications={realtimeNotifications}
          realtimeCount={realtimeCount}
          socketConnected={isConnected}
          onToggleDarkMode={toggleDarkMode}
          onMobileMenuToggle={() => setMobileOpen(!mobileOpen)}
        />

        {/* Main content area */}
        <main
          className={`pt-[var(--header-height)] min-h-screen transition-all duration-300
            ${collapsed
              ? 'lg:pl-[var(--sidebar-collapsed-width)]'
              : 'lg:pl-[var(--sidebar-width)]'
            }
          `}
        >
          <div className="p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
