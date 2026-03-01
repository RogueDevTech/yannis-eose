interface HeaderProps {
  user: {
    name: string;
    role: string;
    email: string;
  } | null;
  sidebarCollapsed: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onMobileMenuToggle: () => void;
}

export function Header({ user, sidebarCollapsed, darkMode, onToggleDarkMode, onMobileMenuToggle }: HeaderProps) {
  return (
    <header
      className={`fixed top-0 right-0 z-30 h-[var(--header-height)] bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-800 flex items-center justify-between px-4 lg:px-6 transition-all duration-300 left-0 ${
        sidebarCollapsed
          ? 'lg:left-[var(--sidebar-collapsed-width)]'
          : 'lg:left-[var(--sidebar-width)]'
      }`}
    >
      {/* Left: mobile menu + search */}
      <div className="flex items-center gap-3 flex-1 max-w-lg">
        {/* Mobile hamburger */}
        <button
          onClick={onMobileMenuToggle}
          className="lg:hidden p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        {/* Search */}
        <div className="relative w-full hidden sm:block">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search orders, products, users..."
            className="input pl-10 py-1.5 text-sm bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700"
          />
        </div>
      </div>

      {/* Right side: dark mode + notifications + user */}
      <div className="flex items-center gap-2 lg:gap-3">
        {/* Dark mode toggle */}
        <button
          onClick={onToggleDarkMode}
          className="p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
          )}
        </button>

        {/* Notifications bell */}
        <button className="relative p-1.5 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
            />
          </svg>
          <span className="absolute top-1 right-1 w-2 h-2 bg-danger-500 rounded-full" />
        </button>

        {/* User menu */}
        {user && (
          <div className="flex items-center gap-2 pl-2 lg:pl-3 border-l border-surface-200 dark:border-surface-700">
            <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center">
              <span className="text-xs font-semibold text-white">
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="hidden md:block min-w-0">
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate leading-tight">
                {user.name}
              </p>
              <p className="text-2xs text-surface-500 dark:text-surface-400 truncate">
                {formatRole(user.role)}
              </p>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function formatRole(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}
