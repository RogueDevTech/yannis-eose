import { useId, useState, type ReactNode } from 'react';
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
}

/**
 * Row-level actions: **desktop** shows inline links/buttons (same as {@link CompactTableActionButton});
 * **mobile** (`< md`) collapses into one control that opens the shared {@link Modal} slide-up with full-width actions.
 *
 * Use on funding/finance dense tables first; other modules can adopt the same pattern.
 */
export function TableRowActionsSheet({ ariaLabel, sheetTitle = 'Actions', actions }: TableRowActionsSheetProps) {
  const visible = actions.filter((a) => a.show !== false);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const close = () => setOpen(false);

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

  return (
    <>
      <div className="hidden items-center justify-end gap-1.5 md:flex">{visible.map(renderDesktop)}</div>
      <div className="flex justify-end md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 text-app-fg-muted hover:text-app-fg"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <EllipsisVerticalIcon />
        </Button>
        <Modal
          open={open}
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
          <div className="flex max-h-[min(70dvh,520px)] flex-col gap-1.5 overflow-y-auto p-3">{visible.map(renderSheetRow)}</div>
          <div className="border-t border-app-border p-3 pt-2">
            <Button type="button" variant="secondary" className="w-full" onClick={close}>
              Cancel
            </Button>
          </div>
        </Modal>
      </div>
    </>
  );
}
