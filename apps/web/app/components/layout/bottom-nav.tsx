import { useState, useEffect, useRef } from 'react';
import { NavLink } from '@remix-run/react';

export interface BottomNavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

export interface BottomNavGroup {
  group: string | null;
  items: BottomNavItem[];
}

interface BottomNavProps {
  /** First 4 items shown on the bar. */
  barItems: BottomNavItem[];
  /** All items shown in the "More" modal (can be more than 4). */
  allItems: BottomNavItem[];
  /** Grouped items for the modal — when provided, renders group headers to disambiguate duplicate labels. */
  allGroups?: BottomNavGroup[];
  currentPathname: string;
  darkMode?: boolean;
}

function isActive(pathname: string, href: string): boolean {
  if (!pathname) return false;
  if (href === '/admin' || href === '/tpl') {
    return pathname === href || pathname === `${href}/`;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

const MoreIcon = (
  <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
  </svg>
);

/**
 * Fixed bottom navigation bar for mobile (hidden on md+).
 * Shows up to 4 items + "More" that opens a modal with all options.
 * Labels use two lines so full text is visible.
 */
export function BottomNav({ barItems, allItems, allGroups, currentPathname }: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const showMore = allItems.length > 4;
  const displayBarItems = showMore ? barItems.slice(0, 4) : barItems;

  useEffect(() => {
    if (!moreOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [moreOpen]);

  if (allItems.length === 0) return null;

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden items-stretch justify-around bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-800 pb-[env(safe-area-inset-bottom)]"
        style={{ minHeight: 'var(--bottom-nav-height)' }}
        aria-label="Main navigation"
      >
        {displayBarItems.map((item) => {
          const active = isActive(currentPathname, item.href);
          return (
            <NavLink
              key={item.href}
              to={item.href}
              end={item.href === '/admin' || item.href === '/tpl'}
              prefetch="intent"
              className={({ isPending }) =>
                `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 min-w-0 px-0.5 transition-colors ${
                  active || isPending
                    ? 'text-brand-600 dark:text-brand-400'
                    : 'text-surface-500 dark:text-surface-400'
                }`
              }
            >
              <span className="w-6 h-6 flex items-center justify-center flex-shrink-0 [&>svg]:w-5 [&>svg]:h-5">
                {item.icon}
              </span>
              <span className="text-[10px] font-medium truncate max-w-full text-center">
                {item.label}
              </span>
            </NavLink>
          );
        })}
        {showMore && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`flex shrink-0 w-12 h-10 items-center justify-center rounded-xl transition-colors mx-0.5 text-white shadow-md ${
              moreOpen
                ? 'bg-[#1565C0] dark:bg-[#4d8bf1] ring-2 ring-white/30 dark:ring-white/20'
                : 'bg-[#1565C0] dark:bg-[#4d8bf1] hover:bg-[#0d47a1] dark:hover:bg-[#74a4f5] active:bg-[#0a3a85] dark:active:bg-[#1565C0]'
            }`}
            aria-label="More options"
          >
            <span className="w-6 h-6 flex items-center justify-center [&>svg]:w-6 [&>svg]:h-6 text-white">
              {MoreIcon}
            </span>
          </button>
        )}
      </nav>

      {/* More modal: slide-up panel at 70% height with scroll for bottom nav */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="All navigation options"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMoreOpen(false)}
            aria-hidden
          />
          <div
            ref={modalRef}
            className="absolute bottom-0 left-0 right-0 h-[70vh] flex flex-col rounded-t-2xl bg-white dark:bg-surface-900 border-t border-surface-200 dark:border-surface-800 shadow-lg pb-[env(safe-area-inset-bottom)] animate-slide-up-from-bottom"
          >
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 rounded-t-2xl">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-white">All options</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ul className="flex-1 min-h-0 overflow-y-auto py-2 overscroll-contain">
              {allGroups && allGroups.length > 0
                ? allGroups.map((group, gi) => (
                    <li key={group.group ?? `_ungrouped_${gi}`}>
                      {group.group && (
                        <div className="px-4 pt-4 pb-1 first:pt-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-surface-400 dark:text-surface-500">
                            {group.group}
                          </span>
                        </div>
                      )}
                      <ul>
                        {group.items.map((item) => {
                          const active = isActive(currentPathname, item.href);
                          return (
                            <li key={item.href}>
                              <NavLink
                                to={item.href}
                                end={item.href === '/admin' || item.href === '/tpl'}
                                prefetch="intent"
                                onClick={() => setMoreOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 text-left text-sm ${
                                  active
                                    ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-medium'
                                    : 'text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'
                                }`}
                              >
                                <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 [&>svg]:w-5 [&>svg]:h-5">
                                  {item.icon}
                                </span>
                                <span className="flex-1 min-w-0">{item.label}</span>
                              </NavLink>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))
                : allItems.map((item) => {
                    const active = isActive(currentPathname, item.href);
                    return (
                      <li key={item.href}>
                        <NavLink
                          to={item.href}
                          end={item.href === '/admin' || item.href === '/tpl'}
                          prefetch="intent"
                          onClick={() => setMoreOpen(false)}
                          className={`flex items-center gap-3 px-4 py-3 text-left text-sm ${
                            active
                              ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-medium'
                              : 'text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800'
                          }`}
                        >
                          <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 [&>svg]:w-5 [&>svg]:h-5">
                            {item.icon}
                          </span>
                          <span className="flex-1 min-w-0">{item.label}</span>
                        </NavLink>
                      </li>
                    );
                  })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
