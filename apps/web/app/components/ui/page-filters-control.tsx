import { useId, useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';

/**
 * Compact toolbar **Filters** button: opens a modal holding the filter controls
 * (icon → modal, sibling to `<PageSearchControl>`). Use this in a page-header
 * actions row (e.g. inside `PageHeaderMobileTools` `desktop={}`) where the full
 * `<ToolbarFiltersCollapsible>` container chrome (its own `border-b` bar) would
 * be out of place. For a standalone table toolbar above a list, prefer
 * `<ToolbarFiltersCollapsible>` which pairs Search + Filters in one bar.
 *
 * Behaviour matches the mobile filter sheet: controls apply-on-change, a **Done**
 * button dismisses, and an active-filter count shows on the button.
 */
export function PageFiltersControl({
  children,
  badgeCount = 0,
  onClearAll,
  label = 'Filters',
  title = 'Filters',
  subtitle,
  doneLabel = 'Done',
  bodyMaxHeightClassName = 'max-h-[min(70dvh,480px)]',
}: {
  /** The filter controls. Rendered stacked full-width inside the modal. */
  children: ReactNode;
  badgeCount?: number;
  onClearAll?: () => void;
  label?: string;
  title?: string;
  subtitle?: ReactNode;
  doneLabel?: string;
  bodyMaxHeightClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const hasBody = children != null && children !== false;
  if (!hasBody) return null;

  return (
    <>
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
        onClick={() => setOpen(true)}
      >
        <FiltersFunnelIcon />
        <span>{label}</span>
        {badgeCount > 0 ? (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-2xs font-semibold text-white">
            {badgeCount}
          </span>
        ) : null}
      </Button>

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
              {title}
            </h2>
            {subtitle ? <div className="mt-0.5 text-xs text-app-fg-muted">{subtitle}</div> : null}
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
            bodyMaxHeightClassName,
            '[&>*]:w-full [&>*]:shrink-0',
            '[&_[data-toolbar-filter]]:!w-full',
            '[&_.relative]:!w-full',
            '[&_[data-toolbar-filter]>*]:!w-full [&_[data-toolbar-filter]>*]:!max-w-none',
          ].join(' ')}
        >
          {children}
        </div>
        <div className="border-t border-app-border p-3 pt-2">
          <Button type="button" variant="primary" className="w-full" onClick={() => setOpen(false)}>
            {doneLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function FiltersFunnelIcon({ className = 'h-4 w-4 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M8 12h8M10 18h4" />
    </svg>
  );
}
