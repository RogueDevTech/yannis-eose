import { useFetcher } from '@remix-run/react';
import { useState } from 'react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { useFetcherToast } from '~/components/ui/toast';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';

export interface AutomationRule {
  id: string;
  name: string;
  triggerType: 'SCHEDULED' | 'EVENT_BASED';
  cronExpression?: string | null;
  eventTrigger?: string | null;
  targetType: 'ALL' | 'ROLE' | 'USER';
  targetRole?: string | null;
  targetUserId?: string | null;
  titleTemplate: string;
  bodyTemplate: string;
  isActive: boolean;
  lastFiredAt?: string | null;
  createdAt: string;
}

interface RuleFormState {
  name: string;
  triggerType: 'SCHEDULED' | 'EVENT_BASED';
  schedulePreset: 'daily' | 'monday' | 'weekday' | 'custom';
  scheduleTime: string;
  customCron: string;
  eventTrigger: string;
  targetType: 'ALL' | 'ROLE' | 'USER';
  targetRole: string;
  targetUserId: string;
  titleTemplate: string;
  bodyTemplate: string;
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  triggerType: 'SCHEDULED',
  schedulePreset: 'daily',
  scheduleTime: '09:00',
  customCron: '0 9 * * *',
  eventTrigger: 'agent_inactive_2h',
  targetType: 'ALL',
  targetRole: '',
  targetUserId: '',
  titleTemplate: '',
  bodyTemplate: '',
};

const EVENT_OPTIONS = [
  { value: 'agent_inactive_2h', label: 'Agent inactive for 2+ hours' },
  { value: 'order_stuck_24h', label: 'Order stuck 24+ hours' },
  { value: 'sla_breach', label: 'SLA breach detected' },
  { value: 'funding_not_confirmed_1h', label: 'Funding not confirmed after 1 hour' },
];

const ALL_ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'CS_CLOSER', label: 'CS Closer' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'LOGISTICS_MANAGER', label: 'Logistics Manager' },
  { value: 'TPL_MANAGER', label: '3PL Manager' },
  { value: 'TPL_RIDER', label: '3PL Rider' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
];

function buildCron(preset: RuleFormState['schedulePreset'], time: string): string {
  const [h = '9', m = '0'] = time.split(':');
  const hour = parseInt(h, 10);
  const min = parseInt(m, 10);
  switch (preset) {
    case 'daily':
      return `${min} ${hour} * * *`;
    case 'monday':
      return `${min} ${hour} * * 1`;
    case 'weekday':
      return `${min} ${hour} * * 1-5`;
    default:
      return `${min} ${hour} * * *`;
  }
}

function describeCron(rule: AutomationRule): string {
  if (rule.triggerType === 'EVENT_BASED') {
    return EVENT_OPTIONS.find((e) => e.value === rule.eventTrigger)?.label ?? rule.eventTrigger ?? '—';
  }
  if (!rule.cronExpression) return '—';
  return `cron: ${rule.cronExpression}`;
}

function describeTarget(rule: AutomationRule): string {
  if (rule.targetType === 'ALL') return 'Everyone';
  if (rule.targetType === 'ROLE')
    return ALL_ROLES.find((r) => r.value === rule.targetRole)?.label ?? rule.targetRole ?? '—';
  return `User: ${rule.targetUserId ?? '—'}`;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TITLE_MAX = 80;
const BODY_MAX = 120;

export interface NotificationsAutomationsPanelProps {
  rules: AutomationRule[];
}

export function NotificationsAutomationsPanel({ rules }: NotificationsAutomationsPanelProps) {
  const fetcher = useFetcher();
  const ruleSurface = useFetcherActionSurface(fetcher);
  const toggleFetcher = useFetcher();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);

  function openCreate() {
    setEditingRule(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(rule: AutomationRule) {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      triggerType: rule.triggerType,
      schedulePreset: 'daily',
      scheduleTime: '09:00',
      customCron: rule.cronExpression ?? '0 9 * * *',
      eventTrigger: rule.eventTrigger ?? 'agent_inactive_2h',
      targetType: rule.targetType,
      targetRole: rule.targetRole ?? '',
      targetUserId: rule.targetUserId ?? '',
      titleTemplate: rule.titleTemplate,
      bodyTemplate: rule.bodyTemplate,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingRule(null);
    setForm(EMPTY_FORM);
  }

  const isSubmitting = fetcher.state !== 'idle';
  const formIntent = editingRule ? 'update' : 'create';

  useFetcherToast(fetcher.data, {
    successMessage: 'Rule saved',
    skipErrorToast: Boolean(
      (modalOpen &&
        (ruleSurface.errorMatchingIntent('create') || ruleSurface.errorMatchingIntent('update'))) ||
        (ruleSurface.resolverIntent === 'delete' && !!ruleSurface.friendlyError),
    ),
  });
  useFetcherToast(toggleFetcher.data, { successMessage: 'Automation updated' });

  useCloseOnFetcherSuccess(fetcher, closeModal);

  function handleDelete(rule: AutomationRule) {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set('intent', 'delete');
    fd.set('id', rule.id);
    fetcher.submit(fd, { method: 'post' });
  }

  function handleToggle(rule: AutomationRule) {
    const fd = new FormData();
    fd.set('intent', 'toggle');
    fd.set('id', rule.id);
    fd.set('isActive', String(!rule.isActive));
    toggleFetcher.submit(fd, { method: 'post' });
  }

  function setField<K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const ruleColumns: CompactTableColumn<AutomationRule>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (rule) => <span className="font-medium text-app-fg">{rule.name}</span>,
    },
    {
      key: 'trigger',
      header: 'Trigger',
      render: (rule) => (
        <span className="inline-flex items-center gap-1.5 max-w-[200px]">
          <span
            className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
              rule.triggerType === 'SCHEDULED' ? 'bg-info-500' : 'bg-warning-500'
            }`}
          />
          <span className="truncate text-app-fg-muted">{describeCron(rule)}</span>
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Target',
      render: (rule) => <span className="text-app-fg-muted">{describeTarget(rule)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (rule) => (
        <ToggleSwitch
          checked={rule.isActive}
          onChange={() => handleToggle(rule)}
          disabled={toggleFetcher.state !== 'idle'}
        />
      ),
    },
    {
      key: 'lastFired',
      header: 'Last fired',
      render: (rule) => <span className="text-app-fg-muted">{relativeTime(rule.lastFiredAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      tight: true,
      render: (rule) => (
        <div className="flex items-center gap-2">
          <CompactTableActionButton onClick={() => openEdit(rule)}>Edit</CompactTableActionButton>
          <CompactTableActionButton tone="danger" onClick={() => handleDelete(rule)}>
            Delete
          </CompactTableActionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ModalFetcherInlineError
        message={
          ruleSurface.resolverIntent === 'delete'
            ? ruleSurface.friendlyError || null
            : null
        }
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-app-fg">Push automation rules</h2>
          <p className="mt-0.5 text-sm text-app-fg-muted">Scheduled and event-driven push notifications.</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New rule
        </button>
      </div>

      <div className="list-panel">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-app-fg-muted">
            <svg className="mb-3 h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
            <p className="text-sm font-medium text-app-fg">No automation rules yet</p>
            <p className="mt-1 text-xs">Create your first rule to get started.</p>
          </div>
        ) : (
          <CompactTable
            withCard={false}
            columns={ruleColumns}
            rows={rules}
            rowKey={(rule) => rule.id}
            rowClassName={() => 'transition-colors hover:bg-app-hover/40'}
          />
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-app-border bg-app-elevated shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-app-border bg-app-elevated px-6 py-4">
              <h3 className="text-base font-semibold text-app-fg">
                {editingRule ? 'Edit rule' : 'New automation rule'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-1 text-app-fg-muted hover:bg-app-hover hover:text-app-fg"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <fetcher.Form method="post" className="space-y-5 p-6">
              <input type="hidden" name="intent" value={formIntent} />
              {editingRule && <input type="hidden" name="id" value={editingRule.id} />}

              <ModalFetcherInlineError
                message={ruleSurface.errorMatchingIntent(['create', 'update'])}
              />

              <div>
                <label className="mb-1 block text-xs font-medium text-app-fg-muted">Rule name</label>
                <input
                  type="text"
                  name="name"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="e.g. Daily agent reminder"
                  className="input"
                />
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-app-fg-muted">Trigger type</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['SCHEDULED', 'EVENT_BASED'] as const).map((t) => (
                    <label
                      key={t}
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-app-border px-4 py-2 text-sm font-medium text-app-fg transition-colors has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10 has-[:checked]:text-brand-700 dark:has-[:checked]:border-brand-400 dark:has-[:checked]:bg-brand-900/30 dark:has-[:checked]:text-brand-300"
                    >
                      <input
                        type="radio"
                        name="triggerType"
                        value={t}
                        checked={form.triggerType === t}
                        onChange={() => setField('triggerType', t)}
                        className="sr-only"
                      />
                      {t === 'SCHEDULED' ? 'Scheduled' : 'Event-based'}
                    </label>
                  ))}
                </div>
              </div>

              {form.triggerType === 'SCHEDULED' && (
                <div className="space-y-2 rounded-lg border border-app-border bg-app-hover/50 p-4">
                  <p className="text-xs font-medium text-app-fg-muted">Schedule</p>
                  {(
                    [
                      { value: 'daily', label: 'Every day at…' },
                      { value: 'monday', label: 'Every Monday at…' },
                      { value: 'weekday', label: 'Every weekday at…' },
                      { value: 'custom', label: 'Custom cron expression' },
                    ] as { value: RuleFormState['schedulePreset']; label: string }[]
                  ).map(({ value, label }) => (
                    <div key={value} className="flex items-center gap-3">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-app-fg">
                        <input
                          type="radio"
                          name="schedulePreset"
                          value={value}
                          checked={form.schedulePreset === value}
                          onChange={() => setField('schedulePreset', value)}
                          className="accent-brand-600"
                        />
                        {label}
                      </label>
                      {form.schedulePreset === value && value !== 'custom' && (
                        <input
                          type="time"
                          name="scheduleTime"
                          value={form.scheduleTime}
                          onChange={(e) => setField('scheduleTime', e.target.value)}
                          className="rounded-md border border-app-border bg-app-elevated px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      )}
                      {form.schedulePreset === value && value === 'custom' && (
                        <input
                          type="text"
                          name="customCron"
                          value={form.customCron}
                          onChange={(e) => setField('customCron', e.target.value)}
                          placeholder="0 9 * * *"
                          className="flex-1 rounded-md border border-app-border bg-app-elevated px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {form.triggerType === 'EVENT_BASED' && (
                <div>
                  <FormSelect
                    name="eventTrigger"
                    label="Event trigger"
                    value={form.eventTrigger}
                    onChange={(e) => setField('eventTrigger', e.target.value)}
                    options={EVENT_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                  />
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-medium text-app-fg-muted">Target</p>
                <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                  {(['ALL', 'ROLE', 'USER'] as const).map((t) => (
                    <label
                      key={t}
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-app-border px-3 py-1.5 text-sm font-medium text-app-fg transition-colors has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10 has-[:checked]:text-brand-700 dark:has-[:checked]:border-brand-400 dark:has-[:checked]:bg-brand-900/30 dark:has-[:checked]:text-brand-300"
                    >
                      <input
                        type="radio"
                        name="targetType"
                        value={t}
                        checked={form.targetType === t}
                        onChange={() => setField('targetType', t)}
                        className="sr-only"
                      />
                      {t === 'ALL' ? 'Everyone' : t === 'ROLE' ? 'By role' : 'Specific user'}
                    </label>
                  ))}
                </div>
                {form.targetType === 'ROLE' && (
                  <FormSelect
                    name="targetRole"
                    value={form.targetRole}
                    onChange={(e) => setField('targetRole', e.target.value)}
                    placeholder="Select a role…"
                    options={ALL_ROLES.map((r) => ({ value: r.value, label: r.label }))}
                    wrapperClassName="mt-2"
                  />
                )}
                {form.targetType === 'USER' && (
                  <TextInput
                    type="text"
                    name="targetUserId"
                    value={form.targetUserId}
                    onChange={(e) => setField('targetUserId', e.target.value)}
                    placeholder="User ID"
                    wrapperClassName="mt-2"
                  />
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-app-fg-muted">Title template</label>
                  <span
                    className={`text-xs ${form.titleTemplate.length > TITLE_MAX ? 'text-danger-500' : 'text-app-fg-muted'}`}
                  >
                    {form.titleTemplate.length}/{TITLE_MAX}
                  </span>
                </div>
                <TextInput
                  type="text"
                  name="titleTemplate"
                  value={form.titleTemplate}
                  onChange={(e) => setField('titleTemplate', e.target.value)}
                  maxLength={TITLE_MAX}
                  placeholder="e.g. Hi {{user_name}}, daily check-in!"
                />
                <PlaceholderChips onInsert={(chip) => setField('titleTemplate', form.titleTemplate + chip)} />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-medium text-app-fg-muted">Body template</label>
                  <span
                    className={`text-xs ${form.bodyTemplate.length > BODY_MAX ? 'text-danger-500' : 'text-app-fg-muted'}`}
                  >
                    {form.bodyTemplate.length}/{BODY_MAX}
                  </span>
                </div>
                <Textarea
                  name="bodyTemplate"
                  value={form.bodyTemplate}
                  onChange={(e) => setField('bodyTemplate', e.target.value)}
                  maxLength={BODY_MAX}
                  rows={3}
                  placeholder="e.g. You have {{order_count}} orders pending today."
                  showCount
                  className="resize-none"
                />
                <PlaceholderChips onInsert={(chip) => setField('bodyTemplate', form.bodyTemplate + chip)} />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-app-border px-4 py-2 text-sm font-medium text-app-fg hover:bg-app-hover"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 dark:bg-brand-500"
                >
                  {isSubmitting ? 'Saving…' : 'Save rule'}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceholderChips({ onInsert }: { onInsert: (chip: string) => void }) {
  const chips = ['{{user_name}}', '{{order_count}}'];
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => onInsert(chip)}
          className="rounded-md bg-app-hover px-2 py-0.5 font-mono text-xs text-app-fg-muted transition-colors hover:bg-brand-500/15 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-app-border'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
