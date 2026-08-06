import { useState } from 'react';
import { useNavigate, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { CompactTableActionButton } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { DateTimeText } from '~/components/ui/date-time-text';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
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
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const noChannelsReady = configuredChannels.length === 0;
  const busy = fetcher.state !== 'idle';

  const [deleteTarget, setDeleteTarget] = useState<AutomationRuleRow | null>(null);
  const [testTarget, setTestTarget] = useState<AutomationRuleRow | null>(null);
  const [testChannel, setTestChannel] = useState<AutomationChannel>('EMAIL');
  const [testTo, setTestTo] = useState('');

  useFetcherToast(fetcher.data, { successMessage: 'Done' });
  useCloseOnFetcherSuccess(fetcher, () => {
    setDeleteTarget(null);
    setTestTarget(null);
  });

  const submit = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fetcher.submit(fd, { method: 'post' });
  };

  const openTest = (r: AutomationRuleRow) => {
    setTestChannel(r.channels[0] ?? 'EMAIL');
    setTestTo('');
    setTestTarget(r);
  };

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
      render: (r) => <StatusBadge status={r.enabled ? 'ENABLED' : 'DISABLED'} />,
    },
    {
      key: 'created',
      header: 'Created',
      render: (r) => <DateTimeText at={r.createdAt} className="text-sm" />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      hideable: false,
      render: (r) => (
        <div data-no-row-click className="flex items-center justify-end gap-1">
          <CompactTableActionButton
            onClick={() => submit({ intent: 'toggle', ruleId: r.id, enabled: String(!r.enabled) })}
          >
            {r.enabled ? 'Disable' : 'Enable'}
          </CompactTableActionButton>
          <CompactTableActionButton onClick={() => openTest(r)}>Test</CompactTableActionButton>
          {r.kind === 'SEGMENT' ? (
            <CompactTableActionButton onClick={() => submit({ intent: 'runNow', ruleId: r.id })}>
              Run now
            </CompactTableActionButton>
          ) : null}
          <CompactTableActionButton tone="danger" onClick={() => setDeleteTarget(r)}>
            Delete
          </CompactTableActionButton>
        </div>
      ),
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
          No sending channel is configured yet. Email turns on with SendGrid credentials, SMS with Africa&apos;s
          Talking keys, and WhatsApp with Termii keys. You can still plan automations, but a rule can only be
          created on a channel that can actually send.
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
              <TableRowActionsSheet
                ariaLabel={`Actions for ${r.name}`}
                sheetTitle={r.name}
                actions={[
                  {
                    key: 'toggle',
                    kind: 'button' as const,
                    label: r.enabled ? 'Disable' : 'Enable',
                    onClick: () => submit({ intent: 'toggle', ruleId: r.id, enabled: String(!r.enabled) }),
                  },
                  { key: 'test', kind: 'button' as const, label: 'Send test', onClick: () => openTest(r) },
                  ...(r.kind === 'SEGMENT'
                    ? [
                        {
                          key: 'run',
                          kind: 'button' as const,
                          label: 'Run now',
                          onClick: () => submit({ intent: 'runNow', ruleId: r.id }),
                        },
                      ]
                    : []),
                  {
                    key: 'delete',
                    kind: 'button' as const,
                    label: 'Delete',
                    tone: 'danger' as const,
                    onClick: () => setDeleteTarget(r),
                  },
                ]}
              />
            </div>
          )}
        />
      </div>

      <ConfirmActionModal
        open={!!deleteTarget}
        onClose={() => (busy ? undefined : setDeleteTarget(null))}
        title="Delete automation"
        description={`Delete "${deleteTarget?.name ?? ''}"? Pending sends for this rule are cancelled. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={busy}
        error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
        onConfirm={() => deleteTarget && submit({ intent: 'remove', ruleId: deleteTarget.id })}
      />

      <Modal open={!!testTarget} onClose={() => (busy ? undefined : setTestTarget(null))} maxWidth="max-w-md" contentClassName="p-5">
        <div className="space-y-3">
          <h3 className="text-base font-semibold text-app-fg">Send a test message</h3>
          <p className="text-xs text-app-fg-muted">
            Sends one message now using this rule&apos;s template, bypassing the audience. Uses live credentials.
          </p>
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg-muted">Channel</label>
            <FormSelect
              value={testChannel}
              onChange={(e) => setTestChannel(e.target.value as AutomationChannel)}
              options={(testTarget?.channels ?? []).map((c) => ({ value: c, label: CHANNEL_META[c]?.label ?? c }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-app-fg-muted">
              {testChannel === 'EMAIL' ? 'Email address' : 'Phone (E.164, e.g. +2348…)'}
            </label>
            <TextInput
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder={testChannel === 'EMAIL' ? 'you@example.com' : '+2348012345678'}
            />
          </div>
          {(fetcher.data as { error?: string } | undefined)?.error ? (
            <p className="text-sm text-danger-600 dark:text-danger-400">
              {(fetcher.data as { error?: string }).error}
            </p>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={busy}
              loadingText="Sending…"
              disabled={!testTo.trim()}
              onClick={() =>
                testTarget && submit({ intent: 'testSend', ruleId: testTarget.id, channel: testChannel, to: testTo.trim() })
              }
            >
              Send test
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setTestTarget(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
