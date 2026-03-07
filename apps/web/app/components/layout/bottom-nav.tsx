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
  /** When set and canInstall, show an "Install" row at the bottom of the More modal. Hidden when already installed. */
  pwaInstall?: { canInstall: boolean; install: () => void };
  /** Controlled More modal open state (e.g. from layout) so it survives BottomNav remounts. */
  moreOpen?: boolean;
  /** Called when More modal should open or close. When provided with moreOpen, state is controlled by parent. */
  onMoreOpenChange?: (open: boolean) => void;
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
const OVERLAY_CLOSE_DELAY_MS = 300;

const InstallIcon = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

export function BottomNav({ barItems, allItems, allGroups, currentPathname, pwaInstall, moreOpen: moreOpenProp, onMoreOpenChange }: BottomNavProps) {
  const [internalMoreOpen, setInternalMoreOpen] = useState(false);
  const isControlled = moreOpenProp !== undefined && onMoreOpenChange !== undefined;
  const moreOpen = isControlled ? moreOpenProp : internalMoreOpen;
  const setMoreOpen = isControlled ? (open: boolean) => onMoreOpenChange(open) : setInternalMoreOpen;

  const modalRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef<number | null>(null);

  const showMore = allItems.length > 4;
  const displayBarItems = showMore ? barItems.slice(0, 4) : barItems;

  const closeMore = () => {
    // #region agent log
    fetch('http://127.0.0.1:7446/ingest/fef61901-cf82-4188-853f-f0e1d3885547',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d6c72e'},body:JSON.stringify({sessionId:'d6c72e',location:'bottom-nav.tsx:closeMore',message:'closeMore called',data:{moreOpen,runId:'post-fix'},hypothesisId:'B',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    openedAtRef.current = null;
    setMoreOpen(false);
  };

  useEffect(() => {
    if (!moreOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMore();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [moreOpen]);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7446/ingest/fef61901-cf82-4188-853f-f0e1d3885547',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d6c72e'},body:JSON.stringify({sessionId:'d6c72e',location:'bottom-nav.tsx:useEffect(moreOpen)',message:'moreOpen changed',data:{moreOpen},hypothesisId:'B_D',timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
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
            onClick={(e) => {
              e.stopPropagation();
              const t = Date.now();
              openedAtRef.current = t;
              // #region agent log
              fetch('http://127.0.0.1:7446/ingest/fef61901-cf82-4188-853f-f0e1d3885547',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d6c72e'},body:JSON.stringify({sessionId:'d6c72e',location:'bottom-nav.tsx:MoreButton',message:'More button clicked',data:{openedAt:t,runId:'post-fix'},hypothesisId:'A_B',timestamp:t})}).catch(()=>{});
              // #endregion
              setMoreOpen(true);
            }}
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
            onClick={() => {
              const elapsed = Date.now() - (openedAtRef.current ?? 0);
              const willClose = elapsed > OVERLAY_CLOSE_DELAY_MS;
              // #region agent log
              fetch('http://127.0.0.1:7446/ingest/fef61901-cf82-4188-853f-f0e1d3885547',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d6c72e'},body:JSON.stringify({sessionId:'d6c72e',location:'bottom-nav.tsx:overlay',message:'Overlay clicked',data:{elapsed,willClose,OVERLAY_CLOSE_DELAY_MS},hypothesisId:'A_B',timestamp:Date.now()})}).catch(()=>{});
              // #endregion
              if (willClose) {
                closeMore();
              }
            }}
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
                onClick={closeMore}
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
                                onClick={closeMore}
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
                          onClick={closeMore}
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
              {pwaInstall?.canInstall && (
                <li className="border-t border-surface-200 dark:border-surface-800 mt-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      pwaInstall.install();
                      closeMore();
                    }}
                    className="flex items-center gap-3 px-4 py-3 text-left text-sm w-full text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800"
                  >
                    <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 [&>svg]:w-5 [&>svg]:h-5">
                      {InstallIcon}
                    </span>
                    <span className="flex-1 min-w-0">Install</span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
