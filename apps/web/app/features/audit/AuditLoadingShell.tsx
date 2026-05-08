import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { shellPulsePlaceholderRows, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';

const AUDIT_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  {
    key: 'timestamp',
    header: 'Timestamp',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[9rem]" />,
  },
  {
    key: 'description',
    header: 'Description',
    render: () => <TableCellTextPulse className="w-[18rem] max-w-[min(28rem,55vw)]" />,
  },
  { key: 'actor', header: 'Actor', nowrap: true, render: () => <TableCellTextPulse className="w-[8rem]" /> },
  {
    key: 'details',
    header: 'Details',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
  },
];

/** Global audit log — filters + table pulse. */
export function AuditLoadingShell({
  filters,
}: {
  filters: { tableName: string; actorId: string; startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const rows = shellPulsePlaceholderRows('audit', 8);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Audit trail"
        description="Immutable record of changes across the platform."
        actions={<PageRefreshButton />}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
          <DateFilterBar
            startDate={filters.startDate}
            endDate={filters.endDate}
            periodAllTime={filters.periodAllTime}
          />
        </div>
        <div className="h-10 w-40 rounded-md bg-app-hover animate-pulse" aria-hidden />
        <div className="h-10 w-40 rounded-md bg-app-hover animate-pulse" aria-hidden />
      </div>
      <CompactTable<{ id: string }>
        columns={AUDIT_SHELL_COLS}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}
