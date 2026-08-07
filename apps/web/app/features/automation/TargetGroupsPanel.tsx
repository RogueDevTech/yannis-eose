import { useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTableActionButton } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { AUTOMATION_SEGMENT_STATUSES } from './targeting-meta';
import type { TargetGroupRow, TargetGroupFilter } from './types';

/** A group being edited in the modal, or the sentinel for "new". */
export type GroupDraft = {
  id: string | null;
  name: string;
  description: string;
  filter: TargetGroupFilter;
  enabled: boolean;
};

export function newGroupDraft(): GroupDraft {
  return { id: null, name: '', description: '', filter: {}, enabled: true };
}

/** Human summary of a group's filter, e.g. "1–2 orders · Delivered · last 90 days". */
function filterSummary(f: TargetGroupFilter): string {
  const parts: string[] = [];
  if (f.minOrders != null || f.maxOrders != null) {
    if (f.minOrders != null && f.maxOrders != null) parts.push(`${f.minOrders}–${f.maxOrders} orders`);
    else if (f.minOrders != null) parts.push(`${f.minOrders}+ orders`);
    else parts.push(`up to ${f.maxOrders} orders`);
  }
  if (f.statuses?.length) parts.push(f.statuses.join(', '));
  if (f.orderSource && f.orderSource !== 'any') parts.push(f.orderSource === 'edge-form' ? 'Edge form' : 'Offline');
  if (f.sinceDays != null) parts.push(`last ${f.sinceDays} days`);
  return parts.length ? parts.join(' · ') : 'All customers';
}

export function TargetGroupsPanel({
  groups,
  busy,
  onNew,
  onEdit,
  onSync,
  onArchive,
}: {
  groups: TargetGroupRow[];
  busy: boolean;
  onNew: () => void;
  onEdit: (g: TargetGroupRow) => void;
  onSync: (g: TargetGroupRow) => void;
  onArchive: (g: TargetGroupRow) => void;
}) {
  const navigate = useNavigate();
  if (groups.length === 0) {
    return (
      <div className="list-panel p-8 text-center space-y-3">
        <p className="text-sm text-app-fg-muted">
          No target groups yet. Create one to build a reusable audience (e.g. first-time customers) that
          automations can send to.
        </p>
        <Button variant="primary" size="sm" onClick={onNew}>
          New target group
        </Button>
      </div>
    );
  }
  return (
    <div className="list-panel divide-y divide-app-border">
      {groups.map((g) => (
        <div key={g.id} className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-app-fg truncate">{g.name}</span>
              <StatusBadge status={g.enabled ? 'ENABLED' : 'DISABLED'} />
              <span className="text-xs tabular-nums text-app-fg-muted">
                {g.memberCount.toLocaleString()} {g.memberCount === 1 ? 'member' : 'members'}
              </span>
            </div>
            <p className="mt-1 text-xs text-app-fg-muted">{filterSummary(g.filter)}</p>
            {g.description && <p className="mt-0.5 text-xs text-app-fg-muted line-clamp-1">{g.description}</p>}
          </div>
          <div data-no-row-click className="flex shrink-0 items-center gap-1">
            {/* Sync re-materializes a RULE group; it's a no-op on UPLOAD/MANUAL groups, so hide it there. */}
            {g.sourceKind === 'RULE' && (
              <CompactTableActionButton disabled={busy} onClick={() => onSync(g)}>
                Sync
              </CompactTableActionButton>
            )}
            <CompactTableActionButton onClick={() => navigate(`/admin/marketing/automation/groups/${g.id}/import`)}>
              Import
            </CompactTableActionButton>
            <TableActionButton onClick={() => onEdit(g)}>Edit</TableActionButton>
            <CompactTableActionButton tone="danger" onClick={() => onArchive(g)}>
              Archive
            </CompactTableActionButton>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Create/edit modal with the RULE filter builder. */
export function TargetGroupModal({
  draft,
  busy,
  error,
  onClose,
  onSave,
}: {
  draft: GroupDraft;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (d: GroupDraft) => void;
}) {
  const [d, setD] = useState<GroupDraft>(draft);
  const canSave = d.name.trim().length >= 2;
  const setFilter = (patch: Partial<TargetGroupFilter>) => setD((prev) => ({ ...prev, filter: { ...prev.filter, ...patch } }));
  const toggleStatus = (s: string) =>
    setD((prev) => {
      const cur = new Set(prev.filter.statuses ?? []);
      cur.has(s) ? cur.delete(s) : cur.add(s);
      return { ...prev, filter: { ...prev.filter, statuses: cur.size ? [...cur] : undefined } };
    });
  const numOrEmpty = (v: number | undefined) => (v == null ? '' : String(v));

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" contentClassName="p-5">
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-app-fg">{d.id ? 'Edit target group' : 'New target group'}</h3>
        <div>
          <label className="mb-1 block text-sm font-medium text-app-fg-muted">Name</label>
          <TextInput value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. First-time customers" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-app-fg-muted">Description (optional)</label>
          <TextInput value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="What this audience is for" />
        </div>

        <div className="rounded-lg border border-app-border bg-app-surface p-3 space-y-3">
          <p className="text-sm font-medium text-app-fg-muted">Who's in this group</p>

          {/* Order count */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-app-fg-muted">Min orders</label>
              <input
                type="number"
                min={1}
                value={numOrEmpty(d.filter.minOrders)}
                onChange={(e) => setFilter({ minOrders: e.target.value ? Number(e.target.value) : undefined })}
                className="input"
                placeholder="e.g. 1"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-app-fg-muted">Max orders</label>
              <input
                type="number"
                min={1}
                value={numOrEmpty(d.filter.maxOrders)}
                onChange={(e) => setFilter({ maxOrders: e.target.value ? Number(e.target.value) : undefined })}
                className="input"
                placeholder="e.g. 2"
              />
            </div>
          </div>

          {/* Statuses */}
          <div>
            <label className="mb-1.5 block text-xs text-app-fg-muted">Order statuses (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              {AUTOMATION_SEGMENT_STATUSES.map((s) => {
                const on = (d.filter.statuses ?? []).includes(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleStatus(s.value)}
                    className={[
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      on
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300'
                        : 'border-app-border text-app-fg-muted hover:border-app-border-strong',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Source + recency */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-app-fg-muted">Source</label>
              <FormSelect
                value={d.filter.orderSource ?? 'any'}
                onChange={(e) => setFilter({ orderSource: e.target.value as TargetGroupFilter['orderSource'] })}
                options={[
                  { value: 'any', label: 'Any source' },
                  { value: 'edge-form', label: 'Edge form' },
                  { value: 'offline', label: 'Offline' },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-app-fg-muted">Ordered within (days)</label>
              <input
                type="number"
                min={1}
                value={numOrEmpty(d.filter.sinceDays)}
                onChange={(e) => setFilter({ sinceDays: e.target.value ? Number(e.target.value) : undefined })}
                className="input"
                placeholder="e.g. 90"
              />
            </div>
          </div>
          <p className="text-xs text-app-fg-muted">
            Members auto-update on a schedule as customers newly match. Leave everything blank to include all customers.
          </p>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-app-fg">
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => setD({ ...d, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300"
          />
          Enabled (keeps syncing new members)
        </label>

        {error && <p className="text-sm text-danger-600 dark:text-danger-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="primary" size="sm" loading={busy} loadingText="Saving…" disabled={!canSave} onClick={() => onSave(d)}>
            {d.id ? 'Save changes' : 'Create group'}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
