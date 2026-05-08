import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from '@remix-run/react';

export interface SidebarGroup {
  group: string | null;
  items: { label: string; href: string; icon: React.ReactNode }[];
}

interface SidebarProps {
  groups: SidebarGroup[];
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
  onMobileClose: () => void;
  /** When set, used to highlight the active nav item (e.g. during route loading so the target route is shown as selected) */
  activePathname?: string;
  /** Unread notification count to show on the Notifications nav item */
  notificationCount?: number;
  /** Dark named theme only — picks logo asset tuned for dark backgrounds. */
  isDarkTheme?: boolean;
}

const STORAGE_KEY = 'yannis_sidebar_groups_v2';

function loadGroupState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    // corrupted — ignore
  }
  return {};
}

function saveGroupState(state: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function Sidebar({ groups, collapsed, mobileOpen, onToggle, onMobileClose, activePathname, notificationCount, isDarkTheme = false }: SidebarProps) {
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setGroupCollapsed(loadGroupState());
  }, []);

  /**
   * Longest-prefix-match across every registered nav href, computed once.
   *
   * Why: NavLink's default + a `path.startsWith(item.href + '/')` rule would
   * mark BOTH `/admin/settings` and `/admin/settings/role-templates` active
   * when the user is on the latter (Settings is a prefix of the URL). That's
   * a UX bug — only the most specific item should light up.
   *
   * We resolve the active href here at the parent so every SidebarNavLink can
   * just compare its own href to one shared answer. Falls back to undefined
   * when nothing matches; SidebarNavLink then defers to NavLink's built-in
   * `isActive` (used for the resource routes / non-nav paths).
   */
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const resolvedActiveHref = (() => {
    if (!activePathname) return undefined;
    let best: string | undefined;
    for (const href of allHrefs) {
      // Special-case `/admin` so it doesn't swallow every admin sub-route.
      const matches =
        href === '/admin'
          ? activePathname === '/admin' || activePathname === '/admin/'
          : activePathname === href || activePathname.startsWith(href + '/');
      if (matches && (!best || href.length > best.length)) best = href;
    }
    return best;
  })();

  // When a role has ≤2 named groups (e.g. HR Manager → "HR"; Media Buyer → "MARKETING";
  // CS Agent → "SALES & CS"), auto-open the groups so the handful of nav items are
  // immediately visible. Users with many groups (SuperAdmin/Admin) keep the collapsed
  // default to avoid a wall of nav. An explicit user toggle still wins — persisted.
  const namedGroupCount = groups.filter((g) => g.group !== null && g.items.length > 0).length;
  const autoOpenAll = namedGroupCount <= 2;

  const toggleGroup = useCallback((groupName: string) => {
    setGroupCollapsed((prev) => {
      // true = expanded, default is collapsed (undefined/false)
      const next = { ...prev, [groupName]: !prev[groupName] };
      saveGroupState(next);
      return next;
    });
  }, []);

  const isExpanded = collapsed && !mobileOpen;

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onMobileClose} />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-screen bg-app-elevated text-app-fg transition-all duration-300 flex flex-col
          ${collapsed ? 'lg:w-[var(--sidebar-collapsed-width)]' : 'lg:w-[var(--sidebar-width)]'}
          ${mobileOpen ? 'w-[var(--sidebar-width)] translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo strip + asset — CSS vars per data-app-theme; PNG swap only for Dark theme */}
        <div
          className={`flex items-center h-[var(--header-height)] flex-shrink-0 rounded-b-lg border-b border-app-logo-strip-border bg-app-logo-strip-bg
            ${isExpanded ? 'justify-center px-2' : 'pl-6 pr-4'}
          `}
        >
          <img
            src={isDarkTheme ? '/assets/yannis-logo1.png' : '/assets/yannis-logo-white-bg.png'}
            alt="Yannis"
            className="h-8 w-auto max-w-full object-contain flex-shrink-0"
          />
        </div>


        {/* Navigation — overflow-x-visible when collapsed so icon tooltips can show to the right */}
        <nav className={`flex-1 overflow-y-auto py-3 px-3 ${isExpanded ? 'overflow-x-visible' : ''}`}>
          {groups.map((group, gi) => {
            // Skip groups with no items — no point showing an empty accordion
            if (group.items.length === 0) return null;

            // Ungrouped items — render flat
            if (group.group === null) {
              return (
                <div key={`ungrouped-${gi}`} className="space-y-0.5">
                  {group.items.map((item) => (
                    <SidebarNavLink
                      key={item.href}
                      item={item}
                      isExpanded={isExpanded}
                      onMobileClose={onMobileClose}
                      activePathname={activePathname}
                      resolvedActiveHref={resolvedActiveHref}
                      badge={item.href === '/admin/notifications' && (notificationCount ?? 0) > 0 ? notificationCount : undefined}
                    />
                  ))}
                </div>
              );
            }

            // Named group — collapsible section.
            // Default: closed; but if the role has ≤2 groups, auto-open when no explicit preference is stored.
            // Explicit user toggles are persisted in localStorage and always win over the auto-open heuristic.
            const stored = groupCollapsed[group.group];
            const isOpen = stored !== undefined ? stored : autoOpenAll;

            // In icon-only mode, skip headers and render items flat
            if (isExpanded) {
              return (
                <div key={group.group} className="space-y-0.5">
                  {group.items.map((item) => (
                    <SidebarNavLink
                      key={item.href}
                      item={item}
                      isExpanded={isExpanded}
                      onMobileClose={onMobileClose}
                      activePathname={activePathname}
                      resolvedActiveHref={resolvedActiveHref}
                      badge={item.href === '/admin/notifications' && (notificationCount ?? 0) > 0 ? notificationCount : undefined}
                    />
                  ))}
                </div>
              );
            }

            return (
              <div key={group.group} className="mt-3">
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.group as string)}
                  className="flex items-center justify-between w-full px-3 py-1 rounded-md hover:bg-app-hover transition-colors duration-150 group/header"
                >
                  <span className="text-[11px] uppercase tracking-wider text-app-fg-muted font-semibold select-none group-hover/header:text-app-fg transition-colors duration-150">
                    {group.group}
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 text-app-fg-muted transition-all duration-150 group-hover/header:text-app-fg ${
                      isOpen ? 'rotate-0' : '-rotate-90'
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Group children — grid row animation for smooth open/close */}
                <div
                  className="grid transition-[grid-template-rows] duration-200 ease-in-out"
                  style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <div className={`space-y-0.5 ${isOpen ? 'pt-0.5' : ''}`}>
                      {group.items.map((item) => (
                        <SidebarNavLink
                          key={item.href}
                          item={item}
                          isExpanded={isExpanded}
                          onMobileClose={onMobileClose}
                          activePathname={activePathname}
                          resolvedActiveHref={resolvedActiveHref}
                          badge={item.href === '/admin/notifications' && (notificationCount ?? 0) > 0 ? notificationCount : undefined}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

        </nav>

        {/* Collapse toggle — desktop only; show tooltip when collapsed */}
        <div className={`hidden lg:block border-t border-app-border/50 p-3 ${collapsed ? 'relative group' : ''}`}>
          <button
            onClick={onToggle}
            title={collapsed ? 'Expand sidebar' : undefined}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-app-fg-muted hover:bg-app-hover hover:text-app-fg transition-colors duration-150"
          >
            <svg
              className={`w-5 h-5 transition-transform duration-300 ${collapsed ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
            {!collapsed && <span>Collapse</span>}
          </button>
          {collapsed && (
            <div
              className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap bg-app-elevated text-app-fg shadow-lg border border-app-border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 delay-200 pointer-events-none z-[100]"
              role="tooltip"
            >
              Expand sidebar
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/* ── Individual NavLink item ──────────────────────────────────── */

function SidebarNavLink({
  item,
  isExpanded,
  onMobileClose,
  activePathname,
  resolvedActiveHref,
  badge,
}: {
  item: { label: string; href: string; icon: React.ReactNode };
  isExpanded: boolean;
  onMobileClose: () => void;
  activePathname?: string;
  /**
   * Pre-computed by the parent Sidebar via longest-prefix-match across all nav
   * hrefs. When defined, only the item whose href equals this value should be
   * marked active — guarantees parent + child don't both light up on deep URLs
   * like `/admin/settings/role-templates`.
   */
  resolvedActiveHref?: string;
  badge?: number;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });

  const isActiveFromPath = (path: string): boolean => {
    if (!path) return false;
    // Parent supplied the longest-prefix-match? Trust it — it's the only
    // way to disambiguate nested sibling nav entries.
    if (resolvedActiveHref !== undefined) return resolvedActiveHref === item.href;
    if (item.href === '/admin') return path === '/admin' || path === '/admin/';
    return path === item.href || path.startsWith(item.href + '/');
  };

  const updateTooltipPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setTooltipPos({
      left: rect.right + 8,
      top: rect.top + rect.height / 2,
    });
  }, []);

  useLayoutEffect(() => {
    if (tooltipVisible && isExpanded) updateTooltipPosition();
  }, [tooltipVisible, isExpanded, updateTooltipPosition]);

  useEffect(() => {
    if (!tooltipVisible || !isExpanded) return;
    window.addEventListener('scroll', updateTooltipPosition, true);
    window.addEventListener('resize', updateTooltipPosition);
    return () => {
      window.removeEventListener('scroll', updateTooltipPosition, true);
      window.removeEventListener('resize', updateTooltipPosition);
    };
  }, [tooltipVisible, isExpanded, updateTooltipPosition]);

  return (
    <div
      ref={isExpanded ? anchorRef : undefined}
      className={isExpanded ? 'relative' : undefined}
      onMouseEnter={() => isExpanded && setTooltipVisible(true)}
      onMouseLeave={() => isExpanded && setTooltipVisible(false)}
    >
      <NavLink
      to={item.href}
      end={item.href === '/admin'}
      // CEO directive 2026-05-08: every sidebar destination prefetches on render
      // so clicking from anywhere feels instant — by the time the user clicks,
      // the loader's data is already cached. Trade-off is a small burst of
      // background HTTP calls on layout mount (acceptable for an admin app on
      // broadband). `intent`-only previously meant clicks without prior hover
      // paid the full loader round-trip before the skeleton paints.
      prefetch="render"
      onClick={onMobileClose}
      className={({ isActive }) => {
        const active = activePathname != null ? isActiveFromPath(activePathname) : isActive;
        return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
          active
            ? 'bg-brand-500/15 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300'
            : 'text-app-fg-muted hover:bg-app-hover hover:text-app-fg'
        } ${isExpanded ? 'justify-center relative' : ''}`;
      }}
      >
      <span className="w-5 h-5 flex-shrink-0">{item.icon}</span>
      {!isExpanded && <span className="truncate">{item.label}</span>}
      {!isExpanded && badge != null && badge > 0 && (
        <span className="ml-auto min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-bold bg-danger-500 text-white rounded-full flex-shrink-0">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {isExpanded && badge != null && badge > 0 && (
        <span
          className="absolute top-1/2 -translate-y-1/2 -right-1 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold bg-danger-500 text-white rounded-full"
          title={`${badge} unread`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      </NavLink>
      {isExpanded &&
        tooltipVisible &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[9999] px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap bg-app-elevated text-app-fg shadow-lg border border-app-border pointer-events-none"
            style={{
              left: tooltipPos.left,
              top: tooltipPos.top,
              transform: 'translateY(-50%)',
            }}
            role="tooltip"
          >
            {item.label}
          </div>,
          document.body
        )}
    </div>
  );
}

/**
 * Sidebar icons — simple SVG icons for each nav section.
 */
export const SidebarIcons = {
  dashboard: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
      />
    </svg>
  ),
  ceo: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6.75"
      />
    </svg>
  ),
  orders: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
      />
    </svg>
  ),
  users: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
  ),
  products: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"
      />
    </svg>
  ),
  inventory: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
      />
    </svg>
  ),
  logistics: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
      />
    </svg>
  ),
  marketing: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46"
      />
    </svg>
  ),
  finance: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z"
      />
    </svg>
  ),
  hr: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
      />
    </svg>
  ),
  cs: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
      />
    </svg>
  ),
  campaigns: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"
      />
    </svg>
  ),
  transfers: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    </svg>
  ),
  returns: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
      />
    </svg>
  ),
  audit: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  ),
  leaderboards: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0"
      />
    </svg>
  ),
  categories: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  ),
  settings: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  /** Delivery remittances — receipt/document with checkmark */
  remittances: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
    </svg>
  ),
  /** Disbursements — arrow going out of wallet / send money */
  disbursements: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  ),
  notifications: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  ),
  /** PWA install — download/arrow icon */
  install: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  ),
  /** My Profile — distinct from `users` (the staff directory) so the sidebar entry reads as personal. */
  profile: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
};
