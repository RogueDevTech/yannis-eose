import { useState } from 'react';
import { useFetcher, useNavigate } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { PageNotification } from '~/components/ui/page-notification';
import type { AutomationChannel } from './types';
import { ALL_CHANNELS, CHANNEL_META } from './channel-meta';

export function NewAutomationPage({ configuredChannels }: { configuredChannels: AutomationChannel[] }) {
  const fetcher = useFetcher<{ error?: string }>();
  const navigate = useNavigate();
  const [kind, setKind] = useState<'EVENT' | 'SEGMENT'>('EVENT');
  const [selected, setSelected] = useState<Set<AutomationChannel>>(new Set());
  const [dismissedError, setDismissedError] = useState(false);

  const error = dismissedError ? undefined : fetcher.data?.error;
  const submitting = fetcher.state === 'submitting';
  const noChannelsReady = configuredChannels.length === 0;

  const toggle = (c: AutomationChannel) => {
    if (!configuredChannels.includes(c)) return; // can't select an unconfigured channel
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="New automation"
        backTo="/admin/marketing/automation"
        description="Message customers automatically on a trigger or a schedule."
      />

      {error && (
        <PageNotification
          variant="error"
          message={error}
          durationMs={6000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {noChannelsReady && (
        <div className="list-panel p-4 text-sm text-app-fg-muted">
          No sending channel is configured yet. Email turns on with SendGrid credentials, SMS with Africa&apos;s
          Talking keys, and WhatsApp with Termii keys. You can still fill this in, but a rule can only be saved on
          a channel that can actually send.
        </div>
      )}

      <fetcher.Form
        method="post"
        className="list-panel p-5 space-y-5 max-w-2xl"
        onSubmit={() => setDismissedError(false)}
      >
        <TextInput label="Name" name="name" type="text" required minLength={2} placeholder="e.g. Post-order thank you" />

        {/* Channels — icon checkboxes, multi-select */}
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-2">Channels</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {ALL_CHANNELS.map((c) => {
              const meta = CHANNEL_META[c];
              const Icon = meta.icon;
              const isConfigured = configuredChannels.includes(c);
              const isOn = selected.has(c);
              return (
                <label
                  key={c}
                  className={[
                    'relative flex items-center gap-3 rounded-lg border px-3.5 py-3 cursor-pointer transition-colors select-none',
                    isOn
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
                      : 'border-app-border hover:border-app-border-strong bg-app-surface',
                    !isConfigured ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <input
                    type="checkbox"
                    name="channels"
                    value={c}
                    checked={isOn}
                    disabled={!isConfigured}
                    onChange={() => toggle(c)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Icon className={`h-5 w-5 shrink-0 ${isOn ? 'text-primary-600 dark:text-primary-400' : 'text-app-fg-muted'}`} />
                  <span className="flex flex-col leading-tight">
                    <span className="text-sm font-medium text-app-fg">{meta.label}</span>
                    {!isConfigured && <span className="text-[11px] text-app-fg-muted">Not configured</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-app-fg-muted">Pick one or more. The rule sends on every channel you select.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div>
            <label htmlFor="automation-priority" className="block text-sm font-medium text-app-fg-muted mb-1">
              Priority
            </label>
            <input id="automation-priority" type="number" name="priority" min={0} defaultValue={0} className="input" />
            <p className="mt-1 text-xs text-app-fg-muted">Higher runs first when rules overlap.</p>
          </div>
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

        <div className="flex flex-col gap-2">
          <label className="inline-flex items-center gap-2 text-sm text-app-fg">
            <input type="checkbox" name="respectOptOut" defaultChecked className="h-4 w-4 rounded border-gray-300" />
            Honor opt-out list
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-app-fg">
            <input type="checkbox" name="enabled" defaultChecked className="h-4 w-4 rounded border-gray-300" />
            Enabled
          </label>
        </div>

        <div className="flex gap-2 pt-1 border-t border-app-border/60">
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            loadingText="Creating..."
            disabled={noChannelsReady || selected.size === 0}
          >
            Create automation
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => navigate('/admin/marketing/automation')}
          >
            Cancel
          </Button>
        </div>
      </fetcher.Form>
    </div>
  );
}
