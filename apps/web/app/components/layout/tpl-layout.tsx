import { useState, useRef, useEffect } from 'react';
import { NavLink, Form, useLocation, useNavigation } from '@remix-run/react';
import { useResolveFilterHref } from '~/hooks/useFilterPreferences';
import { Button } from '~/components/ui/button';
import { NavProgressBar } from '~/components/ui/nav-progress-bar';
import { BottomNav, type BottomNavItem } from './bottom-nav';
import { SidebarIcons } from './sidebar';
import { useAppTheme } from '~/hooks/useAppTheme';
import { useSocket, useForceLogoutOnRevoke } from '~/hooks/useSocket';
import { APP_THEMES, getAppLogoSrc } from '~/lib/theme';

const TPL_NAV = [
  { label: 'Dashboard', href: '/tpl', icon: SidebarIcons.dashboard },
  { label: 'Orders', href: '/tpl/orders', icon: SidebarIcons.orders },
  { label: 'Inventory', href: '/tpl/inventory', icon: SidebarIcons.inventory },
  { label: 'Remit', href: '/tpl/remit', icon: SidebarIcons.logistics },
  { label: 'Notifications', href: '/tpl/notifications', icon: SidebarIcons.notifications },
  { label: 'Settings', href: '/tpl/settings', icon: SidebarIcons.settings },
];

const TPL_BAR_ITEMS: BottomNavItem[] = TPL_NAV.slice(0, 4).map(({ label, href, icon }) => ({
  label,
  href,
  icon,
}));
const TPL_ALL_ITEMS: BottomNavItem[] = TPL_NAV.map(({ label, href, icon }) => ({
  label,
  href,
  icon,
}));

function isActiveFromPath(path: string, href: string): boolean {
  if (!path) return false;
  if (href === '/tpl') return path === '/tpl' || path === '/tpl/';
  return path === href || path.startsWith(href + '/');
}

interface TplLayoutProps {
  user: { name: string; role: string; email: string };
  notificationsPromise: Promise<{
    notifications: Array<{
      id: string;
      type: string;
      title: string;
      body: string | null;
      read: boolean;
      createdAt: string;
    }>;
    unreadCount: number;
  }>;
  children: React.ReactNode;
}

export function TplLayout({
  user,
  notificationsPromise,
  children,
}: TplLayoutProps) {
  const location = useLocation();
  const navigation = useNavigation();
  const resolveHref = useResolveFilterHref();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { themeId, setTheme, isDarkTheme } = useAppTheme();
  const menuRef = useRef<HTMLDivElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  // Initialise the socket + listen for forced-logout events from the server.
  // Same flow as DashboardLayout — when an admin deactivates this 3PL user,
  // the browser hard-redirects to /auth instead of letting them keep
  // clicking around in already-rendered UI.
  useSocket();
  useForceLogoutOnRevoke();

  const isNavigatingWithinTpl =
    navigation.state !== 'idle' &&
    navigation.location != null &&
    navigation.location.pathname.startsWith('/tpl') &&
    navigation.location.pathname !== location.pathname;
  const effectivePath =
    isNavigatingWithinTpl && navigation.location ? navigation.location.pathname : location.pathname;
  const isRouteLoading = isNavigatingWithinTpl;

  useEffect(() => {
    notificationsPromise
      .then((data) => {
        setUnreadCount(data.unreadCount);
      })
      .catch(() => {});
  }, [notificationsPromise]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) {
        setUserMenuOpen(false);
      }
      if (themeMenuRef.current && !themeMenuRef.current.contains(t)) {
        setThemeMenuOpen(false);
      }
    }
    if (userMenuOpen || themeMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen, themeMenuOpen]);

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <div className="min-h-screen w-full bg-app-canvas text-app-fg">
      <NavProgressBar />
      {/* Constrained content: max 1200px, centered */}
      <div className="mx-auto w-full max-w-tpl min-h-screen flex flex-col">
        {/* Header + nav: fixed on mobile (same as admin), in-flow on md+ */}
        <div className="sticky top-0 z-40 shrink-0 pt-[var(--header-height)] md:pt-0">
          <header className="fixed md:relative top-0 left-0 right-0 z-30 h-[var(--header-height)] md:h-auto md:py-2 bg-app-elevated border-b border-app-border flex items-center justify-between px-4 lg:px-6 transition-colors">
            {/* Left: mobile hamburger + logo (same order and style as admin) */}
            <div className="flex items-center gap-3 flex-1 min-w-0 max-w-lg">
              <button
                type="button"
                onClick={() => setMobileNavOpen((o) => !o)}
                className="md:hidden p-1.5 rounded-lg text-app-fg hover:bg-app-hover transition-colors"
                aria-expanded={mobileNavOpen}
                aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              >
                {mobileNavOpen ? (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                    />
                  </svg>
                )}
              </button>
              <NavLink
                to="/tpl"
                className="flex-shrink-0 flex items-center gap-2"
                aria-label="3PL home"
              >
                <img
                  src={getAppLogoSrc(false)}
                  alt="Yannis"
                  className="h-[1.575rem] w-auto max-w-[108px] md:h-8 md:max-w-none object-contain dark:hidden"
                />
                <img
                  src={getAppLogoSrc(true)}
                  alt="Yannis"
                  className="h-[1.575rem] w-auto max-w-[108px] md:h-8 md:max-w-none object-contain hidden dark:block"
                />
                <span className="hidden sm:inline text-sm font-medium text-app-fg-muted">
                  3PL
                </span>
              </NavLink>
            </div>

            {/* Right: install app + notifications, dark mode, user (same style as admin) */}
            <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
              <NavLink
                to="/tpl/notifications"
                prefetch="render"
                className={() => {
                  const active = isActiveFromPath(effectivePath, '/tpl/notifications');
                  return `relative p-1.5 rounded-lg transition-colors ${
                    active
                      ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                      : 'text-app-fg-muted hover:bg-app-hover'
                  }`;
                }}
                title="Notifications"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                  />
                </svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-micro font-bold rounded-full bg-danger-500 text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </NavLink>
              <div className="relative" ref={themeMenuRef}>
                <button
                  type="button"
                  onClick={() => setThemeMenuOpen((o) => !o)}
                  className="p-1.5 rounded-lg text-app-fg hover:bg-app-hover transition-colors"
                  title="Theme"
                  aria-expanded={themeMenuOpen}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                    />
                  </svg>
                </button>
                {themeMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-lg bg-app-elevated border border-app-border shadow-lg py-1 z-50 animate-fade-in">
                    <p className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-app-fg-muted">
                      Theme
                    </p>
                    {APP_THEMES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setTheme(t.id);
                          setThemeMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-app-fg hover:bg-app-hover transition-colors"
                      >
                        {themeId === t.id ? (
                          <svg className="w-4 h-4 shrink-0 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="w-4 h-4 shrink-0" aria-hidden />
                        )}
                        <span className="flex-1 text-left">{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((o) => !o)}
                  className="flex items-center gap-2 pl-2 lg:pl-3 border-l border-app-border hover:opacity-80 transition-opacity"
                >
                  <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
                    <span className="text-xs font-semibold text-white">
                      {user.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="hidden md:block min-w-0 text-left">
                    <p className="text-sm font-medium text-app-fg truncate leading-tight">
                      {user.name}
                    </p>
                  </div>
                  <svg
                    className="w-4 h-4 text-app-fg-muted hidden md:block transition-transform duration-200"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    style={{ transform: userMenuOpen ? 'rotate(180deg)' : undefined }}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                    />
                  </svg>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-lg bg-app-elevated shadow-lg border border-app-border py-1 animate-fade-in z-50">
                    <div className="md:hidden px-4 py-3 border-b border-app-border">
                      <p className="text-sm font-medium text-app-fg">
                        {user.name}
                      </p>
                      <p className="text-xs text-app-fg-muted">{user.email}</p>
                    </div>
                    <div className="hidden md:block px-4 py-2 border-b border-app-border">
                      <p className="text-xs text-app-fg-muted truncate">
                        {user.email}
                      </p>
                    </div>
                    <Form method="post" action="/auth/logout">
                      <Button
                        type="submit"
                        variant="ghost"
                        className="flex items-center gap-2 w-full justify-start text-danger-600 dark:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-700/20 transition-colors h-auto py-2 px-4 font-normal"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                          />
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
            className={`flex items-center gap-1 overflow-x-auto scrollbar-hide bg-app-elevated border-b border-app-border px-4 py-2 min-h-[2.75rem] ${
              mobileNavOpen ? 'flex' : 'hidden md:flex'
            }`}
            aria-label="Main navigation"
          >
            {TPL_NAV.map((item) => {
              const active = isActiveFromPath(effectivePath, item.href);
              return (
                <NavLink
                  key={item.href}
                  to={resolveHref(item.href)}
                  end={item.href === '/tpl'}
                  prefetch="render"
                  onClick={closeMobileNav}
                  className={() =>
                    `px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                      active
                        ? 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                        : 'text-app-fg-muted hover:bg-app-hover hover:text-app-fg'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <main className="flex-1 p-4 lg:p-6 pb-[var(--bottom-nav-height)] md:pb-6">
          <div
            className="relative transition-all duration-300"
            aria-busy={isRouteLoading}
            aria-live="polite"
          >
            {children}
          </div>
        </main>
        <BottomNav
          barItems={TPL_BAR_ITEMS}
          allItems={TPL_ALL_ITEMS}
          currentPathname={effectivePath}
        />
      </div>
    </div>
  );
}
