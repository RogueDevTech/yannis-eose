import { useCallback, useId, useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';

export type PageHeaderMobileToolsSheetRender = (api: { closeSheet: () => void }) => ReactNode;

function KebabVerticalIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
      />
    </svg>
  );
}

export interface PageHeaderMobileToolsProps {
  /**
   * Full toolbar for `md+` — same nodes you would have put in `PageHeader` `actions`
   * before mobile collapse (date pill, buttons, labeled refresh, etc.).
   */
  desktop: ReactNode;
  /**
   * Mobile sheet body — usually the same controls with full-width buttons and
   * `DateFilterBar` `triggerLayout="blockCenter"`; omit duplicate refresh when
   * `showMobileRefresh` is true. Use the function form to receive `closeSheet`
   * (e.g. before opening another modal).
   */
  sheet: ReactNode | PageHeaderMobileToolsSheetRender;
  /**
   * Optional filter controls. When provided, the mobile sheet renders them under
   * a small "Filters" header above the action controls — letting a page collapse
   * its separate filter sheet into this one sheet. Pair with
   * `ToolbarFiltersCollapsible` `hideMobileSheet` so filters aren't duplicated.
   */
  filters?: ReactNode | PageHeaderMobileToolsSheetRender;
  /** Active filter count — shows a dot on the kebab trigger when &gt; 0. */
  filtersBadgeCount?: number;
  /** Sheet heading (also used for `aria-labelledby`). */
  sheetTitle: string;
  sheetSubtitle?: ReactNode;
  /** `aria-label` on the kebab trigger. */
  triggerAriaLabel: string;
  /** Icon-only refresh beside kebab below `md`. Default true. */
  showMobileRefresh?: boolean;
  /** Footer button label. Default "Close". */
  sheetCloseLabel?: string;
  /** Max height of scrollable sheet body. */
  sheetBodyMaxHeightClassName?: string;
  /** Rendered before refresh + kebab below `md` only (e.g. live indicator). */
  mobileLeading?: ReactNode;
}

/**
 * Collapses a crowded `PageHeader` actions row on small screens: below `md`,
 * shows `PageRefreshButton` `iconOnly` + kebab that opens a bottom sheet with
 * `sheet` content. At `md` and up, renders `desktop` only.
 *
 * Use when `PageHeader` `actions` would wrap or crowd (date + several buttons + refresh).
 */
export function PageHeaderMobileTools({
  desktop,
  sheet,
  filters,
  filtersBadgeCount = 0,
  sheetTitle,
  sheetSubtitle,
  triggerAriaLabel,
  showMobileRefresh = true,
  sheetCloseLabel = 'Close',
  sheetBodyMaxHeightClassName = 'max-h-[min(75dvh,560px)]',
  mobileLeading,
}: PageHeaderMobileToolsProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeSheet = useCallback(() => setOpen(false), []);

  const sheetContent = typeof sheet === 'function' ? sheet({ closeSheet }) : sheet;
  const filtersContent =
    typeof filters === 'function' ? filters({ closeSheet }) : filters;
  const hasFilters = filtersContent != null && filtersContent !== false;

  return (
    <>
      <div className="hidden shrink-0 flex-wrap items-center gap-2 md:flex">{desktop}</div>
      <div className="flex shrink-0 items-center justify-end gap-0.5 md:hidden">
        {mobileLeading}
        {showMobileRefresh ? <PageRefreshButton iconOnly /> : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          // Grey-filled chrome to mirror PageRefreshButton (CEO 2026-05-19).
          className="relative h-9 w-9 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 p-0 text-app-fg-muted hover:bg-surface-200 hover:text-brand-600 dark:hover:bg-surface-700"
          aria-label={triggerAriaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <KebabVerticalIcon />
          {hasFilters && filtersBadgeCount > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-2 ring-app-elevated"
              aria-hidden
            />
          ) : null}
        </Button>
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
              'flex flex-col gap-3 overflow-y-auto p-4',
              sheetBodyMaxHeightClassName,
            ].join(' ')}
          >
            {/* Filters + actions flow as one balanced column — no divider
                between the groups (CEO 2026-05-19). The outer `gap-3` keeps
                every row evenly spaced. */}
            {hasFilters ? (
              <>
                {filtersContent}
                {sheetContent}
              </>
            ) : (
              sheetContent
            )}
          </div>
          <div className="border-t border-app-border p-3 pt-2">
            <Button type="button" variant="primary" className="w-full" onClick={() => setOpen(false)}>
              {sheetCloseLabel}
            </Button>
          </div>
        </Modal>
      </div>
    </>
  );
}
