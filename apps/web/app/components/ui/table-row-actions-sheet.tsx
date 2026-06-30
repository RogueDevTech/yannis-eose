import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { CompactTableActionButton } from '~/components/ui/compact-table';

/**
 * Declarative row action for {@link TableRowActionsSheet}.
 * Use `custom` when an action must be a `<fetcher.Form>` or other non-button control.
 */
export type TableRowSheetAction =
  | {
      key: string;
      kind: 'button';
      label: string;
      onClick: () => void;
      tone?: 'brand' | 'danger' | 'success';
      show?: boolean;
    }
  | {
      key: string;
      kind: 'link';
      label: string;
      to: string;
      tone?: 'brand' | 'danger' | 'success';
      show?: boolean;
    }
  | {
      key: string;
      kind: 'custom';
      show?: boolean;
      /** Rendered in the desktop strip and in the mobile sheet (full width). */
      render: (ctx: { close: () => void }) => ReactNode;
    };

const SHEET_TONE: Record<'brand' | 'danger' | 'success', string> = {
  brand:
    'text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/20 border-brand-200 dark:border-brand-800',
  danger:
    'text-danger-600 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-900/20 border-danger-200 dark:border-danger-800',
  success:
    'text-success-600 hover:bg-success-50 dark:text-success-400 dark:hover:bg-success-900/20 border-success-200 dark:border-success-800',
};

function EllipsisVerticalIcon({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'h-5 w-5'} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  );
}

export interface TableRowActionsSheetProps {
  /** Screen reader label for the kebab trigger (mobile). */
  ariaLabel: string;
  /** Title in the slide-up sheet. */
  sheetTitle?: string;
  actions: TableRowSheetAction[];
  /** Max actions shown inline on desktop. Overflow goes into kebab menu. Default: 2. */
  maxInline?: number;
}

/**
 * Row-level actions: **desktop** shows up to `maxInline` (default 2) inline buttons;
 * overflow goes into a compact dropdown. **Mobile** (`< md`) collapses everything
 * into a slide-up sheet.
 */
export function TableRowActionsSheet({ ariaLabel, sheetTitle = 'Actions', actions, maxInline = 2 }: TableRowActionsSheetProps) {
  const visible = actions.filter((a) => a.show !== false);
  const [openSource, setOpenSource] = useState<'mobile' | 'desktop' | null>(null);
  const open = openSource !== null;
  const titleId = useId();
  const close = () => setOpenSource(null);

  if (visible.length === 0) {
    return <span className="text-app-fg-muted">—</span>;
  }

  const renderDesktop = (a: TableRowSheetAction) => {
    if (a.kind === 'custom') {
      return (
        <span key={a.key} className="inline-flex">
          {a.render({ close: () => undefined })}
        </span>
      );
    }
    const tone = a.tone ?? 'brand';
    if (a.kind === 'link') {
      return (
        <CompactTableActionButton key={a.key} to={a.to} tone={tone}>
          {a.label}
        </CompactTableActionButton>
      );
    }
    return (
      <CompactTableActionButton key={a.key} tone={tone} onClick={a.onClick}>
        {a.label}
      </CompactTableActionButton>
    );
  };

  const renderSheetRow = (a: TableRowSheetAction) => {
    if (a.kind === 'custom') {
      return (
        <div key={a.key} className="px-1">
          {a.render({ close })}
        </div>
      );
    }
    const tone = a.tone ?? 'brand';
    const sheetBtn =
      'flex w-full items-center justify-between rounded-xl border bg-app-elevated px-4 py-3.5 text-left text-sm font-semibold transition-colors ' +
      SHEET_TONE[tone];

    if (a.kind === 'link') {
      return (
        <Link key={a.key} to={a.to} className={sheetBtn} onClick={close}>
          {a.label}
        </Link>
      );
    }
    return (
      <button key={a.key} type="button" className={sheetBtn} onClick={() => { a.onClick(); close(); }}>
        {a.label}
      </button>
    );
  };

  // Desktop: show up to maxInline actions inline, rest go into kebab overflow
  const desktopInline = visible.slice(0, maxInline);
  const desktopOverflow = visible.slice(maxInline);
  const needsDesktopKebab = desktopOverflow.length > 0;

  return (
    <>
      <div className="hidden items-center justify-end gap-1.5 md:flex">
        {desktopInline.map(renderDesktop)}
        {needsDesktopKebab && (
          <DesktopDropdown
            ariaLabel={ariaLabel}
            actions={desktopOverflow}
          />
        )}
      </div>
      <div className="flex justify-end md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-app-fg-muted hover:text-app-fg"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpenSource('mobile')}
        >
          <EllipsisVerticalIcon />
        </Button>
      </div>
      {/* Mobile-only: full slide-up sheet */}
      <Modal
        open={openSource === 'mobile'}
        onClose={close}
        maxWidth="max-w-full"
        aria-labelledby={titleId}
        contentClassName="p-0"
      >
        <div className="border-b border-app-border px-4 py-3">
          <h2 id={titleId} className="text-base font-semibold text-app-fg">
            {sheetTitle}
          </h2>
        </div>
        <div className="flex max-h-[min(70dvh,520px)] flex-col gap-1.5 overflow-y-auto p-3">
          {visible.map(renderSheetRow)}
        </div>
        <div className="border-t border-app-border p-3 pt-2">
          <Button type="button" variant="secondary" className="w-full" onClick={close}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Compact positioned dropdown for desktop kebab overflow actions. */
function DesktopDropdown({ ariaLabel, actions }: { ariaLabel: string; actions: TableRowSheetAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 shrink-0 p-0 text-app-fg-muted hover:text-app-fg"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <EllipsisVerticalIcon className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-app-border-strong bg-app-elevated shadow-xl dark:shadow-black/60" style={{ background: 'rgb(var(--app-elevated))' }}>
          <div className="py-1">
            {actions.map((a) => {
              if (a.kind === 'custom') {
                return <div key={a.key} className="px-2 py-1">{a.render({ close })}</div>;
              }
              const tone = a.tone ?? 'brand';
              const toneClass =
                tone === 'danger'
                  ? 'text-danger-600 dark:text-danger-400'
                  : tone === 'success'
                    ? 'text-success-600 dark:text-success-400'
                    : 'text-brand-600 dark:text-brand-400';
              const cls = `flex w-full items-center px-3 py-2 text-left text-sm font-medium hover:bg-app-hover transition-colors ${toneClass}`;
              if (a.kind === 'link') {
                return (
                  <Link key={a.key} to={a.to} className={cls} onClick={close}>
                    {a.label}
                  </Link>
                );
              }
              return (
                <button key={a.key} type="button" className={cls} onClick={() => { a.onClick(); close(); }}>
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
