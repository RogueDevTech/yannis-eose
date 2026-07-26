import { useState, type ReactNode } from 'react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';

function KebabVerticalIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  );
}

function SearchIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
    </svg>
  );
}

export interface MobileDateFilterRowProps {
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  periodAllTime?: boolean;
  hideDate?: boolean;
  hideRefresh?: boolean;
  /** Content for the Actions sheet modal. When provided, an "Actions" button renders. */
  actionsSheet?: ReactNode;
  /** Title for the Actions sheet. */
  actionsSheetTitle?: string;
  /** Show the Search button (opens PageSearchControl modal via window function). */
  showSearch?: boolean;
  /** Extra controls to render in the toolbar row. */
  extra?: ReactNode;
}

/**
 * Mobile toolbar row — renders labeled action buttons below the page header.
 * Hidden on `md+`.
 */
export function MobileDateFilterRow({
  startDate,
  endDate,
  startTime,
  endTime,
  periodAllTime,
  hideDate = false,
  hideRefresh = false,
  actionsSheet,
  actionsSheetTitle = 'Actions',
  showSearch = false,
  extra,
}: MobileDateFilterRowProps) {
  const [actionsOpen, setActionsOpen] = useState(false);

  return (
    <div className="md:hidden flex items-center gap-2 flex-wrap">
      {!hideDate && (
        <DateFilterBar
          startDate={startDate}
          endDate={endDate}
          startTime={startTime}
          endTime={endTime}
          periodAllTime={periodAllTime}
          chrome="pill"
        />
      )}
      {!hideRefresh && <PageRefreshButton />}
      {extra}
      {showSearch && (
        <button
          type="button"
          onClick={() => (window as any).__openMobileSearchSheet?.()}
          className="btn-secondary btn-sm inline-flex items-center gap-1.5"
        >
          <SearchIcon />
          Search
        </button>
      )}
      {actionsSheet && (
        <>
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <KebabVerticalIcon />
            Actions
          </button>
          <Modal
            open={actionsOpen}
            onClose={() => setActionsOpen(false)}
            maxWidth="max-w-full"
            contentClassName="p-0"
          >
            <div className="border-b border-app-border px-4 py-3">
              <h2 className="text-base font-semibold text-app-fg">{actionsSheetTitle}</h2>
            </div>
            <div className="flex flex-col gap-2.5 overflow-y-auto p-4 max-h-[min(75dvh,560px)]">
              {actionsSheet}
            </div>
            <div className="border-t border-app-border p-3 pt-2">
              <Button type="button" variant="primary" className="w-full" onClick={() => setActionsOpen(false)}>
                Done
              </Button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
