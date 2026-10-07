import { useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import type { DuplicateRules, DuplicateRuleKey } from '@yannis/shared';
import { PageHeader } from '~/components/ui/page-header';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { ToggleSwitch } from '~/components/ui/toggle-switch';
import { EmptyState } from '~/components/ui/empty-state';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

export interface DuplicateRulesData {
  companySelected: boolean;
  rules: DuplicateRules;
  defaults: DuplicateRules;
  updatedAt: string | null;
  updatedByName: string | null;
}

type ModeOption = { value: string; label: string };

interface RuleDef {
  key: DuplicateRuleKey;
  title: string;
  description: string;
  /** Select modes. Omitted = on/off toggle (`enabled`). */
  modes?: ModeOption[];
  /** Field holding the window, if the rule has one. */
  window?: { field: 'windowDays' | 'windowMinutes'; unit: string; max: number };
  /** Shown while the rule is loosened from its default. */
  warning?: string;
}

interface Section {
  title: string;
  rules: RuleDef[];
}

const SECTIONS: Section[] = [
  {
    title: 'Order form',
    rules: [
      {
        key: 'intakeBlock',
        title: 'Repeat order block',
        description: 'Same phone and product submitted again inside the window.',
        modes: [
          { value: 'BLOCK', label: 'Block (no new order)' },
          { value: 'FLAG', label: 'Create order and flag it' },
          { value: 'OFF', label: 'Off' },
        ],
        window: { field: 'windowDays', unit: 'days', max: 90 },
        warning: 'Repeat submissions become orders. CS sees them flagged as possible duplicates.',
      },
      {
        key: 'doubleSubmitGuard',
        title: 'Double-tap guard',
        description: 'Same phone on the same form inside the window returns the first order.',
        window: { field: 'windowMinutes', unit: 'minutes', max: 60 },
        warning: 'A double tap or page refresh can create two orders.',
      },
    ],
  },
  {
    title: 'CS-created orders',
    rules: [
      {
        key: 'manualOrderBlock',
        title: 'Manual order block',
        description: 'Offline, delivered follow-up and cart recovery orders for a customer who already has one.',
        modes: [
          { value: 'BLOCK', label: 'Block' },
          { value: 'OFF', label: 'Off' },
        ],
        window: { field: 'windowDays', unit: 'days', max: 90 },
        warning: 'CS can create a second live order for the same customer and product.',
      },
    ],
  },
  {
    title: 'Background cleanup',
    rules: [
      {
        key: 'cleanupCron',
        title: 'Duplicate cleanup (every 2 hours)',
        description: 'Early-stage duplicates are deleted, confirmed ones are flagged.',
        modes: [
          { value: 'DELETE', label: 'Delete early-stage, flag the rest' },
          { value: 'FLAG', label: 'Flag only' },
          { value: 'OFF', label: 'Off' },
        ],
        window: { field: 'windowDays', unit: 'days', max: 90 },
        warning: 'Duplicate orders stay in CS queues until someone handles them.',
      },
    ],
  },
  {
    title: 'Cart pipeline',
    rules: [
      {
        key: 'cartPullGuard',
        title: 'Skip carts that already ordered',
        description: 'Abandoned carts are not pulled into cart orders when the customer already ordered.',
        window: { field: 'windowDays', unit: 'days', max: 90 },
        warning: 'Customers who already ordered can also appear as cart orders.',
      },
      {
        key: 'cartReconcile',
        title: 'Cart orders matching a real order',
        description: 'Early-stage cart orders are deleted, later ones are flagged.',
        modes: [
          { value: 'DELETE', label: 'Delete early-stage, flag the rest' },
          { value: 'FLAG', label: 'Flag only' },
          { value: 'OFF', label: 'Off' },
        ],
        warning: 'CS can call the same customer from both Cart Orders and Orders.',
      },
      {
        key: 'cartMerge',
        title: 'One open cart per customer',
        description: 'Older open carts for the same phone are removed.',
        warning: 'One customer can have several open carts.',
      },
    ],
  },
  {
    title: 'Delivery and graduation',
    rules: [
      {
        key: 'preDeliveryCheck',
        title: 'Duplicate delivery check',
        description: 'A cart or follow-up order cannot be marked Delivered when a matching delivery exists.',
        modes: [
          { value: 'BLOCK', label: 'Block' },
          { value: 'OFF', label: 'Off' },
        ],
        window: { field: 'windowDays', unit: 'days', max: 90 },
        warning: 'The same delivery can be recorded twice.',
      },
      {
        key: 'graduationGuard',
        title: 'Graduation guard',
        description: 'A delivered cart or follow-up order is not copied into Orders when a matching order exists.',
        window: { field: 'windowDays', unit: 'days', max: 90 },
        warning: 'Duplicate deliveries count twice in orders, revenue and payroll.',
      },
    ],
  },
];

const ALL_RULES = SECTIONS.flatMap((s) => s.rules);

function ruleValue(rules: DuplicateRules, key: DuplicateRuleKey): Record<string, unknown> {
  return rules[key] as unknown as Record<string, unknown>;
}

function isActive(def: RuleDef, value: Record<string, unknown>): boolean {
  return def.modes ? value.mode !== 'OFF' : value.enabled === true;
}

function describe(def: RuleDef, value: Record<string, unknown>): string {
  const state = def.modes
    ? def.modes.find((m) => m.value === value.mode)?.label ?? String(value.mode)
    : value.enabled ? 'On' : 'Off';
  if (!def.window || !isActive(def, value)) return state;
  return `${state}, ${value[def.window.field]} ${def.window.unit}`;
}

function sameValue(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Free typing; the value is clamped to 1..max only on blur (or Enter), so
 * editing 14 to 30 never passes through a clamped 1 or 130.
 */
function WindowInput({ label, max, value, onCommit }: { label: string; max: number; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    const clamped = Number.isFinite(n) && text.trim() !== '' ? Math.min(max, Math.max(1, n)) : value;
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <TextInput
      label={label}
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      hint={`1 to ${max}`}
    />
  );
}

export function DuplicateRulesPage({ data }: { data: DuplicateRulesData }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const [draft, setDraft] = useState<DuplicateRules>(data.rules);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => setConfirmOpen(false));
  // Re-sync after save: the loader revalidates and hands back the stored value.
  useEffect(() => setDraft(data.rules), [data.rules]);

  const changes = useMemo(
    () => ALL_RULES.filter((def) => !sameValue(ruleValue(draft, def.key), ruleValue(data.rules, def.key))),
    [draft, data.rules],
  );
  const saving = fetcher.state !== 'idle';

  const update = (key: DuplicateRuleKey, patch: Record<string, unknown>) =>
    setDraft((prev) => ({ ...prev, [key]: { ...ruleValue(prev, key), ...patch } }) as DuplicateRules);

  const save = () => {
    const fd = new FormData();
    fd.set('intent', 'save');
    fd.set('rules', JSON.stringify(draft));
    fetcher.submit(fd, { method: 'post' });
  };

  if (!data.companySelected) {
    return (
      <div>
        <PageHeader title="Duplicate rules" description="How repeat orders are handled, per company." backTo="/admin/settings" />
        <EmptyState
          variant="card"
          title="Select a company"
          description="Duplicate rules are set per company. Pick one in the header switcher."
        />
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-0">
      <PageHeader
        title="Duplicate rules"
        description="How repeat orders are handled for this company."
        backTo="/admin/settings"
        mobileInlineActions
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setDraft(data.defaults)} disabled={saving}>
              Reset to defaults
            </Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={changes.length === 0 || saving}>
              Save{changes.length > 0 ? ` (${changes.length})` : ''}
            </Button>
          </div>
        }
      />

      <p className="mb-4 text-xs text-app-fg-muted">
        {data.updatedAt
          ? `Last saved ${new Date(data.updatedAt).toLocaleString()}${data.updatedByName ? ` by ${data.updatedByName}` : ''}.`
          : 'Using defaults. Nothing saved for this company yet.'}
      </p>

      {draft.intakeBlock.mode !== 'BLOCK' && draft.cleanupCron.mode === 'DELETE' && (
        <p className="mb-4 rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-300">
          Repeat orders now become orders, but Duplicate cleanup is still set to delete. It will delete the early-stage
          ones within 2 hours. Set Duplicate cleanup to Flag only to keep them.
        </p>
      )}

      <div className="space-y-4">
        {SECTIONS.map((section) => (
          <section key={section.title} className="card p-0">
            <h2 className="border-b border-app-border px-4 py-3 text-sm font-semibold text-app-fg">{section.title}</h2>
            <ul className="divide-y divide-app-border">
              {section.rules.map((def) => {
                const value = ruleValue(draft, def.key);
                const defaults = ruleValue(data.defaults, def.key);
                const active = isActive(def, value);
                const loosened = !sameValue(value, defaults) && (!active || value.mode === 'FLAG');
                return (
                  <li key={def.key} className="space-y-3 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-app-fg">{def.title}</p>
                        <p className="text-xs text-app-fg-muted">{def.description}</p>
                      </div>
                      {!def.modes && (
                        <ToggleSwitch
                          checked={value.enabled === true}
                          onChange={(checked) => update(def.key, { enabled: checked })}
                          ariaLabel={def.title}
                        />
                      )}
                    </div>
                    {(def.modes || (def.window && active)) && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {def.modes && (
                          <FormSelect
                            label="Action"
                            value={String(value.mode)}
                            onChange={(e) => update(def.key, { mode: e.target.value })}
                            options={def.modes}
                          />
                        )}
                        {def.window && active && (
                          <WindowInput
                            label={`Window (${def.window.unit})`}
                            max={def.window.max}
                            value={Number(value[def.window.field] ?? 1)}
                            onCommit={(n) => update(def.key, { [def.window!.field]: n })}
                          />
                        )}
                      </div>
                    )}
                    <p className="text-xs text-app-fg-muted">Default: {describe(def, defaults)}</p>
                    {loosened && def.warning && (
                      <p className="rounded-md bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-300">
                        {def.warning}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <ConfirmActionModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Save duplicate rules?"
        description="These changes apply to this company within a minute, including the public order form."
        confirmLabel="Save rules"
        variant="warning"
        loading={saving}
        error={fetcher.data?.error ?? null}
        onConfirm={save}
        details={
          <ul className="space-y-1 text-sm">
            {changes.map((def) => (
              <li key={def.key}>
                <span className="font-medium">{def.title}:</span>{' '}
                {describe(def, ruleValue(data.rules, def.key))} to {describe(def, ruleValue(draft, def.key))}
              </li>
            ))}
          </ul>
        }
      />
    </div>
  );
}
