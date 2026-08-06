import { useId, useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';

/** Funnel / filter lines icon — use on the “Filters” trigger. */
export function ToolbarFiltersFunnelIcon({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M8 12h8M10 18h4" />
    </svg>
  );
}

export type ToolbarFiltersBreakpoint = 'md' | 'lg';

export interface ToolbarFiltersCollapsibleProps {
  /** Search row — prefer `<PageSearchControl>` (icon → modal). Omit or pass `null` when only filters apply. */
  searchRow?: ReactNode;
  /**
   * The filter controls. On BOTH desktop and mobile these now live behind a
   * **Filters** button that opens a modal (icon → modal, like the search control).
   * Pass full-width-friendly controls (selects, chips) — the modal stacks them.
   *
   * Historically this component showed `desktopInlineFilters` inline on desktop and
   * `sheetFilterBody` stacked on mobile. Those are now unified: `desktopInlineFilters`
   * is the single source for the modal body, and `sheetFilterBody` (when provided)
   * overrides it for the modal only. Most callers can keep passing the same node to
   * `desktopInlineFilters` and drop `sheetFilterBody`.
   */
  desktopInlineFilters: ReactNode;
  /** Optional distinct body for the Filters modal. Defaults to `desktopInlineFilters`. */
  sheetFilterBody?: ReactNode;
  /**
   * @deprecated The desktop inline strip is retired — filters always open in a modal
   * now. This flag no longer suppresses anything and is kept only for call-site
   * compatibility. Pass `searchRow`-only pages nothing here.
   */
  hideMobileSheet?: boolean;
  sheetTitle?: string;
  sheetSubtitle?: ReactNode;
  /** Shown on the Filters button when &gt; 0. */
  badgeCount?: number;
  /** Callback to clear all active filters. When provided with `badgeCount > 0`,
   *  a floating dismiss button renders at the top-right edge of the toolbar. */
  onClearAll?: () => void;
  filtersButtonLabel?: string;
  sheetDoneLabel?: string;
  /**
   * Draft-until-Apply support. When provided, the modal footer becomes an
   * **Apply** button: filter controls stage changes locally (via `useDraftFilters`)
   * and nothing navigates until Apply is pressed. Wire to the draft hook's `apply`;
   * `applyDisabled` to `!draft.dirty`.
   */
  onApply?: () => void;
  /** Disables the Apply button (typically `!draft.dirty`). */
  applyDisabled?: boolean;
  /** Label for the Apply button. Default "Apply". */
  applyLabel?: string;
  /** Called when the Filters modal opens — re-seed the draft. Wire to `draft.reseed`. */
  onOpen?: () => void;
  /** @deprecated Layout no longer branches on a breakpoint — kept for compatibility. */
  breakpoint?: ToolbarFiltersBreakpoint;
  /** Extra classes on outer `border-b` wrapper. */
  className?: string;
  /** Scroll region max-height class inside the modal. */
  sheetBodyMaxHeightClassName?: string;
}

/**
 * Toolbar row above a table: a **Search** control and a **Filters** button, both
 * opening a modal (icon → modal). Filter controls no longer render as an inline
 * strip — clicking **Filters** opens a modal holding them (apply-on-change; a
 * **Done** button dismisses). An active-filter count shows on the button.
 *
 * Desktop-only container (`hidden md:block`); mobile filters live in
 * `PageHeaderMobileTools` `filters` + `MobileDateFilterRow` as before.
 */
export function ToolbarFiltersCollapsible({
  searchRow,
  desktopInlineFilters,
  sheetFilterBody,
  sheetTitle = 'Filters',
  sheetSubtitle,
  badgeCount = 0,
  onClearAll,
  filtersButtonLabel = 'Filters',
  sheetDoneLabel = 'Done',
  onApply,
  applyDisabled = false,
  applyLabel = 'Apply',
  onOpen,
  className = '',
  sheetBodyMaxHeightClassName = 'max-h-[min(70dvh,480px)]',
}: ToolbarFiltersCollapsibleProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const openModal = () => {
    onOpen?.();
    setOpen(true);
  };

  // The modal body: an explicit `sheetFilterBody` wins; otherwise reuse the
  // controls passed as `desktopInlineFilters` (now the single source of truth).
  const modalBody = sheetFilterBody ?? desktopInlineFilters;
  const hasFilters = modalBody != null && modalBody !== false;

  return (
    <>
      <div className={['relative border-b border-app-border py-2 md:px-4 hidden md:block', className].filter(Boolean).join(' ')}>
        {/* Floating clear-all badge at top-right edge of the toolbar */}
        {badgeCount > 0 && onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="absolute -top-2.5 -right-1 md:right-2 z-10 flex items-center gap-1 rounded-full bg-danger-500 pl-2 pr-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm transition-colors hover:bg-danger-600 dark:bg-danger-600 dark:hover:bg-danger-500"
            title="Clear all filters"
          >
            Clear
            <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {searchRow != null && searchRow !== false ? (
            <div className="flex min-w-0 items-center" data-has-toolbar-search>{searchRow}</div>
          ) : null}

          {hasFilters ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={[
                'shrink-0 justify-center gap-2',
                badgeCount > 0 ? 'border-brand-500/40 bg-brand-500/10 text-brand-600 dark:text-brand-400' : '',
              ].join(' ')}
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={openModal}
            >
              <ToolbarFiltersFunnelIcon />
              <span>{filtersButtonLabel}</span>
              {badgeCount > 0 ? (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-2xs font-semibold text-white">
                  {badgeCount}
                </span>
              ) : null}
            </Button>
          ) : null}
        </div>
      </div>

      {hasFilters ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          maxWidth="max-w-lg"
          aria-labelledby={titleId}
          contentClassName="p-0"
        >
          <div className="flex items-start justify-between gap-3 border-b border-app-border px-4 py-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-app-fg">
                {sheetTitle}
              </h2>
              {sheetSubtitle ? <div className="mt-0.5 text-xs text-app-fg-muted">{sheetSubtitle}</div> : null}
            </div>
            {badgeCount > 0 && onClearAll ? (
              <button
                type="button"
                onClick={onClearAll}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-danger-600 hover:bg-danger-500/10 dark:text-danger-400"
              >
                Clear all
              </button>
            ) : null}
          </div>
          <div
            className={[
              'flex flex-col gap-3 overflow-y-auto p-4',
              sheetBodyMaxHeightClassName,
              // Filter controls stack full-width inside the modal, matching the
              // mobile sheet treatment so both surfaces look identical. Direct
              // children stack (the body is already flex-col); the descendant
              // rules override the `sm:w-*` / `w-auto` width presets that these
              // controls carry for the (now-retired) inline desktop strip.
              '[&>*]:w-full [&>*]:shrink-0',
              '[&_[data-toolbar-filter]]:!w-full',
              // Full-width the control wrappers (including any nested `.relative`
              // container), but NOT absolutely-positioned children like
              // FilterDismiss (the small red ✕ badge) — that keeps its own size
              // and stays pinned to the wrapper's top-right corner.
              '[&_[data-toolbar-filter]>*:not(.absolute)]:!w-full [&_[data-toolbar-filter]>*:not(.absolute)]:!max-w-none',
              '[&_[data-toolbar-filter]_.relative]:!w-full',
              // Taller controls to match the roomy modal spacing.
              '[&_[data-toolbar-filter]_button[aria-haspopup]]:!min-h-[2.75rem]',
            ].join(' ')}
          >
            {modalBody}
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
                  setOpen(false);
                }}
              >
                {applyLabel}
              </Button>
            ) : (
              <Button type="button" variant="primary" className="w-full" onClick={() => setOpen(false)}>
                {sheetDoneLabel}
              </Button>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
