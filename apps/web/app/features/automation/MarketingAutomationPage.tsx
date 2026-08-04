import { useCallback, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { DateTimeText } from '~/components/ui/date-time-text';
import type { AutomationChannel, AutomationRuleRow } from './types';

const ALL_CHANNELS: { value: AutomationChannel; label: string }[] = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
];

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

export function MarketingAutomationPage({
  rules,
  configuredChannels,
}: {
  rules: AutomationRuleRow[];
  configuredChannels: AutomationChannel[];
}) {
  const fetcher = useFetcher();
  const surface = useFetcherActionSurface(fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [kind, setKind] = useState<'EVENT' | 'SEGMENT'>('EVENT');

  useFetcherToast(fetcher.data, {
    successMessage: 'Automation created',
    skipErrorToast: Boolean(showCreate && surface.errorMatchingIntent('createRule')),
  });

  const handleSuccess = useCallback(() => {
    setShowCreate(false);
    setKind('EVENT');
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const channelOptions = ALL_CHANNELS.map((c) => ({
    ...c,
    // Disable channels with no configured provider so a rule can't be created that never sends.
    label: configuredChannels.includes(c.value) ? c.label : `${c.label} (not configured)`,
    disabled: !configuredChannels.includes(c.value),
  }));
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
      key: 'channel',
      header: 'Channel',
      render: (r) => <StatusBadge status={r.channel} />,
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
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
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
                <StatusBadge status={r.channel} />
              </div>
              <p className="text-xs text-app-fg-muted">{timingLabel(r)}</p>
            </div>
          )}
        />
      </div>

      {showCreate && (
        <Modal
          open
          onClose={() => {
            if (fetcher.state !== 'idle') return;
            setShowCreate(false);
          }}
          maxWidth="max-w-lg"
          backdropBlur
          contentClassName="p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-app-fg">New automation</h3>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              disabled={fetcher.state !== 'idle'}
              className="text-app-fg-muted hover:text-app-fg p-1 shrink-0 disabled:opacity-50"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <ModalFetcherInlineError message={surface.errorMatchingIntent('createRule')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="createRule" />
            <TextInput label="Name" name="name" type="text" required minLength={2} placeholder="e.g. Post-order thank you" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormSelect
                label="Type"
                name="kind"
                required
                value={kind}
                onChange={(e) => setKind(e.target.value as 'EVENT' | 'SEGMENT')}
                options={[
                  { value: 'EVENT', label: 'Event journey (per customer)' },
                  { value: 'SEGMENT', label: 'Segment broadcast (audience)' },
                ]}
              />
              <FormSelect
                label="Channel"
                name="channel"
                required
                placeholder="Select channel..."
                options={channelOptions}
              />
            </div>

            {kind === 'EVENT' ? (
              <div>
                <label htmlFor="automation-delay" className="block text-sm font-medium text-app-fg-muted mb-1">
                  Delay before sending (minutes)
                </label>
                <input
                  id="automation-delay"
                  type="number"
                  name="delayMinutes"
                  min={0}
                  className="input"
                  placeholder="e.g. 120 for 2 hours. Leave blank to send immediately."
                />
                <p className="mt-1 text-xs text-app-fg-muted">Counts from when the trigger event fires for a customer.</p>
              </div>
            ) : (
              <div>
                <label htmlFor="automation-cron" className="block text-sm font-medium text-app-fg-muted mb-1">
                  Schedule (cron)
                </label>
                <input
                  id="automation-cron"
                  type="text"
                  name="scheduleCron"
                  className="input"
                  placeholder="e.g. 0 9 * * 1 for every Monday 9am. Leave blank for manual only."
                />
                <p className="mt-1 text-xs text-app-fg-muted">When the broadcast evaluates the audience and sends.</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="automation-priority" className="block text-sm font-medium text-app-fg-muted mb-1">
                  Priority
                </label>
                <input id="automation-priority" type="number" name="priority" min={0} defaultValue={0} className="input" />
                <p className="mt-1 text-xs text-app-fg-muted">Higher runs first when rules overlap.</p>
              </div>
              <div className="flex flex-col gap-2 justify-end pb-1">
                <label className="inline-flex items-center gap-2 text-sm text-app-fg">
                  <input type="checkbox" name="respectOptOut" defaultChecked className="h-4 w-4 rounded border-gray-300" />
                  Honor opt-out list
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-app-fg">
                  <input type="checkbox" name="enabled" defaultChecked className="h-4 w-4 rounded border-gray-300" />
                  Enabled
                </label>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={fetcher.state === 'submitting'}
                loadingText="Creating..."
                disabled={noChannelsReady}
              >
                Create automation
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={fetcher.state !== 'idle'} onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {rules.length === 0 && noChannelsReady && (
        <EmptyState title="Nothing to show yet" description="Configure a channel, then create your first automation." />
      )}
    </div>
  );
}
