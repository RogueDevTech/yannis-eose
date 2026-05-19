import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { shellPulsePlaceholderRows, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';

const STATUS_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
] as const;

const PERM_REQ_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[6rem]" /> },
  { key: 'requester', header: 'Requester', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  { key: 'target', header: 'Target', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  {
    key: 'requested',
    header: 'Requested',
    render: () => <TableCellTextPulse className="w-[12rem] max-w-[min(18rem,100%)]" />,
  },
  {
    key: 'submitted',
    header: 'Submitted',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[9rem]" />,
  },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>Open</CompactTableActionButton>,
  },
];

/** Permission requests inbox — chrome + status tabs + table pulse. */
export function PermissionRequestsLoadingShell({ activeStatus }: { activeStatus: string }) {
  const safe = STATUS_TABS.some((t) => t.value === activeStatus) ? activeStatus : 'ALL';
  const rows = shellPulsePlaceholderRows('perm_req', 8);

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Permission Requests"
        mobileInlineActions
        description="Review sensitive approval requests."
        actions={
          <>
            <PageRefreshButton className="hidden md:inline-flex" />
            <PageRefreshButton iconOnly className="md:hidden" />
          </>
        }
      />
      <Tabs value={safe} onChange={() => {}} tabs={[...STATUS_TABS]} />
      <div className="list-panel flex flex-col max-h-[min(70vh,24rem)] md:max-h-[min(60vh,22rem)] min-h-[12rem]">
        <CompactTable<{ id: string }>
          withCard={false}
          columns={PERM_REQ_SHELL_COLS}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}
