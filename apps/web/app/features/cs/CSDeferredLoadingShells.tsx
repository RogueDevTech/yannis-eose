import type { ReactNode, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import type { ListOrdersScheduleKind } from '@yannis/shared';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import {
  shellPulsePlaceholderRows,
  StatValuePulse,
  TableCellTextPulse,
} from '~/components/ui/deferred-skeletons';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
import { ScheduleHeatCalendar } from '~/components/ui/schedule-heat-calendar';
import { SearchInput } from '~/components/ui/search-input';
import { Tabs } from '~/components/ui/tabs';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import type { Order } from '~/features/orders/types';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';

const CS_ORDER_STAT_KEYS = STATUS_OPTIONS.filter((s) => s !== 'ALL');

export function csOrdersStatPulseStripItems(): { label: string; value: ReactNode }[] {
  return [
    { label: 'Total', value: <StatValuePulse className="min-w-[2.25rem]" /> },
    ...CS_ORDER_STAT_KEYS.map((status) => ({
      label: formatStatus(status),
      value: <StatValuePulse className="min-w-[2rem]" />,
    })),
  ];
}

const CS_ORDERS_SHELL_ROWS = 8;

function csOrdersShellPlaceholderRows(): Order[] {
  return Array.from({ length: CS_ORDERS_SHELL_ROWS }, (_, i) => ({
    id: `__cs_orders_shell_${i}`,
    customerName: '',
    customerPhoneDisplay: '',
    status: 'UNPROCESSED',
    totalAmount: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    assignedCsId: null,
  }));
}

const CS_ORDERS_SHELL_ROW_DATA = csOrdersShellPlaceholderRows();

function csOrdersShellTableColumns(
  showCSCloserColumn: boolean,
  showCampaignColumn: boolean,
): CompactTableColumn<Order>[] {
  const cols: CompactTableColumn<Order>[] = [
    {
      key: 'orderId',
      header: 'Order ID',
      render: () => <TableCellTextPulse className="w-[7rem]" />,
    },
    {
      key: 'customer',
      header: 'Customer',
      render: () => <TableCellTextPulse className="w-[9rem] max-w-[min(14rem,100%)]" />,
    },
  ];
  if (showCSCloserColumn) {
    cols.push({
      key: 'closer',
      header: 'Assigned closer',
      render: () => <TableCellTextPulse className="w-[8rem]" />,
    });
  }
  cols.push({
    key: 'product',
    header: 'Product',
    render: () => <TableCellTextPulse className="w-[10rem] max-w-[min(16rem,100%)]" />,
  });
  if (showCampaignColumn) {
    cols.push({
      key: 'campaign',
      header: 'Form',
      render: () => <TableCellTextPulse className="w-[8rem]" />,
    });
  }
  cols.push(
    {
      key: 'status',
      header: 'Status',
      render: () => <TableCellTextPulse className="w-[5.5rem]" />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      headerClassName: 'text-right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[4.5rem]" />
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      headerClassName: 'text-center',
      tight: true,
      mobileShowLabel: false,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  );
  return cols;
}

/**
 * Mobile loading-card skeleton — mirrors the minimal 2-row order card the live
 * Sales Orders list now renders (customer + order ID, then status + created).
 * Keep this in sync with `renderOrderMobileCard` in `OrdersListPage.tsx`.
 */
function renderCSOrdersMobileCardShell(): ReactNode {
  return (
    <div className="space-y-1.5" aria-hidden>
      <div className="flex items-center justify-between gap-2">
        <TableCellTextPulse className="w-[9rem]" />
        <TableCellTextPulse className="w-[7rem]" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <TableCellTextPulse className="w-[5.5rem]" />
        <TableCellTextPulse className="w-[8rem]" />
      </div>
    </div>
  );
}

const CST_TEAM_SHELL_ROWS = 8;

function csTeamShellTableColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'member', header: 'Member', render: () => <TableCellTextPulse className="w-[10rem]" /> },
    { key: 'workload', header: 'Workload', render: () => <TableCellTextPulse className="w-[6rem]" /> },
    {
      key: 'assigned',
      header: 'Assigned',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'delivered',
      header: 'Delivered',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'confirmed',
      header: 'Confirmed',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'confRate',
      header: 'Conf. rate',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3.5rem]" />
        </span>
      ),
    },
    {
      key: 'deliveryRate',
      header: 'Delivery rate',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3.5rem]" />
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

function renderCSTeamMobileCardShell() {
  const tileClass =
    'rounded-lg border border-app-border bg-app-hover/40 px-2.5 py-2';

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="inline-block h-10 w-10 shrink-0 animate-pulse rounded-full bg-app-border/70 dark:bg-app-border/55" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <TableCellTextPulse className="w-[8rem] max-w-[min(12rem,100%)]" />
              <div className="mt-1">
                <TableCellTextPulse className="w-[4rem]" />
              </div>
            </div>
            <span className="inline-block h-5 w-10 shrink-0 animate-pulse rounded-full bg-app-border/70 dark:bg-app-border/55" />
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <span className="inline-block h-5 w-16 animate-pulse rounded-full bg-app-border/70 dark:bg-app-border/55" />
            <span className="inline-block h-5 w-14 animate-pulse rounded-full bg-app-border/70 dark:bg-app-border/55" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className={tileClass}>
          <TableCellTextPulse className="w-[2.5rem]" />
          <div className="mt-1">
            <TableCellTextPulse className="w-[2.25rem]" />
          </div>
        </div>
        <div className={tileClass}>
          <TableCellTextPulse className="w-[2rem]" />
          <div className="mt-1">
            <TableCellTextPulse className="w-[3rem]" />
          </div>
        </div>
        <div className={tileClass}>
          <TableCellTextPulse className="w-[3rem]" />
          <div className="mt-1">
            <TableCellTextPulse className="w-[2.5rem]" />
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <TableCellTextPulse className="w-[4rem]" />
          <TableCellTextPulse className="w-[2rem]" />
        </div>
        <div className="h-1.5 w-full animate-pulse rounded-full bg-app-border/70 dark:bg-app-border/55" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={tileClass}>
            <TableCellTextPulse className="w-[2rem]" />
            <div className="mt-1">
              <TableCellTextPulse className="w-[3rem]" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className={tileClass}>
            <TableCellTextPulse className="w-[3rem]" />
            <div className="mt-1">
              <TableCellTextPulse className="w-[4rem]" />
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-app-border pt-3">
        <div className="grid grid-cols-2 gap-2">
          <CompactTableActionButton disabled className="w-full justify-center">
            View orders
          </CompactTableActionButton>
          <CompactTableActionButton disabled className="w-full justify-center">
            View profile
          </CompactTableActionButton>
        </div>
      </div>
    </div>
  );
}

function addMonthsYmCsOrders(ym: string, delta: number): string {
  const [ys, ms] = ym.split('-');
  const y = parseInt(ys ?? '0', 10);
  const mo = parseInt(ms ?? '1', 10);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export type CSOrdersLoadingShellFilters = {
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  periodAllTime: boolean;
};

export type CSOrdersLoadingShellScheduleFilters = {
  calendarMonth: string;
  scheduleKind: ListOrdersScheduleKind | null;
  scheduleDate: string | null;
};

/** Sales orders list — real URL-driven filters; pulses only for counts, workload, and table. */
export function CSOrdersLoadingShell({
  filters,
  scheduleFilters,
  statusFilter,
  searchFilter,
  isCSCloser,
  liveEvents,
  showCSCloserColumn = false,
  showCampaignColumn = false,
}: {
  filters: CSOrdersLoadingShellFilters;
  scheduleFilters: CSOrdersLoadingShellScheduleFilters;
  statusFilter?: string;
  searchFilter?: string;
  isCSCloser: boolean;
  liveEvents?: string[];
  showCSCloserColumn?: boolean;
  showCampaignColumn?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [scheduleCalendarModalOpen, setScheduleCalendarModalOpen] = useState(false);

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  const scheduleSelectValue =
    scheduleFilters.scheduleKind === 'callback_due'
      ? 'callback_due'
      : scheduleFilters.scheduleKind === 'delivery_on_day'
        ? 'delivery_on_day'
        : scheduleFilters.scheduleKind === 'callback_on_day'
          ? 'callback_on_day'
          : scheduleFilters.scheduleKind === 'delivery_overdue'
            ? 'delivery_overdue'
            : '';

  const scheduleKindFromSearch = searchParams.get('scheduleKind');
  const modalIsCallbackDayFilter =
    scheduleKindFromSearch === 'callback_on_day' || scheduleFilters.scheduleKind === 'callback_on_day';

  const applyScheduleKind = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (!v) {
        next.delete('scheduleKind');
        next.delete('scheduleDate');
      } else if (v === 'callback_due') {
        next.set('scheduleKind', 'callback_due');
        next.delete('scheduleDate');
      } else if (v === 'delivery_overdue') {
        next.set('scheduleKind', 'delivery_overdue');
        next.delete('scheduleDate');
      } else {
        next.set('scheduleKind', v);
        const existing = prev.get('scheduleDate');
        if (existing && /^\d{4}-\d{2}-\d{2}$/.test(existing)) next.set('scheduleDate', existing);
        else next.delete('scheduleDate');
      }
      return next;
    });
  };

  const statusOptions = STATUS_OPTIONS.map((status) => ({
    value: status,
    label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
  }));

  const ordersListToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (selectedStatus !== 'ALL') n += 1;
    const agent = searchParams.get('csCloserId') || 'ALL';
    if (showCSCloserColumn && agent !== 'ALL') n += 1;
    if (scheduleFilters.scheduleKind) n += 1;
    return n;
  }, [selectedStatus, showCSCloserColumn, searchParams, scheduleFilters.scheduleKind]);

  const scheduleFilterFields = (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
      <div className="flex min-w-0 flex-col gap-1 sm:flex-1">
        <FormSelect
          aria-label="Filter by schedule"
          value={scheduleSelectValue}
          placeholder="Schedule"
          onChange={(e) => {
            const v = e.target.value;
            applyScheduleKind(v);
            if ((v === 'delivery_on_day' || v === 'callback_on_day') && !scheduleFilters.scheduleDate) {
              setScheduleCalendarModalOpen(true);
            }
          }}
          options={[
            { value: '', label: 'All schedules' },
            { value: 'callback_due', label: 'Callbacks due' },
            { value: 'delivery_on_day', label: 'Deliveries (on date)' },
            { value: 'callback_on_day', label: 'Callbacks (on date)' },
            { value: 'delivery_overdue', label: 'Overdue (undelivered)' },
          ]}
          wrapperClassName="w-full min-w-0 sm:w-52"
        />
      </div>
      {(scheduleSelectValue === 'delivery_on_day' || scheduleSelectValue === 'callback_on_day') && (
        <div className="inline-flex w-full min-w-0 sm:w-auto items-stretch gap-1">
          <button
            type="button"
            onClick={() => setScheduleCalendarModalOpen(true)}
            className="inline-flex flex-1 items-center justify-between gap-2 h-9 px-3 rounded-md border border-app-border bg-app-elevated text-sm text-app-fg hover:border-brand-300 dark:hover:border-brand-700 transition-colors min-w-[10rem]"
          >
            <span className="inline-flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>
                {scheduleFilters.scheduleDate
                  ? new Date(scheduleFilters.scheduleDate).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'Pick a date…'}
              </span>
            </span>
            <svg className="w-3 h-3 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => applyScheduleKind('')}
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-app-border bg-app-elevated text-app-fg-muted hover:text-app-fg hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
            aria-label="Clear schedule filter"
            title="Clear schedule filter"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title={isCSCloser ? 'My Orders' : 'Sales Orders'}
        mobileInlineActions
        description={
          isCSCloser ? 'Your assigned orders and pipeline' : 'All customer orders for the Sales team'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Sales orders toolbar"
            mobileLeading={
              liveEvents != null && liveEvents.length > 0 ? (
                <LiveIndicator isConnected={false} showGreen={false} />
              ) : null
            }
            desktop={
              <>
                {liveEvents != null && liveEvents.length > 0 && (
                  <LiveIndicator isConnected={false} showGreen={false} />
                )}
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    startTime={filters.startTime ?? ''}
                    endTime={filters.endTime ?? ''}
                    periodAllTime={filters.periodAllTime} chrome="pill" />
              </>
            }
          />
        }
      />
      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        startTime={filters.startTime ?? ''}
        endTime={filters.endTime ?? ''}
        periodAllTime={filters.periodAllTime}
      />
      <OverviewStatStrip mobileGrid items={csOrdersStatPulseStripItems()} />

      {isCSCloser ? (
        <div className="card animate-pulse space-y-3" aria-hidden>
          <div className="h-4 w-28 rounded bg-app-hover" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-app-hover shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-40 rounded bg-app-hover" />
              <div className="h-3 w-52 rounded bg-app-hover" />
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-app-hover" />
        </div>
      ) : null}

      <div className="card p-0 overflow-hidden">
        <ToolbarFiltersCollapsible
          className="!border-0"
          badgeCount={ordersListToolbarFilterBadge}
          searchRow={
            <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:flex-nowrap md:items-center md:gap-3 md:flex-1">
              <form
                method="get"
                className="flex min-w-0 w-full flex-col gap-2 sm:flex-row sm:items-center md:flex-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearchParams((p) => {
                    const next = new URLSearchParams(p);
                    next.set('page', '1');
                    if (searchQuery.trim()) next.set('search', searchQuery.trim());
                    else next.delete('search');
                    return next;
                  });
                }}
              >
                <SearchInput
                  name="search"
                  placeholder="Search by customer name..."
                  value={searchQuery}
                  onChange={(val) => setSearchQuery(val)}
                  withSubmitButton
                  wrapperClassName="w-full md:flex-1"
                />
              </form>
              <div className="hidden shrink-0 items-center gap-3 md:flex">
                <FormSelect
                  value={selectedStatus}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedStatus(v);
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (v === 'ALL') next.delete('status');
                      else next.set('status', v);
                      return next;
                    });
                  }}
                  options={statusOptions}
                  wrapperClassName="w-full min-w-0 sm:w-48"
                />
                {showCSCloserColumn ? (
                  <div className="h-9 w-full min-w-0 sm:w-48 shrink-0 rounded-md bg-app-hover animate-pulse" aria-hidden />
                ) : null}
              </div>
            </div>
          }
          desktopInlineFilters={scheduleFilterFields}
          sheetFilterBody={
            <>
              <div className="space-y-1.5 pb-2 border-b border-app-border mb-3">{scheduleFilterFields}</div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Status</span>
                <FormSelect
                  value={selectedStatus}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedStatus(v);
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (v === 'ALL') next.delete('status');
                      else next.set('status', v);
                      return next;
                    });
                  }}
                  options={statusOptions}
                  wrapperClassName="w-full"
                />
              </div>
              {showCSCloserColumn ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Closer</span>
                  <div className="h-9 w-full rounded-md bg-app-hover animate-pulse" aria-hidden />
                </div>
              ) : null}
            </>
          }
        />
      </div>

      {scheduleCalendarModalOpen ? (
        <Modal
          open
          onClose={() => setScheduleCalendarModalOpen(false)}
          maxWidth="max-w-md"
          backdropBlur
          contentClassName="p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold text-app-fg">
                {modalIsCallbackDayFilter ? 'Pick a callback day' : 'Pick a delivery day'}
              </h3>
              <p className="text-xs text-app-fg-muted">
                {modalIsCallbackDayFilter
                  ? 'Lagos callback date matches the day you select.'
                  : 'ISO preferred delivery date matches the day you select.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScheduleCalendarModalOpen(false)}
              className="shrink-0 text-app-fg-muted hover:text-app-fg p-1"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <ScheduleHeatCalendar
            yearMonth={scheduleFilters.calendarMonth}
            heat={[]}
            selectedDate={scheduleFilters.scheduleDate}
            onSelectDay={(iso) => {
              const currentIsCallback =
                scheduleKindFromSearch === 'callback_on_day' || scheduleFilters.scheduleKind === 'callback_on_day';
              const dayKind: 'callback_on_day' | 'delivery_on_day' = currentIsCallback ? 'callback_on_day' : 'delivery_on_day';
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('page', '1');
                next.set('calendarMonth', iso.slice(0, 7));
                next.set('scheduleKind', dayKind);
                next.set('scheduleDate', iso);
                return next;
              });
              setScheduleCalendarModalOpen(false);
            }}
            onPrevMonth={() => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('page', '1');
                next.set('calendarMonth', addMonthsYmCsOrders(scheduleFilters.calendarMonth, -1));
                return next;
              });
            }}
            onNextMonth={() => {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('page', '1');
                next.set('calendarMonth', addMonthsYmCsOrders(scheduleFilters.calendarMonth, 1));
                return next;
              });
            }}
          />
        </Modal>
      ) : null}

      <CompactTable<Order>
        rows={CS_ORDERS_SHELL_ROW_DATA}
        rowKey={(o) => o.id}
        columns={csOrdersShellTableColumns(showCSCloserColumn, showCampaignColumn)}
        renderMobileCard={() => renderCSOrdersMobileCardShell()}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

const CS_TEAM_LOAD_ACTIVITY_OPTIONS = [
  { value: 'ALL', label: 'All activity' },
  { value: 'ACTIVE', label: 'Active only' },
  { value: 'IDLE', label: 'Idle only' },
];

const CS_TEAM_LOAD_BACKLOG_OPTIONS = [
  { value: 'ALL', label: 'All backlog' },
  { value: 'HAS_PENDING', label: 'Has pending' },
  { value: 'NO_PENDING', label: 'No pending' },
];

/** Sales team analysis — date + real list filters; stat strip + table pulse until bundle returns. */
export function CSTeamLoadingShell({
  dateFilters,
  q = '',
  activityFilter = 'ALL',
  backlogFilter = 'ALL',
}: {
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  q?: string;
  activityFilter?: string;
  backlogFilter?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(q);

  useEffect(() => {
    setSearchQuery(q);
  }, [q]);

  const mergeListParams = useCallback(
    (overrides: { q?: string; activity?: string; backlog?: string; page?: number }) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (overrides.q !== undefined) {
            const trimmed = overrides.q.trim();
            if (trimmed) params.set('q', trimmed);
            else params.delete('q');
          }
          if (overrides.activity !== undefined) {
            if (overrides.activity === 'ALL') params.delete('activity');
            else params.set('activity', overrides.activity);
          }
          if (overrides.backlog !== undefined) {
            if (overrides.backlog === 'ALL') params.delete('backlog');
            else params.set('backlog', overrides.backlog);
          }
          if (overrides.page !== undefined) {
            if (overrides.page <= 1) params.delete('page');
            else params.set('page', String(overrides.page));
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleSearchSubmit = (event: FormEvent) => {
    event.preventDefault();
    mergeListParams({ q: searchQuery, page: 1 });
  };

  const filtersBadgeCount = useMemo(() => {
    let count = 0;
    if (activityFilter !== 'ALL') count += 1;
    if (backlogFilter !== 'ALL') count += 1;
    return count;
  }, [activityFilter, backlogFilter]);

  const teamRows = shellPulsePlaceholderRows('cs_team', CST_TEAM_SHELL_ROWS);
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Team Analysis"
        mobileInlineActions
        description="View closer workload and performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Sales team toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime} chrome="pill" />
              </>
            }
          />
        }
      />
      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={dateFilters.periodAllTime}
      />
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Closers', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Total orders', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Confirmed', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivered', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Cancelled', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Confirm rate', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivery rate', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Calls made', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Avg call', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Pending', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 !px-0 !py-0"
          hideMobileSheet
          badgeCount={filtersBadgeCount}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                value={searchQuery}
                onChange={(value) => {
                  setSearchQuery(value);
                  if (value === '' && (searchParams.get('q') ?? '').length > 0) mergeListParams({ q: '', page: 1 });
                }}
                placeholder="Search by closer, role, or branch…"
                withSubmitButton
                wrapperClassName="min-w-0 flex-1"
                name="q"
                autoComplete="off"
              />
            </form>
          }
          desktopInlineFilters={
            <>
              <FormSelect
                value={activityFilter}
                onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                options={CS_TEAM_LOAD_ACTIVITY_OPTIONS}
                wrapperClassName="w-full min-w-0 sm:w-44"
              />
              <FormSelect
                value={backlogFilter}
                onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                options={CS_TEAM_LOAD_BACKLOG_OPTIONS}
                wrapperClassName="w-full min-w-0 sm:w-44"
              />
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Activity</span>
                <FormSelect
                  value={activityFilter}
                  onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                  options={CS_TEAM_LOAD_ACTIVITY_OPTIONS}
                  wrapperClassName="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Backlog</span>
                <FormSelect
                  value={backlogFilter}
                  onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                  options={CS_TEAM_LOAD_BACKLOG_OPTIONS}
                  wrapperClassName="w-full"
                />
              </div>
            </>
          }
        />
      </div>
      <CompactTable<{ id: string }>
        rows={teamRows}
        rowKey={(r) => r.id}
        columns={csTeamShellTableColumns()}
        renderMobileCard={() => renderCSTeamMobileCardShell()}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** CS leaderboard — date + ranked rows pulse. */
export function CSLeaderboardLoadingShell({
  filters,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Sales Leaderboard"
        mobileInlineActions
        description="Rank closer performance by delivery rate."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="CS leaderboard date range"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime} chrome="pill" />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <div className="-mx-4 bg-app-elevated border-y border-app-border overflow-hidden sm:mx-0 sm:rounded-xl sm:border sm:shadow-card">
        <div className="space-y-1.5 px-2 py-2 md:space-y-3 md:px-4 md:py-4">
          {[1, 2, 3, 4, 5].map((rank) => {
            const isTopThree = rank <= 3;
            return (
              <div
                key={rank}
                className={`rounded-lg border border-app-border bg-app-elevated p-3 md:p-4 ${isTopThree ? 'bg-app-hover' : ''}`}
              >
                <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-sm font-medium text-app-fg-muted">
                      #{rank}
                    </span>
                    {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                    <div className="min-w-0 flex-1">
                      <TableCellTextPulse className="w-[8rem] max-w-[min(14rem,100%)]" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-10 md:block md:pl-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-app-hover px-2.5 py-1 text-xs font-bold text-app-fg md:px-3 md:py-1.5 md:text-sm">
                      <TableCellTextPulse className="w-[2.5rem]" />
                      <span>% del.</span>
                    </span>
                    <svg
                      className="h-4 w-4 shrink-0 text-app-fg-muted md:hidden"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="mt-2.5 hidden border-t border-app-border pt-2.5 text-sm md:flex md:flex-wrap md:items-center md:gap-x-4 md:gap-y-1">
                    <span className="text-app-fg-muted">
                      Engaged <TableCellTextPulse className="w-[1.5rem] align-middle" />
                    </span>
                    <span className="text-success-600 dark:text-success-400">
                      Confirmed <TableCellTextPulse className="w-[1.5rem] align-middle" />
                    </span>
                    <span className="text-brand-600 dark:text-brand-400 font-medium">
                      Delivered <TableCellTextPulse className="w-[1.5rem] align-middle" />
                    </span>
                    <span className="text-app-fg-muted">
                      Calls <TableCellTextPulse className="w-[1.5rem] align-middle" />
                    </span>
                    <span className="text-app-fg-muted">
                      Conf. <TableCellTextPulse className="w-[2.5rem] align-middle" />
                    </span>
                    <span className="text-app-fg-muted">
                      Avg call <TableCellTextPulse className="w-[2rem] align-middle" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const MSG_TEMPLATE_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'name', header: 'Name', render: () => <TableCellTextPulse className="w-[12rem]" /> },
  { key: 'channel', header: 'Channel', render: () => <TableCellTextPulse className="w-[5rem]" /> },
  {
    key: 'preview',
    header: 'Preview',
    render: () => <TableCellTextPulse className="w-[14rem] max-w-[min(20rem,100%)]" />,
  },
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    tight: true,
    render: () => (
      <span className="inline-flex gap-1">
        <CompactTableActionButton disabled>View</CompactTableActionButton>
        <CompactTableActionButton disabled>Edit</CompactTableActionButton>
      </span>
    ),
  },
];

/** Message templates — header + channel tabs + table pulse. */
export function CSMessageTemplatesLoadingShell() {
  const rows = shellPulsePlaceholderRows('msg_tpl', 6);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Message Templates"
        mobileInlineActions
        description="Manage SMS and WhatsApp templates."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Message template toolbar"
            desktop={
              <>
                <Button type="button" variant="secondary" size="sm" disabled>
                  Preview all
                </Button>
                <Button type="button" variant="primary" size="sm" disabled>
                  + New Template
                </Button>
                <PageRefreshButton />
              </>
            }
            sheet={
              <>
                <Button type="button" variant="secondary" size="sm" className="h-12 w-full justify-center" disabled>
                  Preview all
                </Button>
                <Button type="button" variant="primary" size="sm" className="h-12 w-full justify-center" disabled>
                  + New Template
                </Button>
              </>
            }
          />
        }
      />
      <Tabs
        value="ALL"
        onChange={() => {}}
        tabs={[
          { value: 'ALL', label: 'All' },
          { value: 'SMS', label: 'SMS' },
          { value: 'WHATSAPP', label: 'WhatsApp' },
        ]}
      />
      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-32 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-14 rounded-full bg-app-hover animate-pulse" />
            </div>
            <div className="h-3 w-48 rounded bg-app-hover animate-pulse" />
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <CompactTable<{ id: string }>
          rows={rows}
          rowKey={(r) => r.id}
          columns={MSG_TEMPLATE_SHELL_COLS}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}
