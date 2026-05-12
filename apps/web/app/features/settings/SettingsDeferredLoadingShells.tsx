import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { shellPulsePlaceholderRows, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Tabs } from '~/components/ui/tabs';

const ROLE_TEMPLATES_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'name', header: 'Name', render: () => <TableCellTextPulse className="w-[12rem]" /> },
  { key: 'key', header: 'Key', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  { key: 'kind', header: 'Kind', render: () => <TableCellTextPulse className="w-[6rem]" /> },
  { key: 'mappedRole', header: 'Mapped role', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>Edit</CompactTableActionButton>,
  },
];

/** Settings → Role templates — header, tabs row pulse, table skeleton. */
export function RoleTemplatesLoadingShell() {
  const rows = shellPulsePlaceholderRows('role_tpl', 8);
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Role templates"
        description="Create and manage permission presets for staff roles."
        actions={
          <>
            <PageRefreshButton />
            <Button type="button" variant="primary" disabled className="opacity-60">
              New template
            </Button>
          </>
        }
      />
      <Tabs
        value="templates"
        onChange={() => {}}
        tabs={[
          { value: 'templates', label: 'Templates' },
          { value: 'catalog', label: 'Permission catalog' },
        ]}
      />
      <CompactTable<{ id: string }>
        columns={ROLE_TEMPLATES_SHELL_COLS}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}
