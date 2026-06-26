import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable } from '~/components/ui/compact-table';
import { Tabs } from '~/components/ui/tabs';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { EmptyState } from '~/components/ui/empty-state';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

// ── Types ────────────────────────────────────────────────────────────

interface RoutingRule {
  id: string;
  name: string;
  sourceBranchId: string | null;
  sourceBranchName: string | null;
  targetBranchId: string | null;
  targetBranchName: string | null;
  priority: number;
  enabled: boolean;
}

interface Branch { id: string; name: string; status?: string }

interface SyncLog {
  id: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  totalPulled: number;
  fallbackCount: number;
  ruleResults: Array<{ ruleId: string; ruleName: string; pulled: number }> | null;
  errorMessage: string | null;
}

interface Props {
  rules: RoutingRule[];
  branches: Branch[];
  syncLogs: SyncLog[];
}

// ── Component ───────────────────────────────────────────────────────

export function CartOrderRoutingPage({ rules, branches, syncLogs }: Props) {
  const [tab, setTab] = useState('rules');
  const [editRule, setEditRule] = useState<RoutingRule | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoutingRule | null>(null);

  const syncFetcher = useFetcher();
  useFetcherToast(syncFetcher, { successMessage: 'Cart orders synced' });
  const isSyncing = syncFetcher.state !== 'idle';

  return (
    <div>
      <PageHeader
        title="Cart Order Routing"
        description="Configure which branch receives cart orders pulled from abandoned carts."
        backTo="/admin/settings"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => syncFetcher.submit({ intent: 'syncNow' }, { method: 'POST' })}
              disabled={isSyncing}
            >
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              Add rule
            </Button>
          </div>
        }
        mobileInlineActions
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'rules', label: 'Routing Rules' },
          { value: 'logs', label: 'Sync Logs' },
        ]}
      />

      {tab === 'rules' && (
        <RulesTab
          rules={rules}
          onEdit={setEditRule}
          onDelete={setDeleteTarget}
        />
      )}

      {tab === 'logs' && <LogsTab logs={syncLogs} />}

      {(showCreate || editRule) && (
        <RuleFormModal
          rule={editRule}
          branches={branches}
          onClose={() => { setShowCreate(false); setEditRule(null); }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          rule={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// ── Rules Tab ───────────────────────────────────────────────────────

function RulesTab({
  rules,
  onEdit,
  onDelete,
}: {
  rules: RoutingRule[];
  onEdit: (r: RoutingRule) => void;
  onDelete: (r: RoutingRule) => void;
}) {
  if (rules.length === 0) {
    return (
      <EmptyState
        title="No routing rules"
        description="Cart orders will use the campaign's branch as fallback. Add a rule to route them to a specific branch."
      />
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="flex flex-col gap-2 sm:hidden">
        {rules.map((r) => (
          <button
            key={r.id}
            type="button"
            className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left dark:border-gray-700 dark:bg-gray-800"
            onClick={() => onEdit(r)}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{r.name}</span>
              <StatusBadge status={r.enabled ? 'ACTIVE' : 'INACTIVE'} />
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {r.sourceBranchName ?? 'All branches'} → {r.targetBranchName ?? 'Round-robin'}
            </div>
            <div className="mt-1 text-xs text-gray-400">Priority: {r.priority}</div>
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <CompactTable
          rowKey={(r: RoutingRule) => r.id}
          columns={[
            { key: 'priority', header: '#', render: (r: RoutingRule) => <span className="text-xs text-gray-500">{r.priority}</span>, className: 'w-12 text-center' },
            { key: 'name', header: 'Rule Name', render: (r: RoutingRule) => <span className="font-medium text-sm">{r.name}</span> },
            { key: 'source', header: 'Source', render: (r: RoutingRule) => r.sourceBranchName ?? 'All branches' },
            { key: 'target', header: 'Target', render: (r: RoutingRule) => r.targetBranchName ?? 'Round-robin' },
            { key: 'enabled', header: '', render: (r: RoutingRule) => <StatusBadge status={r.enabled ? 'ACTIVE' : 'INACTIVE'} /> },
            {
              key: 'actions', header: '',
              render: (r: RoutingRule) => (
                <div className="flex gap-1">
                  <TableActionButton onClick={() => onEdit(r)}>Edit</TableActionButton>
                  <TableActionButton variant="danger" onClick={() => onDelete(r)}>Delete</TableActionButton>
                </div>
              ),
            },
          ]}
          rows={rules}
        />
      </div>
    </>
  );
}

// ── Rule Form Modal ─────────────────────────────────────────────────

function RuleFormModal({
  rule,
  branches,
  onClose,
}: {
  rule: RoutingRule | null;
  branches: Branch[];
  onClose: () => void;
}) {
  const isEdit = !!rule;
  const fetcher = useFetcher();
  useFetcherToast(fetcher, { successMessage: isEdit ? 'Rule updated' : 'Rule created' });
  useCloseOnFetcherSuccess(fetcher, onClose);

  const [name, setName] = useState(rule?.name ?? '');
  const [sourceBranchId, setSourceBranchId] = useState<string | null>(rule?.sourceBranchId ?? null);
  const [targetBranchId, setTargetBranchId] = useState<string | null>(rule?.targetBranchId ?? null);
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const branchOptions = branches
    .filter((b) => !b.status || b.status === 'ACTIVE')
    .map((b) => ({ value: b.id, label: b.name }));

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {
      name,
      sourceBranchId: sourceBranchId || null,
      targetBranchId: targetBranchId || null,
      priority: parseInt(priority, 10) || 0,
      enabled,
    };
    if (isEdit) payload.ruleId = rule.id;

    fetcher.submit(
      { intent: isEdit ? 'updateRule' : 'createRule', json: JSON.stringify(payload) },
      { method: 'POST' },
    );
  };

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg">
      <div className="border-b border-app-border px-4 pt-4 pb-3">
        <h2 className="text-lg font-semibold text-app-fg">{isEdit ? 'Edit routing rule' : 'New routing rule'}</h2>
      </div>
      <div className="space-y-4 p-4">
        <TextInput
          label="Rule name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='e.g. "Lagos carts to Lagos CS"'
        />

        <SearchableSelect
          label="Source branch (marketing)"
          placeholder="All branches (no filter)"
          options={branchOptions}
          value={sourceBranchId ?? ''}
          onChange={(v) => setSourceBranchId(v || null)}
          clearable
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
          Only route carts from campaigns in this branch. Leave empty to match all.
        </p>

        <SearchableSelect
          label="Target branch (CS)"
          placeholder="Round-robin across all CS branches"
          options={branchOptions}
          value={targetBranchId ?? ''}
          onChange={(v) => setTargetBranchId(v || null)}
          clearable
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
          Route matching cart orders to this branch. Leave empty for round-robin.
        </p>

        <TextInput
          label="Priority"
          type="number"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          placeholder="0"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
          Higher number = evaluated first. First matching rule wins.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          Enabled
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-app-border px-4 py-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          disabled={!name.trim() || fetcher.state !== 'idle'}
        >
          {fetcher.state !== 'idle' ? 'Saving…' : isEdit ? 'Save' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Delete Confirm Modal ────────────────────────────────────────────

function DeleteConfirmModal({
  rule,
  onClose,
}: {
  rule: RoutingRule;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher, { successMessage: 'Rule deleted' });
  useCloseOnFetcherSuccess(fetcher, onClose);

  return (
    <Modal open onClose={onClose} maxWidth="max-w-sm">
      <div className="p-4">
        <h2 className="text-lg font-semibold text-app-fg">Delete routing rule</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          Delete rule <strong>{rule.name}</strong>? Cart orders will no longer be routed by this rule.
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-app-border px-4 py-3">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          onClick={() =>
            fetcher.submit({ intent: 'deleteRule', ruleId: rule.id }, { method: 'POST' })
          }
          disabled={fetcher.state !== 'idle'}
        >
          {fetcher.state !== 'idle' ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </Modal>
  );
}

// ── Logs Tab ────────────────────────────────────────────────────────

function LogsTab({ logs }: { logs: SyncLog[] }) {
  if (logs.length === 0) {
    return (
      <EmptyState
        title="No sync logs"
        description="Sync logs appear after the first auto-pull or manual sync."
      />
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="flex flex-col gap-2 sm:hidden">
        {logs.map((log) => (
          <div key={log.id} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {new Date(log.startedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <StatusBadge status={log.triggeredBy === 'cron' ? 'ACTIVE' : 'PENDING'} label={log.triggeredBy === 'cron' ? 'Auto' : 'Manual'} />
            </div>
            <div className="mt-1 text-sm font-medium">
              {log.totalPulled} pulled{log.fallbackCount > 0 ? ` (${log.fallbackCount} fallback)` : ''}
            </div>
            {log.ruleResults?.length ? (
              <div className="mt-1 text-xs text-gray-400">
                {log.ruleResults.map((r) => `${r.ruleName}: ${r.pulled}`).join(', ')}
              </div>
            ) : null}
            {log.errorMessage && (
              <div className="mt-1 text-xs text-red-500">{log.errorMessage}</div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block">
        <CompactTable
          rowKey={(log: SyncLog) => log.id}
          columns={[
            {
              key: 'time', header: 'Time',
              render: (log: SyncLog) => (
                <span className="text-xs whitespace-nowrap">
                  {new Date(log.startedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              ),
            },
            {
              key: 'trigger', header: 'Trigger',
              render: (log: SyncLog) => <StatusBadge status={log.triggeredBy === 'cron' ? 'ACTIVE' : 'PENDING'} label={log.triggeredBy === 'cron' ? 'Auto' : 'Manual'} />,
            },
            { key: 'pulled', header: 'Pulled', render: (log: SyncLog) => <span className="font-medium tabular-nums">{log.totalPulled}</span>, className: 'w-20 text-right' },
            { key: 'fallback', header: 'Fallback', render: (log: SyncLog) => <span className="tabular-nums text-gray-500">{log.fallbackCount}</span>, className: 'w-20 text-right' },
            {
              key: 'details', header: 'Rules',
              render: (log: SyncLog) => log.ruleResults?.length
                ? <span className="text-xs text-gray-500">{log.ruleResults.map((r) => `${r.ruleName}: ${r.pulled}`).join(', ')}</span>
                : <span className="text-xs text-gray-400">—</span>,
            },
          ]}
          rows={logs}
        />
      </div>
    </>
  );
}
