import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
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
}: PageHeaderMobileToolsProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeSheet = useCallback(() => setOpen(false), []);
  const openSheet = useCallback(() => setOpen(true), []);
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

  return (
    <>
      {/* Desktop: inline actions */}
      <div className="hidden shrink-0 flex-wrap items-center gap-2 md:flex">
        {desktop}
        {resolvedFilterKey && <SaveFilterPrefsButton pageKey={resolvedFilterKey} hasSavedPrefs={hasSavedPrefs} filtersChanged={filtersChanged} />}
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

      {hasSheetOrFilters ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
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
            <Button type="button" variant="primary" className="w-full" onClick={() => setOpen(false)}>
              {sheetCloseLabel}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Re-export for pages that build custom mobile toolbar rows. */
export { FiltersIcon as MobileFiltersIcon };
