import { DateFilterBar } from '~/components/ui/date-filter-bar';

export interface MobileDateFilterRowProps {
  startDate?: string;
  endDate?: string;
  /** Optional `HH:MM` time refinement — forwarded to `DateFilterBar`. */
  startTime?: string;
  endTime?: string;
  periodAllTime?: boolean;
}

/**
 * Mobile-only date filter row.
 *
 * Renders a full-width `DateFilterBar` in pill chrome directly under the
 * `PageHeader` so the date filter is visible on small screens without opening
 * the `PageHeaderMobileTools` kebab sheet (CEO directive 2026-05-21: the grouped
 * icon hid the date filter). Hidden at `md+` — desktop keeps the date filter
 * inline in the `PageHeader` actions row.
 *
 * Placement: render immediately after `<PageHeader />`, before overview stats,
 * tabs, or filter pills.
 */
export function MobileDateFilterRow({
  startDate,
  endDate,
  startTime,
  endTime,
  periodAllTime,
}: MobileDateFilterRowProps) {
  return (
    <div className="md:hidden">
      <DateFilterBar
        startDate={startDate}
        endDate={endDate}
        startTime={startTime}
        endTime={endTime}
        periodAllTime={periodAllTime}
        triggerLayout="blockCenter"
        chrome="pill"
      />
    </div>
  );
}
