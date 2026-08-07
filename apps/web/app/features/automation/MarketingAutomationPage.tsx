import { useRef, useState } from 'react';
import { useNavigate, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
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
import { Tabs } from '~/components/ui/tabs';
import type { AutomationChannel, AutomationRuleRow, AutomationTemplateRow, TargetGroupRow } from './types';
import { CHANNEL_META, ALL_CHANNELS } from './channel-meta';
import { TargetGroupsPanel, TargetGroupModal, newGroupDraft, type GroupDraft } from './TargetGroupsPanel';
import { AUTOMATION_TEMPLATE_VARIABLES } from './targeting-meta';

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

type Tab = 'rules' | 'templates' | 'groups';
/** A template being edited in the modal, or the sentinel for "new". */
type TemplateDraft = { id: string | null; name: string; channels: AutomationChannel[]; subject: string; body: string };

export function MarketingAutomationPage({
  rules,
  configuredChannels,
  templates,
  targetGroups,
}: {
  rules: AutomationRuleRow[];
  configuredChannels: AutomationChannel[];
  templates: AutomationTemplateRow[];
  targetGroups: TargetGroupRow[];
}) {
  const navigate = useNavigate();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const noChannelsReady = configuredChannels.length === 0;
  const busy = fetcher.state !== 'idle';

  const [tab, setTab] = useState<Tab>('rules');
  const [deleteTarget, setDeleteTarget] = useState<AutomationRuleRow | null>(null);
  const [testTarget, setTestTarget] = useState<AutomationRuleRow | null>(null);
  const [testChannel, setTestChannel] = useState<AutomationChannel>('EMAIL');
  const [testTo, setTestTo] = useState('');
  const [tplDraft, setTplDraft] = useState<TemplateDraft | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<AutomationTemplateRow | null>(null);
  const [toggleTarget, setToggleTarget] = useState<AutomationRuleRow | null>(null);
  const [runTarget, setRunTarget] = useState<AutomationRuleRow | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [groupArchiveTarget, setGroupArchiveTarget] = useState<TargetGroupRow | null>(null);

  useFetcherToast(fetcher.data, { successMessage: 'Done' });
  useCloseOnFetcherSuccess(fetcher, () => {
    setDeleteTarget(null);
    setTestTarget(null);
    setTplDraft(null);
    setArchiveTarget(null);
    setToggleTarget(null);
    setRunTarget(null);
    setGroupDraft(null);
    setGroupArchiveTarget(null);
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
          <CompactTableActionButton onClick={() => setToggleTarget(r)}>
            {r.enabled ? 'Disable' : 'Enable'}
          </CompactTableActionButton>
          <CompactTableActionButton onClick={() => openTest(r)}>Test</CompactTableActionButton>
          {r.kind === 'SEGMENT' ? (
            <CompactTableActionButton onClick={() => setRunTarget(r)}>
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
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Marketing automation actions"
            desktopActions
            desktopActionsLabel="Actions"
            desktop={null}
            sheet={({ closeSheet }) =>
              tab === 'rules' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-12 w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    navigate('/admin/marketing/automation/new');
                  }}
                >
                  New automation
                </Button>
              ) : tab === 'templates' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-12 w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setTplDraft({ id: null, name: '', channels: ['EMAIL'], subject: '', body: '' });
                  }}
                >
                  New template
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-12 w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setGroupDraft(newGroupDraft());
                  }}
                >
                  New target group
                </Button>
              )
            }
          />
        }
      />

      <Tabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        tabs={[
          { value: 'rules', label: 'Automations' },
          { value: 'templates', label: 'Message templates' },
          { value: 'groups', label: 'Target groups' },
        ]}
      />

      {tab === 'rules' && noChannelsReady && (
        <div className="list-panel p-4 text-sm text-app-fg-muted">
          No sending channel is configured yet. Email turns on with SendGrid credentials, SMS with Africa&apos;s
          Talking keys, and WhatsApp with Termii keys. You can still plan automations, but a rule can only be
          created on a channel that can actually send.
        </div>
      )}

      {tab === 'templates' && (
        <TemplatesPanel
          templates={templates}
          onNew={() => setTplDraft({ id: null, name: '', channels: ['EMAIL'], subject: '', body: '' })}
          onEdit={(t) =>
            setTplDraft({ id: t.id, name: t.name, channels: t.channels, subject: t.subject ?? '', body: t.body })
          }
          onArchive={(t) => setArchiveTarget(t)}
        />
      )}

      {tab === 'groups' && (
        <TargetGroupsPanel
          groups={targetGroups}
          busy={busy}
          onNew={() => setGroupDraft(newGroupDraft())}
          onEdit={(g) =>
            setGroupDraft({
              id: g.id,
              name: g.name,
              description: g.description ?? '',
              filter: g.filter ?? {},
              enabled: g.enabled,
            })
          }
          onSync={(g) => submit({ intent: 'syncGroup', groupId: g.id })}
          onArchive={(g) => setGroupArchiveTarget(g)}
        />
      )}

      {tab === 'rules' && (
      <div className="list-panel">
        <CompactTable
          withCard={false}
          columns={columns}
          rows={rules}
          rowKey={(r) => r.id}
          emptyTitle="No automations yet"
          emptyDescription="Create one to start messaging customers automatically."
          renderMobileCard={(r) => (
            <div className="p-3.5">
              {/* Top row: name (primary) + status pill + kebab, all aligned. */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-app-fg text-sm truncate">{r.name}</p>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <StatusBadge status={r.enabled ? 'ENABLED' : 'DISABLED'} />
                    <StatusBadge status={r.kind === 'EVENT' ? 'Event journey' : 'Segment broadcast'} />
                  </div>
                </div>
                <div data-no-row-click className="shrink-0 -mt-1 -mr-1">
                  <TableRowActionsSheet
                    ariaLabel={`Actions for ${r.name}`}
                    sheetTitle={r.name}
                    actions={[
                  {
                    key: 'toggle',
                    kind: 'button' as const,
                    label: r.enabled ? 'Disable' : 'Enable',
                    onClick: () => setToggleTarget(r),
                  },
                  { key: 'test', kind: 'button' as const, label: 'Send test', onClick: () => openTest(r) },
                  ...(r.kind === 'SEGMENT'
                    ? [
                        {
                          key: 'run',
                          kind: 'button' as const,
                          label: 'Run now',
                          onClick: () => setRunTarget(r),
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
              </div>
              {/* Footer: channels + timing, on one tidy line. */}
              <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <ChannelIcons channels={r.channels} />
                <span className="truncate">{timingLabel(r)}</span>
              </div>
            </div>
          )}
        />
      </div>
      )}

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

      {/* Enable / disable confirmation. */}
      <ConfirmActionModal
        open={!!toggleTarget}
        onClose={() => (busy ? undefined : setToggleTarget(null))}
        title={toggleTarget?.enabled ? 'Disable automation' : 'Enable automation'}
        description={
          toggleTarget?.enabled
            ? `Pause "${toggleTarget?.name ?? ''}"? It stops sending until you enable it again.`
            : `Enable "${toggleTarget?.name ?? ''}"? It goes live and starts sending on its trigger or schedule.`
        }
        confirmLabel={toggleTarget?.enabled ? 'Disable' : 'Enable'}
        variant={toggleTarget?.enabled ? 'danger' : 'warning'}
        loading={busy}
        error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
        onConfirm={() =>
          toggleTarget && submit({ intent: 'toggle', ruleId: toggleTarget.id, enabled: String(!toggleTarget.enabled) })
        }
      />

      {/* Run-now (broadcast) confirmation. */}
      <ConfirmActionModal
        open={!!runTarget}
        onClose={() => (busy ? undefined : setRunTarget(null))}
        title="Run broadcast now"
        description={`Send "${runTarget?.name ?? ''}" to its audience right now? This messages everyone who matches, using live credentials.`}
        confirmLabel="Run now"
        variant="warning"
        loading={busy}
        error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
        onConfirm={() => runTarget && submit({ intent: 'runNow', ruleId: runTarget.id })}
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

      {/* Create / edit a message template. */}
      {tplDraft && (
        <TemplateModal
          draft={tplDraft}
          busy={busy}
          error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
          onClose={() => (busy ? undefined : setTplDraft(null))}
          onSave={(d) =>
            submit({
              intent: d.id ? 'updateTemplate' : 'createTemplate',
              ...(d.id ? { templateId: d.id } : {}),
              name: d.name,
              // Channels as a comma-joined string; the action splits it back to an array.
              channels: d.channels.join(','),
              subject: d.channels.includes('EMAIL') ? d.subject : '',
              body: d.body,
            })
          }
        />
      )}

      <ConfirmActionModal
        open={!!archiveTarget}
        onClose={() => (busy ? undefined : setArchiveTarget(null))}
        title="Archive template"
        description={`Archive "${archiveTarget?.name ?? ''}"? Rules already using it keep sending; it just won't appear in the picker for new rules.`}
        confirmLabel="Archive"
        variant="danger"
        loading={busy}
        error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
        onConfirm={() => archiveTarget && submit({ intent: 'archiveTemplate', templateId: archiveTarget.id })}
      />

      {/* Target group create / edit. */}
      {groupDraft && (
        <TargetGroupModal
          draft={groupDraft}
          busy={busy}
          error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
          onClose={() => (busy ? undefined : setGroupDraft(null))}
          onSave={(g) =>
            submit({
              intent: g.id ? 'updateGroup' : 'createGroup',
              ...(g.id ? { groupId: g.id } : {}),
              name: g.name,
              description: g.description,
              enabled: String(g.enabled),
              // Filter serialized as JSON; the action forwards it as `filter`.
              filter: JSON.stringify(g.filter),
            })
          }
        />
      )}

      <ConfirmActionModal
        open={!!groupArchiveTarget}
        onClose={() => (busy ? undefined : setGroupArchiveTarget(null))}
        title="Archive target group"
        description={`Archive "${groupArchiveTarget?.name ?? ''}"? It stops syncing and is removed from the audience picker. Automations already pointed at it will reach no one.`}
        confirmLabel="Archive"
        variant="danger"
        loading={busy}
        error={(fetcher.data as { error?: string } | undefined)?.error ?? null}
        onConfirm={() => groupArchiveTarget && submit({ intent: 'archiveGroup', groupId: groupArchiveTarget.id })}
      />
    </div>
  );
}

/** Message templates list — the "Message templates" tab body. */
function TemplatesPanel({
  templates,
  onNew,
  onEdit,
  onArchive,
}: {
  templates: AutomationTemplateRow[];
  onNew: () => void;
  onEdit: (t: AutomationTemplateRow) => void;
  onArchive: (t: AutomationTemplateRow) => void;
}) {
  if (templates.length === 0) {
    return (
      <div className="list-panel p-8 text-center space-y-3">
        <p className="text-sm text-app-fg-muted">
          No message templates yet. Create one, then pick it when you build an automation.
        </p>
        <Button variant="primary" size="sm" onClick={onNew}>
          New template
        </Button>
      </div>
    );
  }
  return (
    <div className="list-panel divide-y divide-app-border">
      {templates.map((t) => (
        <div key={t.id} className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-app-fg truncate">{t.name}</span>
              {t.channels.map((c) => (
                <StatusBadge key={c} status={c} />
              ))}
            </div>
            {t.subject && <p className="mt-0.5 text-xs text-app-fg-muted truncate">Subject: {t.subject}</p>}
            <p className="mt-1 text-xs text-app-fg-muted line-clamp-2">{t.body}</p>
          </div>
          <div data-no-row-click className="flex shrink-0 items-center gap-1">
            <TableActionButton onClick={() => onEdit(t)}>Edit</TableActionButton>
            <CompactTableActionButton tone="danger" onClick={() => onArchive(t)}>
              Archive
            </CompactTableActionButton>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Create/edit modal for a message template. Local draft state; saves via parent. */
function TemplateModal({
  draft,
  busy,
  error,
  onClose,
  onSave,
}: {
  draft: TemplateDraft;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (d: TemplateDraft) => void;
}) {
  const [d, setD] = useState<TemplateDraft>(draft);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const isEmail = d.channels.includes('EMAIL');
  const canSave =
    d.name.trim().length >= 2 &&
    d.body.trim().length > 0 &&
    d.channels.length > 0 &&
    (!isEmail || d.subject.trim().length > 0);
  const toggleChannel = (c: AutomationChannel) =>
    setD((prev) => ({
      ...prev,
      channels: prev.channels.includes(c) ? prev.channels.filter((x) => x !== c) : [...prev.channels, c],
    }));
  // Insert a {{token}} at the cursor (or append if the textarea isn't focused).
  const insertVariable = (token: string) => {
    const snippet = `{{${token}}}`;
    const el = bodyRef.current;
    setD((prev) => {
      if (!el) return { ...prev, body: prev.body + snippet };
      const start = el.selectionStart ?? prev.body.length;
      const end = el.selectionEnd ?? prev.body.length;
      const next = prev.body.slice(0, start) + snippet + prev.body.slice(end);
      // Restore the caret just after the inserted token on the next tick.
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
      return { ...prev, body: next };
    });
  };
  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" contentClassName="p-5">
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-app-fg">{d.id ? 'Edit template' : 'New template'}</h3>
        <div>
          <label className="mb-1 block text-sm font-medium text-app-fg-muted">Name</label>
          <TextInput value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Order thank-you" />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-app-fg-muted">Channels</label>
          <div className="grid grid-cols-3 gap-2">
            {ALL_CHANNELS.map((c) => {
              const on = d.channels.includes(c);
              const Icon = CHANNEL_META[c]?.icon;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  className={[
                    'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm transition-colors',
                    on
                      ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300'
                      : 'border-app-border text-app-fg-muted hover:border-app-border-strong',
                  ].join(' ')}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {CHANNEL_META[c]?.label ?? c}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-app-fg-muted">The same body is reused on each channel you pick.</p>
        </div>
        {isEmail && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-app-fg-muted">Subject</label>
              <FormSelect
                aria-label="Insert variable into subject"
                value=""
                onChange={(e) => {
                  if (e.target.value) setD((prev) => ({ ...prev, subject: `${prev.subject}{{${e.target.value}}}` }));
                  e.target.value = '';
                }}
                className="w-44"
                options={[
                  { value: '', label: 'Insert variable…' },
                  ...AUTOMATION_TEMPLATE_VARIABLES.map((v) => ({ value: v.token, label: v.label })),
                ]}
              />
            </div>
            <TextInput value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} placeholder="Email subject line" />
          </div>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="tpl-body" className="text-sm font-medium text-app-fg-muted">Message body</label>
            {/* Insert-variable picker: choosing an option drops {{token}} at the cursor. */}
            <FormSelect
              aria-label="Insert variable"
              value=""
              onChange={(e) => {
                if (e.target.value) insertVariable(e.target.value);
                e.target.value = ''; // reset so the same variable can be picked again
              }}
              className="w-44"
              options={[
                { value: '', label: 'Insert variable…' },
                ...AUTOMATION_TEMPLATE_VARIABLES.map((v) => ({ value: v.token, label: v.label })),
              ]}
            />
          </div>
          <textarea
            id="tpl-body"
            ref={bodyRef}
            value={d.body}
            onChange={(e) => setD({ ...d, body: e.target.value })}
            className="input min-h-[120px]"
            placeholder="Hi {{customer_name}}, thanks for your order {{order_id}}."
          />
          <p className="mt-1 text-xs text-app-fg-muted">
            Available variables: {AUTOMATION_TEMPLATE_VARIABLES.map((v) => `{{${v.token}}}`).join(', ')}.
          </p>
        </div>
        {error && <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="primary" size="sm" loading={busy} loadingText="Saving…" disabled={!canSave} onClick={() => onSave(d)}>
            {d.id ? 'Save changes' : 'Create template'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
