import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { shellPulsePlaceholderRows, StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { Tabs } from '~/components/ui/tabs';

const BRANCH_LIST_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'name', header: 'Name', render: () => <TableCellTextPulse className="w-[14rem]" /> },
  { key: 'code', header: 'Code', render: () => <TableCellTextPulse className="w-[6rem]" /> },
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
  {
    key: 'created',
    header: 'Created',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[9rem]" />,
  },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
  },
];

/** `/admin/branches` — list shell. */
export function BranchesListLoadingShell() {
  const rows = shellPulsePlaceholderRows('branches', 8);
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Branch Management"
        description="Manage company branches and tenant separation. Each branch has its own data scope."
        actions={
          <Button variant="primary" size="sm" disabled className="opacity-60">
            + New Branch
          </Button>
        }
      />
      <CompactTable<{ id: string }>
        columns={BRANCH_LIST_COLS}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** `/admin/branches/:id` — detail shell (branch name unknown until load). */
export function BranchDetailLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div>
        <div className="h-4 w-28 rounded bg-app-hover animate-pulse mb-4" aria-hidden />
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-app-hover animate-pulse shrink-0" aria-hidden />
            <div className="space-y-2">
              <div className="h-7 w-48 rounded bg-app-hover animate-pulse" aria-hidden />
              <div className="h-4 w-64 rounded bg-app-hover animate-pulse" aria-hidden />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-16 rounded-full bg-app-hover animate-pulse" aria-hidden />
            <div className="h-8 w-14 rounded-md bg-app-hover animate-pulse" aria-hidden />
          </div>
        </div>
      </div>

      <OverviewStatStrip
        items={[
          { label: 'Total orders', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Active', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivered', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivery rate', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Campaigns', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />

      <Tabs
        value="overview"
        onChange={() => {}}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'team', label: 'Branch members' },
          { value: 'squads', label: 'Supervisor teams' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card p-4 space-y-3">
            <div className="h-3 w-24 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="space-y-2">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-3 w-full rounded bg-app-hover animate-pulse" aria-hidden />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
