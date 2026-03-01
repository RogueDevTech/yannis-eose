import { useState, useEffect } from 'react';
import { Outlet } from '@remix-run/react';
import { Sidebar, SidebarIcons } from './sidebar';
import { Header } from './header';

interface DashboardLayoutProps {
  user: {
    name: string;
    role: string;
    email: string;
  } | null;
}

const navItems = [
  { label: 'Dashboard', href: '/admin', icon: SidebarIcons.dashboard },
  { label: 'Orders', href: '/admin/orders', icon: SidebarIcons.orders },
  { label: 'Inventory', href: '/admin/inventory', icon: SidebarIcons.inventory },
  { label: 'Logistics', href: '/admin/logistics', icon: SidebarIcons.logistics },
  { label: 'Marketing', href: '/admin/marketing', icon: SidebarIcons.marketing },
  { label: 'Finance', href: '/admin/finance', icon: SidebarIcons.finance },
  { label: 'HR & Payroll', href: '/admin/hr', icon: SidebarIcons.hr },
  { label: 'Users', href: '/admin/users', icon: SidebarIcons.users },
  { label: 'Settings', href: '/admin/settings', icon: SidebarIcons.settings },
];

export function DashboardLayout({ user }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Initialize dark mode from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('yannis_theme');
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
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

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      <Sidebar
        items={navItems}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggle={() => setCollapsed(!collapsed)}
        onMobileClose={() => setMobileOpen(false)}
      />
      <Header
        user={user}
        sidebarCollapsed={collapsed}
        darkMode={darkMode}
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
  );
}
