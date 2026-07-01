import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from '@remix-run/react';
import { useResolveFilterHref } from '~/hooks/useFilterPreferences';

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
  barItems: BottomNavItem[];
  allItems: BottomNavItem[];
  allGroups?: BottomNavGroup[];
  currentPathname: string;
  /** When provided, modal is controlled by parent (layout renders the modal). Use for dashboard so modal survives remounts. */
  moreOpen?: boolean;
  onMoreOpenChange?: (open: boolean) => void;
}

function isActive(pathname: string, href: string): boolean {
  if (!pathname) return false;
  if (href === '/admin' || href === '/tpl') {
    return pathname === href || pathname === `${href}/`;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

const OVERLAY_CLOSE_DELAY_MS = 500;

const MoreIcon = (
  <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="6" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="18" r="2" />
  </svg>
);

export interface BottomNavMoreModalProps {
  open: boolean;
  onClose: () => void;
  allItems: BottomNavItem[];
  allGroups?: BottomNavGroup[];
  currentPathname: string;
  /** Shown below the scrollable nav list (e.g. Install app link). */
  footer?: ReactNode;
}

/**
 * Slide-up "More" menu: overlay + panel. Ignores overlay clicks for a short delay after open to avoid same-tap close on mobile.
 */
export function BottomNavMoreModal({
  open,
  onClose,
  allItems,
  allGroups,
  currentPathname,
  footer,
}: BottomNavMoreModalProps) {
  const resolveHref = useResolveFilterHref();
  const openedAtRef = useRef<number | null>(null);
  const [overlayCanClose, setOverlayCanClose] = useState(false);

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      setOverlayCanClose(false);
      const t = setTimeout(() => setOverlayCanClose(true), OVERLAY_CLOSE_DELAY_MS);
      return () => clearTimeout(t);
    } else {
      openedAtRef.current = null;
      setOverlayCanClose(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const handleOverlayClick = () => {
    if (!overlayCanClose) return;
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="All navigation options"
    >
      <div
        className="absolute inset-0 bg-black/50"
        style={{ pointerEvents: overlayCanClose ? 'auto' : 'none' }}
        onClick={handleOverlayClick}
        aria-hidden
      />
      <div className="absolute bottom-0 left-0 right-0 h-[70vh] flex flex-col rounded-t-2xl bg-app-elevated border-t border-app-border shadow-lg pb-[env(safe-area-inset-bottom)] animate-slide-up-from-bottom">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-app-border">
          <h2 className="text-sm font-semibold text-app-fg">All options</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-app-fg-muted hover:bg-app-hover"
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
                <li key={group.group ?? `_g_${gi}`}>
                  {group.group && (
                    <div className="px-4 pt-4 pb-1 first:pt-1">
                      <span className="text-micro font-semibold uppercase tracking-wider text-app-fg-muted">
                        {group.group}
                      </span>
                    </div>
                  )}
                  <ul>
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <NavLink
                          to={resolveHref(item.href)}
                          end={item.href === '/admin' || item.href === '/tpl'}
                          prefetch="render"
                          onClick={onClose}
                          className={`flex items-center gap-3 px-4 py-3 text-left text-sm ${
                            isActive(currentPathname, item.href)
                              ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-medium'
                              : 'text-app-fg-muted hover:bg-app-hover'
                          }`}
                        >
                          <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-lg bg-app-hover [&>svg]:w-5 [&>svg]:h-5">
                            {item.icon}
                          </span>
                          <span className="flex-1 min-w-0">{item.label}</span>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              ))
            : allItems.map((item) => (
                <li key={item.href}>
                  <NavLink
                    to={item.href}
                    end={item.href === '/admin' || item.href === '/tpl'}
                    prefetch="render"
                    onClick={onClose}
                    className={`flex items-center gap-3 px-4 py-3 text-left text-sm ${
                      isActive(currentPathname, item.href)
                        ? 'bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 font-medium'
                        : 'text-app-fg-muted hover:bg-app-hover'
                    }`}
                  >
                    <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-lg bg-app-hover [&>svg]:w-5 [&>svg]:h-5">
                      {item.icon}
                    </span>
                    <span className="flex-1 min-w-0">{item.label}</span>
                  </NavLink>
                </li>
              ))}
        </ul>
        {footer ? (
          <div className="shrink-0 border-t border-app-border px-2 py-2">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Fixed bottom navigation for mobile. Up to 4 bar items + "More" that opens a slide-up modal.
 * When moreOpen/onMoreOpenChange are passed (e.g. from dashboard layout), the parent should also render BottomNavMoreModal so the menu survives remounts.
 */
export function BottomNav({
  barItems,
  allItems,
  allGroups,
  currentPathname,
  moreOpen: moreOpenProp,
  onMoreOpenChange,
}: BottomNavProps) {
  const resolveHref = useResolveFilterHref();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = moreOpenProp !== undefined && onMoreOpenChange !== undefined;
  const moreOpen = isControlled ? moreOpenProp : internalOpen;
  const setMoreOpen = isControlled ? (open: boolean) => onMoreOpenChange(open) : setInternalOpen;

  const showMore = allItems.length > 4;
  const displayBarItems = showMore ? barItems.slice(0, 4) : barItems;


  const handleOpenMore = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMoreOpen(true);
  };

  const handleCloseMore = () => setMoreOpen(false);

  useEffect(() => {
    if (isControlled || !moreOpen) return;
    const onEscape = (e: KeyboardEvent) => e.key === 'Escape' && handleCloseMore();
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [isControlled, moreOpen]);

  useEffect(() => {
    if (isControlled || !moreOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isControlled, moreOpen]);

  if (allItems.length === 0) return null;

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden items-stretch gap-1.5 px-2 pt-1.5 bg-app-elevated border-t border-app-border pb-[calc(env(safe-area-inset-bottom)+0.375rem)]"
        style={{ minHeight: 'var(--bottom-nav-height)' }}
        aria-label="Main navigation"
      >
        {displayBarItems.map((item) => {
          const active = isActive(currentPathname, item.href);
          return (
            <NavLink
              key={item.href}
              to={resolveHref(item.href)}
              end={item.href === '/admin' || item.href === '/tpl'}
              prefetch="render"
              className={({ isPending }) => {
                const on = active || isPending;
                return [
                  'flex flex-1 flex-col items-center justify-center gap-0.5 min-w-0 min-h-[2.875rem] px-1 py-1.5 rounded-xl border transition-[color,background-color,border-color,box-shadow] touch-manipulation',
                  'bg-app-canvas shadow-sm shadow-black/5 dark:shadow-black/40',
                  'border-app-border-strong/60 dark:border-app-border',
                  on
                    ? 'text-brand-700 dark:text-brand-300 border-brand-500/15 dark:border-brand-400/20 bg-brand-500/[0.06] dark:bg-brand-400/[0.08]'
                    : 'text-app-fg-muted border-app-border hover:border-app-border-strong hover:bg-app-hover/80 active:scale-[0.98]',
                ].join(' ');
              }}
            >
              <span className="w-6 h-6 flex items-center justify-center flex-shrink-0 [&>svg]:w-5 [&>svg]:h-5">
                {item.icon}
              </span>
              <span className="text-micro font-medium truncate max-w-full text-center leading-tight">{item.label}</span>
            </NavLink>
          );
        })}
        {showMore && (
          <button
            type="button"
            onClick={handleOpenMore}
            className={[
              'flex shrink-0 min-w-[2.75rem] min-h-[2.875rem] flex-col items-center justify-center rounded-xl border transition-[transform,box-shadow] touch-manipulation shadow-sm shadow-black/5 dark:shadow-black/40',
              moreOpen
                ? 'border-brand-600 bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 ring-1 ring-brand-500/20'
                : 'border-brand-500 bg-white dark:bg-surface-800 text-brand-500 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10 active:scale-[0.98]',
            ].join(' ')}
            aria-label="More options"
            aria-expanded={moreOpen}
          >
            <span className="w-6 h-6 flex items-center justify-center [&>svg]:w-6 [&>svg]:h-6">
              {MoreIcon}
            </span>
          </button>
        )}
      </nav>

      {!isControlled && moreOpen && (
        <BottomNavMoreModal
          open={moreOpen}
          onClose={handleCloseMore}
          allItems={allItems}
          allGroups={allGroups}
          currentPathname={currentPathname}
        />
      )}
    </>
  );
}
