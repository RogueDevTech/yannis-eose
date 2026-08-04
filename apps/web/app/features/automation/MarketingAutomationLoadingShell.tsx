import { PageHeader } from '~/components/ui/page-header';
import { CompactTable } from '~/components/ui/compact-table';
import {
  shellPulseCompactTableColumns,
  shellPulsePlaceholderRows,
} from '~/components/ui/deferred-skeletons';

/** Loading shell for /admin/marketing/automation. Mirrors the loaded header + table. */
export function MarketingAutomationLoadingShell() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Marketing Automation"
        description="Send email, SMS, and WhatsApp to customers on rules you configure."
      />
      <div className="list-panel">
        <CompactTable
          withCard={false}
          columns={shellPulseCompactTableColumns([
            { key: 'name', header: 'Automation' },
            { key: 'kind', header: 'Type' },
            { key: 'channel', header: 'Channel' },
            { key: 'timing', header: 'Timing' },
            { key: 'status', header: 'Status', align: 'right' },
          ])}
          rows={shellPulsePlaceholderRows('automation', 4)}
          rowKey={(r) => r.id}
        />
      </div>
    </div>
  );
}
