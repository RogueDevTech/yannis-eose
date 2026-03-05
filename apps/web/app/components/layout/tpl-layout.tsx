import { useState, useRef, useEffect } from 'react';
import { NavLink, Form } from '@remix-run/react';
const TPL_NAV = [
  { label: 'Dashboard', href: '/tpl' },
  { label: 'Orders', href: '/tpl/orders' },
  { label: 'Transfers', href: '/tpl/transfers' },
  { label: 'Returns', href: '/tpl/returns' },
  { label: 'Remit to warehouse', href: '/tpl/remit' },
  { label: 'Notifications', href: '/tpl/notifications' },
  { label: 'Settings', href: '/tpl/settings' },
];

interface TplLayoutProps {
  user: { name: string; role: string; email: string };
  notificationsPromise: Promise<{ notifications: Array<{ id: string; type: string; title: string; body: string | null; read: boolean; createdAt: string }>; unreadCount: number }>;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  children: React.ReactNode;
}

export function TplLayout({
  user,
  notificationsPromise,
  darkMode = false,
  onToggleDarkMode,
  children,
}: TplLayoutProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [resolvedDark, setResolvedDark] = useState(darkMode);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    notificationsPromise.then((data) => {
      setUnreadCount(data.unreadCount);
    }).catch(() => {});
  }, [notificationsPromise]);

  useEffect(() => {
    const stored = localStorage.getItem('yannis_theme');
    if (stored === 'dark' || (!stored && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setResolvedDark(true);
    } else {
      setResolvedDark(false);
    }
  }, []);

  const toggleDark = () => {
    const next = !resolvedDark;
    setResolvedDark(next);
    if (typeof document !== 'undefined') {
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('yannis_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('yannis_theme', 'light');
      }
    }
    onToggleDarkMode?.();
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);

  const isDark = resolvedDark;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1440px] bg-surface-50 dark:bg-surface-950">
      {/* Top bar: logo + nav + actions */}
      <header className="sticky top-0 z-40 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800">
        <div className="flex items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-6 min-w-0">
            <NavLink to="/tpl" className="flex-shrink-0 flex items-center gap-2">
              <img
                src={isDark ? '/assets/yannis-logo1.png' : '/assets/yannis-logo-white-bg.png'}
                alt="Yannis"
                className="h-8 w-auto object-contain"
              />
              <span className="hidden sm:inline text-sm font-medium text-surface-700 dark:text-surface-300">3PL</span>
            </NavLink>
            <nav className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
              {TPL_NAV.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                      isActive
                        ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                        : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-200'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <NavLink
              to="/tpl/notifications"
              className="relative p-2 rounded-lg text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800"
              title="Notifications"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[1rem] h-4 px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-danger-500 text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
            <button
              type="button"
              onClick={toggleDark}
              className="p-2 rounded-lg text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800"
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((o) => !o)}
                className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-300"
              >
                <span className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-sm font-semibold text-white">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <span className="hidden sm:block text-sm font-medium max-w-[120px] truncate">{user.name}</span>
                <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-1 w-48 py-1 bg-white dark:bg-surface-800 rounded-lg shadow-lg border border-surface-200 dark:border-surface-700">
                  <div className="px-3 py-2 border-b border-surface-100 dark:border-surface-700">
                    <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{user.name}</p>
                    <p className="text-xs text-surface-500 truncate">{user.email}</p>
                  </div>
                  <Form method="post" action="/auth/logout">
                    <button
                      type="submit"
                      className="w-full text-left px-3 py-2 text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700"
                    >
                      Sign out
                    </button>
                  </Form>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="p-4 lg:p-6">
        {children}
      </main>
    </div>
  );
}
