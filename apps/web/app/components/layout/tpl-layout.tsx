import { useState, useRef, useEffect } from 'react';
import { NavLink, Form, useLocation, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { RouteLoader } from '~/components/ui/route-loader';
import { BottomNav, type BottomNavItem } from './bottom-nav';
import { SidebarIcons } from './sidebar';
import { usePwaInstall } from '~/hooks/usePwaInstall';

const TPL_NAV = [
  { label: 'Dashboard', href: '/tpl', icon: SidebarIcons.dashboard },
  { label: 'Orders', href: '/tpl/orders', icon: SidebarIcons.orders },
  { label: 'Inventory', href: '/tpl/inventory', icon: SidebarIcons.inventory },
  { label: 'Remit', href: '/tpl/remit', icon: SidebarIcons.logistics },
  { label: 'Notifications', href: '/tpl/notifications', icon: SidebarIcons.notifications },
  { label: 'Settings', href: '/tpl/settings', icon: SidebarIcons.settings },
];

const TPL_BAR_ITEMS: BottomNavItem[] = TPL_NAV.slice(0, 4).map(({ label, href, icon }) => ({ label, href, icon }));
const TPL_ALL_ITEMS: BottomNavItem[] = TPL_NAV.map(({ label, href, icon }) => ({ label, href, icon }));

function isActiveFromPath(path: string, href: string): boolean {
  if (!path) return false;
  if (href === '/tpl') return path === '/tpl' || path === '/tpl/';
  return path === href || path.startsWith(href + '/');
}

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
  const location = useLocation();
  const navigation = useNavigation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [resolvedDark, setResolvedDark] = useState(darkMode);
  const menuRef = useRef<HTMLDivElement>(null);
  const { canInstall, install } = usePwaInstall();

  const isNavigatingWithinTpl =
    navigation.state !== 'idle' &&
    navigation.location != null &&
    navigation.location.pathname.startsWith('/tpl') &&
    navigation.location.pathname !== location.pathname;
  const effectivePath = isNavigatingWithinTpl && navigation.location ? navigation.location.pathname : location.pathname;
  const isRouteLoading = isNavigatingWithinTpl;

  useEffect(() => {
    notificationsPromise.then((data) => {
      setUnreadCount(data.unreadCount);
    }).catch(() => {});
  }, [notificationsPromise]);

  useEffect(() => {
    const stored = localStorage.getItem('yannis_theme');
    if (stored === 'dark') {
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

  const closeMobileNav = () => setMobileNavOpen(false);

  const isDark = resolvedDark;

  return (
    <div className="min-h-screen w-full bg-surface-50 dark:bg-surface-950">
      {/* Constrained content: max 1200px, centered */}
      <div className="mx-auto w-full max-w-tpl min-h-screen flex flex-col">
        {/* Header + nav: fixed on mobile (same as admin), in-flow on md+ */}
        <div className="sticky top-0 z-40 shrink-0 pt-[var(--header-height)] md:pt-0">
        <header
          className="fixed md:relative top-0 left-0 right-0 z-30 h-[var(--header-height)] md:h-auto md:py-2 bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between px-4 lg:px-6 transition-colors"
        >
          {/* Left: mobile hamburger + logo (same order and style as admin) */}
          <div className="flex items-center gap-3 flex-1 min-w-0 max-w-lg">
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="md:hidden p-1.5 rounded-lg text-surface-800 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 transition-colors"
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileNavOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>
            <NavLink
              to="/tpl"
              className="flex-shrink-0 flex items-center gap-2"
              aria-label="3PL home"
            >
              <img
                src={isDark ? '/assets/yannis-logo1.png' : '/assets/yannis-logo-white-bg.png'}
                alt="Yannis"
                className="h-[1.575rem] w-auto max-w-[108px] md:h-8 md:max-w-none object-contain"
              />
              <span className="hidden sm:inline text-sm font-medium text-surface-700 dark:text-surface-300">3PL</span>
            </NavLink>
          </div>

          {/* Right: install app + notifications, dark mode, user (same style as admin) */}
          <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
            {canInstall && (
              <button
                type="button"
                onClick={install}
                className="p-1.5 rounded-lg text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
                title="Install App"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
            )}
            <NavLink
              to="/tpl/notifications"
              prefetch="intent"
              className={() => {
                const active = isActiveFromPath(effectivePath, '/tpl/notifications');
                return `relative p-1.5 rounded-lg transition-colors ${
                  active
                    ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                    : 'text-surface-800 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800'
                }`;
              }}
              title="Notifications"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold rounded-full bg-danger-500 text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </NavLink>
            <button
              type="button"
              onClick={toggleDark}
              className="p-1.5 rounded-lg text-surface-800 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800 transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
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
                className="flex items-center gap-2 pl-2 lg:pl-3 border-l border-surface-200 dark:border-surface-700 hover:opacity-80 transition-opacity"
              >
                <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
                  <span className="text-xs font-semibold text-white">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="hidden md:block min-w-0 text-left">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate leading-tight">
                    {user.name}
                  </p>
                </div>
                <svg
                  className="w-4 h-4 text-surface-700 dark:text-surface-200 hidden md:block transition-transform duration-200"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  style={{ transform: userMenuOpen ? 'rotate(180deg)' : undefined }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-lg bg-white dark:bg-surface-800 shadow-lg border border-surface-200 dark:border-surface-700 py-1 animate-fade-in z-50">
                  <div className="md:hidden px-4 py-3 border-b border-surface-100 dark:border-surface-700">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{user.name}</p>
                    <p className="text-xs text-surface-500 dark:text-surface-200">{user.email}</p>
                  </div>
                  <div className="hidden md:block px-4 py-2 border-b border-surface-100 dark:border-surface-700">
                    <p className="text-xs text-surface-800 dark:text-surface-200 truncate">{user.email}</p>
                  </div>
                  <Form method="post" action="/auth/logout">
                    <Button
                      type="submit"
                      variant="ghost"
                      className="flex items-center gap-2 w-full justify-start text-danger-600 dark:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-700/20 transition-colors h-auto py-2 px-4 font-normal"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                      </svg>
                      Sign out
                    </Button>
                  </Form>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Nav row: below header, always visible on md+, toggled by menu button on mobile */}
        <nav
          className={`flex items-center gap-1 overflow-x-auto scrollbar-hide bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 px-4 py-2 min-h-[2.75rem] ${
            mobileNavOpen ? 'flex' : 'hidden md:flex'
          }`}
          aria-label="Main navigation"
        >
          {TPL_NAV.map((item) => {
            const active = isActiveFromPath(effectivePath, item.href);
            return (
              <NavLink
                key={item.href}
                to={item.href}
                end={item.href === '/tpl'}
                prefetch="intent"
                onClick={closeMobileNav}
                className={() =>
                  `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                    active
                      ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                      : 'text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-200'
                  }`
                }
              >
                {item.label}
              </NavLink>
            );
          })}
          {canInstall && (
            <button
              type="button"
              onClick={install}
              className="px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 flex items-center gap-1.5 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 hover:text-surface-900 dark:hover:text-surface-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Install
            </button>
          )}
        </nav>
        </div>

        <main className="flex-1 p-4 lg:p-6 pb-[var(--bottom-nav-height)] md:pb-6">
          <div
            className={`relative transition-all duration-300 ${isRouteLoading ? 'min-h-[60vh]' : ''}`}
            aria-busy={isRouteLoading}
            aria-live="polite"
          >
            {isRouteLoading && (
              <div className="absolute inset-0 z-20 bg-surface-50 dark:bg-surface-950 p-4 lg:p-6">
                <RouteLoader />
              </div>
            )}
            <div className={isRouteLoading ? 'absolute inset-0 opacity-0 pointer-events-none' : ''}>
              {children}
            </div>
          </div>
        </main>
        <BottomNav barItems={TPL_BAR_ITEMS} allItems={TPL_ALL_ITEMS} currentPathname={effectivePath} pwaInstall={canInstall ? { canInstall, install } : undefined} />
      </div>
    </div>
  );
}
