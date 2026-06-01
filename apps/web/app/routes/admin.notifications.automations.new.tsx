import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useFetcher, useNavigate } from '@remix-run/react';
import { useState } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { Button } from '~/components/ui/button';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useFetcherToast } from '~/components/ui/toast';
import { apiRequest, getSessionCookie, getCurrentUser } from '~/lib/api.server';

export const meta: MetaFunction = () => [{ title: 'New Automation Rule — Yannis EOSE' }];

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
  { value: 'CS_CLOSER', label: 'Sales Closer' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'LOGISTICS_MANAGER', label: 'Logistics Manager' },
  { value: 'TPL_MANAGER', label: '3PL Manager' },
  { value: 'TPL_RIDER', label: '3PL Rider' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
];

const TITLE_MAX = 80;
const BODY_MAX = 120;

type SchedulePreset = 'daily' | 'monday' | 'weekday' | 'custom';
type TriggerType = 'SCHEDULED' | 'EVENT_BASED';
type TargetType = 'ALL' | 'ROLE' | 'USER';

function buildCron(preset: SchedulePreset, time: string): string {
  const [h = '9', m = '0'] = time.split(':');
  const hour = parseInt(h, 10);
  const min = parseInt(m, 10);
  switch (preset) {
    case 'daily': return `${min} ${hour} * * *`;
    case 'monday': return `${min} ${hour} * * 1`;
    case 'weekday': return `${min} ${hour} * * 1-5`;
    default: return `${min} ${hour} * * *`;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getCurrentUser(request);
  const PUSH_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'BRANCH_ADMIN', 'HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS', 'HR_MANAGER']);
  if (!user || !PUSH_ROLES.has(user.role)) {
    return redirect('/admin/notifications?tab=automations');
  }
  return json({ ok: true });
}

export async function action({ request }: ActionFunctionArgs) {
  const cookie = getSessionCookie(request);
  const formData = await request.formData();
  const intent = formData.get('intent')?.toString();

  if (intent === 'create') {
    const triggerType = formData.get('triggerType')?.toString() ?? 'SCHEDULED';
    const payload: Record<string, unknown> = {
      name: formData.get('name')?.toString() ?? '',
      triggerType,
      targetType: formData.get('targetType')?.toString() ?? 'ALL',
      targetRole: formData.get('targetRole')?.toString() || undefined,
      targetUserId: formData.get('targetUserId')?.toString() || undefined,
      titleTemplate: formData.get('titleTemplate')?.toString() ?? '',
      bodyTemplate: formData.get('bodyTemplate')?.toString() ?? '',
    };
    if (triggerType === 'SCHEDULED') {
      const preset = (formData.get('schedulePreset')?.toString() ?? 'daily') as SchedulePreset;
      if (preset === 'custom') {
        payload.cronExpression = formData.get('customCron')?.toString() ?? '0 9 * * *';
      } else {
        payload.cronExpression = buildCron(preset, formData.get('scheduleTime')?.toString() ?? '09:00');
      }
    } else {
      payload.eventTrigger = formData.get('eventTrigger')?.toString() ?? 'agent_inactive_2h';
    }

    const res = await apiRequest('/trpc/notifications.createAutomationRule', {
      method: 'POST',
      cookie,
      body: payload,
    });
    if (!res.ok) return json({ error: 'Failed to create rule.' }, { status: 400 });
    return redirect('/admin/notifications?tab=automations');
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
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

export default function NewAutomationRulePage() {
  const fetcher = useFetcher<{ error?: string }>();
  const surface = useFetcherActionSurface(fetcher);
  const navigate = useNavigate();
  useFetcherToast(fetcher.data, { successMessage: 'Rule created' });

  const [triggerType, setTriggerType] = useState<TriggerType>('SCHEDULED');
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [customCron, setCustomCron] = useState('0 9 * * *');
  const [eventTrigger, setEventTrigger] = useState('agent_inactive_2h');
  const [targetType, setTargetType] = useState<TargetType>('ALL');
  const [targetRole, setTargetRole] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [name, setName] = useState('');
  const [titleTemplate, setTitleTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');

  const isSubmitting = fetcher.state !== 'idle';
  const canSubmit = name.length > 0 && titleTemplate.length > 0 && titleTemplate.length <= TITLE_MAX && bodyTemplate.length <= BODY_MAX;

  const radioPillClass =
    'flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors border-app-border bg-app-elevated text-app-fg ' +
    'has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10 has-[:checked]:text-brand-700 ' +
    'dark:has-[:checked]:border-brand-400 dark:has-[:checked]:bg-brand-900/30 dark:has-[:checked]:text-brand-300';

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Automation Rule"
        backTo="/admin/notifications?tab=automations"
        description="Create a scheduled or event-driven push notification rule."
      />

      <ModalFetcherInlineError message={surface.errorMatchingIntent('create')} />

      <fetcher.Form method="post" className="space-y-4 max-w-xl">
        <input type="hidden" name="intent" value="create" />

        <TextInput
          label="Rule name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Daily agent reminder"
        />

        {/* Trigger type */}
        <div>
          <p className="mb-2 text-xs font-medium text-app-fg-muted">Trigger type</p>
          <div className="grid grid-cols-2 gap-2">
            {(['SCHEDULED', 'EVENT_BASED'] as const).map((t) => (
              <label key={t} className={radioPillClass}>
                <input
                  type="radio"
                  name="triggerType"
                  value={t}
                  checked={triggerType === t}
                  onChange={() => setTriggerType(t)}
                  className="sr-only"
                />
                {t === 'SCHEDULED' ? 'Scheduled' : 'Event-based'}
              </label>
            ))}
          </div>
        </div>

        {triggerType === 'SCHEDULED' && (
          <div className="space-y-2 rounded-lg border border-app-border bg-app-hover/50 p-4">
            <p className="text-xs font-medium text-app-fg-muted">Schedule</p>
            {([
              { value: 'daily' as const, label: 'Every day at…' },
              { value: 'monday' as const, label: 'Every Monday at…' },
              { value: 'weekday' as const, label: 'Every weekday at…' },
              { value: 'custom' as const, label: 'Custom cron expression' },
            ]).map(({ value, label }) => (
              <div key={value} className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-app-fg">
                  <input
                    type="radio"
                    name="schedulePreset"
                    value={value}
                    checked={schedulePreset === value}
                    onChange={() => setSchedulePreset(value)}
                    className="accent-brand-600"
                  />
                  {label}
                </label>
                {schedulePreset === value && value !== 'custom' && (
                  <input
                    type="time"
                    name="scheduleTime"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="rounded-md border border-app-border bg-app-elevated px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                )}
                {schedulePreset === value && value === 'custom' && (
                  <input
                    type="text"
                    name="customCron"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    placeholder="0 9 * * *"
                    className="flex-1 rounded-md border border-app-border bg-app-elevated px-2 py-1 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {triggerType === 'EVENT_BASED' && (
          <FormSelect
            name="eventTrigger"
            label="Event trigger"
            value={eventTrigger}
            onChange={(e) => setEventTrigger(e.target.value)}
            options={EVENT_OPTIONS}
          />
        )}

        {/* Target */}
        <div>
          <p className="mb-2 text-xs font-medium text-app-fg-muted">Target</p>
          <div className="grid grid-cols-3 gap-2">
            {(['ALL', 'ROLE', 'USER'] as const).map((t) => (
              <label key={t} className={radioPillClass}>
                <input
                  type="radio"
                  name="targetType"
                  value={t}
                  checked={targetType === t}
                  onChange={() => setTargetType(t)}
                  className="sr-only"
                />
                {t === 'ALL' ? 'Everyone' : t === 'ROLE' ? 'By role' : 'One user'}
              </label>
            ))}
          </div>
          {targetType === 'ROLE' && (
            <FormSelect
              name="targetRole"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value)}
              placeholder="Select a role…"
              options={ALL_ROLES}
              wrapperClassName="mt-2"
            />
          )}
          {targetType === 'USER' && (
            <TextInput
              name="targetUserId"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="User ID"
              wrapperClassName="mt-2"
            />
          )}
        </div>

        {/* Title template */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-app-fg-muted">Title template</label>
            <span className={`text-xs tabular-nums ${titleTemplate.length > TITLE_MAX ? 'text-danger-500' : 'text-app-fg-muted'}`}>
              {titleTemplate.length}/{TITLE_MAX}
            </span>
          </div>
          <TextInput
            name="titleTemplate"
            value={titleTemplate}
            onChange={(e) => setTitleTemplate(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder="e.g. Hi {{user_name}}, daily check-in!"
          />
          <PlaceholderChips onInsert={(chip) => setTitleTemplate((v) => v + chip)} />
        </div>

        {/* Body template */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-app-fg-muted">Body template</label>
            <span className={`text-xs tabular-nums ${bodyTemplate.length > BODY_MAX ? 'text-danger-500' : 'text-app-fg-muted'}`}>
              {bodyTemplate.length}/{BODY_MAX}
            </span>
          </div>
          <Textarea
            name="bodyTemplate"
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
            maxLength={BODY_MAX}
            rows={3}
            placeholder="e.g. You have {{order_count}} orders pending today."
            showCount
            className="resize-none"
          />
          <PlaceholderChips onInsert={(chip) => setBodyTemplate((v) => v + chip)} />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" variant="primary" className="flex-1" disabled={!canSubmit} loading={isSubmitting} loadingText="Saving…">
            Save rule
          </Button>
          <Button type="button" variant="secondary" className="flex-1" onClick={() => navigate('/admin/notifications?tab=automations')}>
            Cancel
          </Button>
        </div>
      </fetcher.Form>
    </div>
  );
}
