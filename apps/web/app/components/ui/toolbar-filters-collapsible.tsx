import { useId, useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';

/** Funnel / filter lines icon — use on the mobile “Filters” trigger. */
export function ToolbarFiltersFunnelIcon({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M8 12h8M10 18h4" />
    </svg>
  );
}

export type ToolbarFiltersBreakpoint = 'md' | 'lg';

export interface ToolbarFiltersCollapsibleProps {
  /** Search row — typically `<form>` + `SearchInput` + submit (single instance in DOM). Omit or pass `null` when only inline/sheet filters apply. */
  searchRow?: ReactNode;
  /** Selects / chips shown inline at `breakpoint` and up (same row as search). */
  desktopInlineFilters: ReactNode;
  /** Stacked controls inside the mobile sheet (full-width selects, etc.). */
  sheetFilterBody: ReactNode;
  sheetTitle?: string;
  sheetSubtitle?: ReactNode;
  /** Shown next to “Filters” when &gt; 0. */
  badgeCount?: number;
  filtersButtonLabel?: string;
  sheetDoneLabel?: string;
  breakpoint?: ToolbarFiltersBreakpoint;
  /** Extra classes on outer `border-b` wrapper. */
  className?: string;
  /** Scroll region max-height class inside sheet. */
  sheetBodyMaxHeightClassName?: string;
}

function rowClasses(bp: ToolbarFiltersBreakpoint): string {
  return bp === 'lg'
    ? 'flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3'
    : 'flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-3';
}

function hideFiltersBtn(bp: ToolbarFiltersBreakpoint): string {
  return bp === 'lg' ? 'lg:hidden' : 'md:hidden';
}

function showInlineFilters(bp: ToolbarFiltersBreakpoint): string {
  return bp === 'lg'
    ? 'hidden flex-col gap-3 lg:flex lg:flex-row lg:items-center lg:gap-3'
    : 'hidden flex-col gap-3 md:flex md:flex-row md:items-center md:gap-3';
}

/**
 * Below `breakpoint` (default `md`): full-width **Filters** button above `searchRow`;
 * filter controls live in a bottom sheet. At `breakpoint` and up: one horizontal
 * bar (search + `desktopInlineFilters`). Changes inside selects should keep using
 * your existing handlers (apply-on-change); sheet only needs **Done** to dismiss.
 */
export function ToolbarFiltersCollapsible({
  searchRow,
  desktopInlineFilters,
  sheetFilterBody,
  sheetTitle = 'Filters',
  sheetSubtitle,
  badgeCount = 0,
  filtersButtonLabel = 'Filters',
  sheetDoneLabel = 'Done',
  breakpoint = 'md',
  className = '',
  sheetBodyMaxHeightClassName = 'max-h-[min(70dvh,480px)]',
}: ToolbarFiltersCollapsibleProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const bp = breakpoint;

  return (
    <>
      <div className={['border-b border-app-border px-4 py-3', className].filter(Boolean).join(' ')}>
        <div className={rowClasses(bp)}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={['w-full shrink-0 justify-center gap-2', hideFiltersBtn(bp)].join(' ')}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <ToolbarFiltersFunnelIcon />
            <span>{filtersButtonLabel}</span>
            {badgeCount > 0 ? (
              <span className="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:text-brand-300">
                {badgeCount}
              </span>
            ) : null}
          </Button>

          {searchRow != null && searchRow !== false ? (
            <div className="min-w-0 flex-1">{searchRow}</div>
          ) : null}

          <div className={showInlineFilters(bp)}>{desktopInlineFilters}</div>
        </div>
      </div>

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
          className={['flex flex-col gap-4 overflow-y-auto p-4', sheetBodyMaxHeightClassName].join(' ')}
        >
          {sheetFilterBody}
        </div>
        <div className="border-t border-app-border p-3 pt-2">
          <Button type="button" variant="secondary" className="w-full" onClick={() => setOpen(false)}>
            {sheetDoneLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}
