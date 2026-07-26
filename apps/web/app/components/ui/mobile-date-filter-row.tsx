import { useEffect, useState, type ReactNode } from 'react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import {
  hasMobileActionsOpener,
  MOBILE_ACTIONS_CHANGED_EVENT,
  openMobileActionsSheet,
} from '~/lib/mobile-actions-bridge';

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
 *
 * Actions button sources (either works):
 * 1. Explicit `actionsSheet` content (self-contained modal in this row)
 * 2. `PageHeaderMobileTools` on the page (opens via mobile-actions bridge)
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
  const [hasHeaderToolsActions, setHasHeaderToolsActions] = useState(() =>
    typeof window !== 'undefined' ? hasMobileActionsOpener() : false,
  );

  useEffect(() => {
    if (actionsSheet) {
      setHasHeaderToolsActions(false);
      return;
    }
    const sync = () => setHasHeaderToolsActions(hasMobileActionsOpener());
    sync();
    window.addEventListener(MOBILE_ACTIONS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(MOBILE_ACTIONS_CHANGED_EVENT, sync);
  }, [actionsSheet]);

  const showActionsButton = !!actionsSheet || hasHeaderToolsActions;

  function openActions() {
    if (actionsSheet) {
      setActionsOpen(true);
      return;
    }
    openMobileActionsSheet();
  }

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
      {showActionsButton && (
        <>
          <button
            type="button"
            onClick={openActions}
            className="btn-secondary btn-sm inline-flex items-center gap-1.5"
          >
            <KebabVerticalIcon />
            Actions
          </button>
          {actionsSheet ? (
            <Modal
              open={actionsOpen}
              onClose={() => setActionsOpen(false)}
              maxWidth="max-w-full"
              contentClassName="p-0"
            >
              <div className="border-b border-app-border px-4 py-3">
                <h2 className="text-base font-semibold text-app-fg">{actionsSheetTitle}</h2>
              </div>
              <div
                className={[
                  'flex flex-col gap-2.5 overflow-y-auto p-4 max-h-[min(75dvh,560px)]',
                  '[&_button]:w-full [&_button]:justify-center [&_button]:text-sm [&_button]:font-medium [&_button]:min-h-[2.75rem]',
                  '[&_a.btn-primary]:w-full [&_a.btn-primary]:justify-center [&_a.btn-primary]:text-sm [&_a.btn-primary]:font-medium [&_a.btn-primary]:min-h-[2.75rem]',
                  '[&_a.btn-secondary]:w-full [&_a.btn-secondary]:justify-center [&_a.btn-secondary]:text-sm [&_a.btn-secondary]:font-medium [&_a.btn-secondary]:min-h-[2.75rem]',
                ].join(' ')}
              >
                {actionsSheet}
              </div>
              <div className="border-t border-app-border p-3 pt-2">
                <Button type="button" variant="primary" className="w-full" onClick={() => setActionsOpen(false)}>
                  Done
                </Button>
              </div>
            </Modal>
          ) : null}
        </>
      )}
    </div>
  );
}
