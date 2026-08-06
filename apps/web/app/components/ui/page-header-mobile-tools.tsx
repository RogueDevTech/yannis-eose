import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { SaveFilterPrefsButton } from '~/components/ui/save-filter-prefs-button';
import { useFilterPreferences } from '~/hooks/useFilterPreferences';
import { registerMobileActionsOpener } from '~/lib/mobile-actions-bridge';

export type PageHeaderMobileToolsSheetRender = (api: { closeSheet: () => void }) => ReactNode;

function FiltersIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
    </svg>
  );
}

/** Vertical three-dots — matches the mobile Actions button (MobileDateFilterRow). */
function KebabVerticalIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  );
}

export interface PageHeaderMobileToolsProps {
  desktop: ReactNode;
  sheet?: ReactNode | PageHeaderMobileToolsSheetRender;
  filters?: ReactNode | PageHeaderMobileToolsSheetRender;
  filtersBadgeCount?: number;
  onClearFilters?: () => void;
  sheetTitle: string;
  sheetSubtitle?: ReactNode;
  triggerAriaLabel: string;
  /** @deprecated Mobile icons removed — refresh is in MobileDateFilterRow. */
  showMobileRefresh?: boolean;
  sheetCloseLabel?: string;
  sheetBodyMaxHeightClassName?: string;
  /** @deprecated No longer rendered inline on mobile. */
  mobileLeading?: ReactNode;
  saveFilterKey?: boolean | string;
  /**
   * When true, render an "Actions" button on DESKTOP too (not just mobile) that
   * opens the same sheet. Use this to keep only the quick actions inline in
   * `desktop` (Live / Refresh / date) and move the rest into `sheet`, so a busy
   * header doesn't overflow. Label customisable via `desktopActionsLabel`.
   */
  desktopActions?: boolean;
  /** Label for the desktop Actions button. Default "Actions". */
  desktopActionsLabel?: string;
  /**
   * Draft-until-Apply support. When provided, the sheet's footer button becomes
   * an **Apply** action: filter controls stage changes locally (via
   * `useDraftFilters`) and nothing navigates until the user presses it. Wire this
   * to the draft hook's `apply`; `applyDisabled` to `!draft.dirty`.
   */
  onApply?: () => void;
  /** Disables the Apply button (typically `!draft.dirty`). */
  applyDisabled?: boolean;
  /** Label for the Apply button. Default "Apply". */
  applyLabel?: string;
  /**
   * Called when the sheet/dropdown OPENS — re-seed the draft from the committed
   * URL so a previously-abandoned draft doesn't linger. Wire to `draft.reseed`.
   */
  onSheetOpen?: () => void;
}

/**
 * Desktop: renders `desktop` actions inline.
 * Mobile: owns the Actions sheet modal; the visible Actions button lives in
 * `MobileDateFilterRow` and opens this sheet via the mobile-actions bridge.
 */
export function PageHeaderMobileTools({
  desktop,
  sheet,
  filters,
  filtersBadgeCount = 0,
  onClearFilters,
  sheetTitle,
  sheetSubtitle,
  triggerAriaLabel,
  sheetCloseLabel = 'Close',
  sheetBodyMaxHeightClassName = 'max-h-[min(75dvh,560px)]',
  saveFilterKey,
  desktopActions = false,
  desktopActionsLabel = 'Actions',
  onApply,
  applyDisabled = false,
  applyLabel = 'Apply',
  onSheetOpen,
}: PageHeaderMobileToolsProps) {
  // `openedFrom` tracks the surface that opened the actions: 'desktop' anchors a
  // popover under the Actions button; 'mobile' (via the bridge) shows the full
  // sheet Modal. Desktop deserves a lightweight dropdown, not a centered modal.
  const [openedFrom, setOpenedFrom] = useState<'desktop' | 'mobile' | null>(null);
  const titleId = useId();
  const closeSheet = useCallback(() => setOpenedFrom(null), []);
  // The mobile-actions bridge calls this — always the mobile sheet.
  const openSheet = useCallback(() => {
    onSheetOpen?.();
    setOpenedFrom('mobile');
  }, [onSheetOpen]);
  const desktopBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, right: 0 });
  const { pathname } = useLocation();

  const resolvedFilterKey = saveFilterKey === true
    ? pathname.replace(/^\//, '').replace(/\//g, '.')
    : typeof saveFilterKey === 'string' ? saveFilterKey : null;

  const sheetContent = typeof sheet === 'function' ? sheet({ closeSheet }) : sheet;
  const hasSheet = sheetContent != null && sheetContent !== false;
  const filtersContent =
    typeof filters === 'function' ? filters({ closeSheet }) : filters;
  const hasFilters = filtersContent != null && filtersContent !== false;
  // saveFilterKey alone must still open a mobile Actions sheet (Save filters).
  const hasSheetOrFilters = hasSheet || hasFilters || !!resolvedFilterKey;

  // Register opener only when there is something to show in the sheet.
  useEffect(() => {
    if (!hasSheetOrFilters) return;
    return registerMobileActionsOpener(openSheet);
  }, [hasSheetOrFilters, openSheet]);

  const filterPrefs = useFilterPreferences(resolvedFilterKey ?? '__noop__');
  const hasSavedPrefs = resolvedFilterKey ? filterPrefs.hasSavedPrefs : false;
  const filtersChanged = resolvedFilterKey ? filterPrefs.hasChanges : false;

  // ── Desktop popover: position under the Actions button, close on outside-click
  //    / scroll. Mirrors ActionDropdown so behavior is consistent across the app.
  useEffect(() => {
    if (openedFrom !== 'desktop' || !desktopBtnRef.current) return;
    const rect = desktopBtnRef.current.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }, [openedFrom]);

  useEffect(() => {
    if (openedFrom !== 'desktop') return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        desktopBtnRef.current && !desktopBtnRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpenedFrom(null);
      }
    }
    function handleScroll() {
      setOpenedFrom(null);
    }
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [openedFrom]);

  return (
    <>
      {/* Desktop: inline actions. With `desktopActions`, the quick items stay
          inline and an Actions button opens the sheet (same as mobile) so a busy
          header stays tidy. Without it, everything renders inline as before. */}
      <div className="hidden shrink-0 flex-wrap items-center gap-2 md:flex">
        {desktop}
        {!desktopActions && resolvedFilterKey && (
          <SaveFilterPrefsButton pageKey={resolvedFilterKey} hasSavedPrefs={hasSavedPrefs} filtersChanged={filtersChanged} />
        )}
        {desktopActions && hasSheetOrFilters && (
          <Button
            ref={desktopBtnRef}
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setOpenedFrom((v) => {
                if (v === 'desktop') return null;
                onSheetOpen?.();
                return 'desktop';
              })
            }
            aria-label={triggerAriaLabel}
            aria-haspopup="menu"
            aria-expanded={openedFrom === 'desktop'}
          >
            <span className="inline-flex items-center gap-1.5">
              <KebabVerticalIcon className="w-4 h-4" />
              {desktopActionsLabel}
              {filtersBadgeCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-2xs font-semibold text-white">
                  {filtersBadgeCount}
                </span>
              )}
            </span>
          </Button>
        )}
      </div>

      {/* Marker kept for diagnostics / optional DOM checks */}
      {hasSheetOrFilters ? (
        <span
          data-mobile-actions-trigger
          data-trigger-label={triggerAriaLabel}
          data-filters-badge={filtersBadgeCount > 0 ? String(filtersBadgeCount) : undefined}
          className="hidden"
          aria-hidden
        />
      ) : null}

      {/* Desktop: a dropdown anchored under the Actions button, over a dimmed
          full-screen backdrop (modal feel) so focus lands on the menu. Only when
          opened from the desktop button. */}
      {hasSheetOrFilters && openedFrom === 'desktop' && typeof document !== 'undefined'
        ? createPortal(
            <>
            {/* Dim backdrop — click anywhere off the menu to dismiss. */}
            <div
              className="fixed inset-0 z-[9998] bg-black/40 animate-fade-in"
              aria-hidden
              onMouseDown={() => closeSheet()}
            />
            <div
              ref={popoverRef}
              role="menu"
              aria-label={sheetTitle}
              className="fixed z-[9999] w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-app-border bg-app-elevated shadow-lg animate-fade-in"
              style={{ top: popoverPos.top, right: popoverPos.right }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                // Close the dropdown as soon as any item is activated — most open
                // their own modal (Compare, Export) or navigate, so leaving the
                // menu open would stack a popover behind the new surface.
                onClick={() => closeSheet()}
                className={[
                  'flex max-h-[min(70dvh,480px)] flex-col gap-2 overflow-y-auto p-2',
                  '[&_button]:w-full [&_button]:justify-center [&_button]:text-sm',
                  '[&_a.btn-primary]:w-full [&_a.btn-primary]:justify-center [&_a.btn-primary]:text-sm',
                  '[&_a.btn-secondary]:w-full [&_a.btn-secondary]:justify-center [&_a.btn-secondary]:text-sm',
                ].join(' ')}
              >
                {/* Desktop dropdown shows ONLY the extra actions — the filters have
                    their own row/toolbar on desktop, so they are NOT repeated here
                    (unlike the mobile sheet, which is the only place filters live). */}
                {sheetContent}
                {resolvedFilterKey && (
                  <SaveFilterPrefsButton pageKey={resolvedFilterKey} hasSavedPrefs={hasSavedPrefs} className="w-full" />
                )}
              </div>
            </div>
            </>,
            document.body,
          )
        : null}

      {/* Mobile: the full-screen actions sheet, opened via the mobile bridge. */}
      {hasSheetOrFilters ? (
        <Modal
          open={openedFrom === 'mobile'}
          onClose={() => setOpenedFrom(null)}
          maxWidth="max-w-full"
          aria-labelledby={titleId}
          contentClassName="p-0"
        >
          <div className="border-b border-app-border px-4 py-3">
            <h2 id={titleId} className="text-base font-semibold text-app-fg">
              {sheetTitle}
            </h2>
            {sheetSubtitle ? <div className="mt-0.5 text-xs text-app-fg-muted">{sheetSubtitle}</div> : null}
          </div>
          <div
            className={[
              'flex flex-col gap-2.5 overflow-y-auto p-4',
              sheetBodyMaxHeightClassName,
              '[&_button]:w-full [&_button]:justify-center [&_button]:text-sm [&_button]:font-medium [&_button]:min-h-[2.75rem]',
              '[&_a.btn-primary]:w-full [&_a.btn-primary]:justify-center [&_a.btn-primary]:text-sm [&_a.btn-primary]:font-medium [&_a.btn-primary]:min-h-[2.75rem]',
              '[&_a.btn-secondary]:w-full [&_a.btn-secondary]:justify-center [&_a.btn-secondary]:text-sm [&_a.btn-secondary]:font-medium [&_a.btn-secondary]:min-h-[2.75rem]',
            ].join(' ')}
          >
            {hasFilters ? (
              <>
                {filtersContent}
                {sheetContent}
              </>
            ) : (
              sheetContent
            )}
            {resolvedFilterKey && (
              <SaveFilterPrefsButton pageKey={resolvedFilterKey} hasSavedPrefs={hasSavedPrefs} className="w-full" />
            )}
            {onClearFilters && filtersBadgeCount > 0 ? (
              <Button type="button" variant="secondary" className="w-full" onClick={() => { onClearFilters(); closeSheet(); }}>
                Clear filters
              </Button>
            ) : null}
          </div>
          <div className="border-t border-app-border p-3 pt-2">
            {onApply ? (
              <Button
                type="button"
                variant="primary"
                className="w-full"
                disabled={applyDisabled}
                onClick={() => {
                  onApply();
                  setOpenedFrom(null);
                }}
              >
                {applyLabel}
              </Button>
            ) : (
              <Button type="button" variant="primary" className="w-full" onClick={() => setOpenedFrom(null)}>
                {sheetCloseLabel}
              </Button>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Re-export for pages that build custom mobile toolbar rows. */
export { FiltersIcon as MobileFiltersIcon };
