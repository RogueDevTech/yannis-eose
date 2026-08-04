import { useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { DateTimeText } from '~/components/ui/date-time-text';
import type { AutomationChannel, AutomationRuleRow } from './types';
import { CHANNEL_META } from './channel-meta';

/** Human timing summary for a rule row. */
function timingLabel(rule: AutomationRuleRow): string {
  if (rule.kind === 'EVENT') {
    if (rule.delayMinutes == null || rule.delayMinutes === 0) return 'Immediately';
    const m = rule.delayMinutes;
    if (m % (60 * 24) === 0) return `After ${m / (60 * 24)}d`;
    if (m % 60 === 0) return `After ${m / 60}h`;
    return `After ${m}m`;
  }
  return rule.scheduleCron ? `Schedule: ${rule.scheduleCron}` : 'Manual only';
}

/** Row of small channel icons for a rule's channels. */
function ChannelIcons({ channels }: { channels: AutomationChannel[] }) {
  if (!channels?.length) return <span className="text-app-fg-muted text-sm">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      {channels.map((c) => {
        const meta = CHANNEL_META[c];
        if (!meta) return null;
        const Icon = meta.icon;
        return (
          <span key={c} className="inline-flex items-center gap-1 text-app-fg-muted" title={meta.label}>
            <Icon className="h-4 w-4" />
            <span className="text-xs">{meta.label}</span>
          </span>
        );
      })}
    </span>
  );
}

export function MarketingAutomationPage({
  rules,
  configuredChannels,
}: {
  rules: AutomationRuleRow[];
  configuredChannels: AutomationChannel[];
}) {
  const navigate = useNavigate();
  const noChannelsReady = configuredChannels.length === 0;

  const columns: CompactTableColumn<AutomationRuleRow>[] = [
    {
      key: 'name',
      header: 'Automation',
      render: (r) => <span className="text-sm font-medium text-app-fg">{r.name}</span>,
    },
    {
      key: 'kind',
      header: 'Type',
      render: (r) => <StatusBadge status={r.kind === 'EVENT' ? 'Event journey' : 'Segment broadcast'} />,
    },
    {
      key: 'channels',
      header: 'Channels',
      render: (r) => <ChannelIcons channels={r.channels} />,
    },
    {
      key: 'timing',
      header: 'Timing',
      render: (r) => <span className="text-sm text-app-fg-muted">{timingLabel(r)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (r) => <StatusBadge status={r.enabled ? 'ENABLED' : 'DISABLED'} />,
    },
    {
      key: 'created',
      header: 'Created',
      render: (r) => <DateTimeText at={r.createdAt} className="text-sm" />,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Marketing Automation"
        mobileInlineActions
        description="Send email, SMS, and WhatsApp to customers on rules you configure."
        actions={
          <Button variant="primary" size="sm" onClick={() => navigate('/admin/marketing/automation/new')}>
            New automation
          </Button>
        }
      />

      {noChannelsReady && (
        <div className="list-panel p-4 text-sm text-app-fg-muted">
          No sending channel is configured yet. Email turns on once SendGrid credentials are set; SMS and
          WhatsApp arrive in a later phase. You can still plan automations, but they can only be created on a
          channel that can actually send.
        </div>
      )}

      <div className="list-panel">
        <CompactTable
          withCard={false}
          columns={columns}
          rows={rules}
          rowKey={(r) => r.id}
          emptyTitle="No automations yet"
          emptyDescription="Create one to start messaging customers automatically."
          renderMobileCard={(r) => (
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-app-fg text-sm">{r.name}</span>
                <StatusBadge status={r.enabled ? 'ENABLED' : 'DISABLED'} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={r.kind === 'EVENT' ? 'Event journey' : 'Segment broadcast'} />
                <ChannelIcons channels={r.channels} />
              </div>
              <p className="text-xs text-app-fg-muted">{timingLabel(r)}</p>
            </div>
          )}
        />
      </div>
    </div>
  );
}
