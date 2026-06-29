import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { useSocketEvent } from '~/hooks/useSocket';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { CompactTable } from '~/components/ui/compact-table';
import { Tabs } from '~/components/ui/tabs';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { GroupFormModal } from '~/features/cs/FollowUpGroupsPage';
import type { FollowUpGroupItem, CloserWithBranches } from '~/features/cs/FollowUpGroupsPage';

// ── Types ────────────────────────────────────────────────────────────

interface Rule {
  id: string;
  name: string;
  sourceStatus: string;
  ageThresholdDays: number;
  ageThresholdHours: number | null;
  maxAgeDays: number | null;
  ageRelativeTo: string;
  sourceBranchId: string | null;
  sourceBranchName: string | null;
  targetBranchId: string | null;
  targetBranchName: string | null;
  targetGroupId: string | null;
  targetGroupName: string | null;
  priority: number;
  enabled: boolean;
  freezeOriginal: boolean;
}

interface Branch { id: string; name: string; status?: string }
interface Group { id: string; name: string }

interface SyncLog {
  id: string;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  totalPulled: number;
  ruleResults: Array<{ ruleId: string; ruleName: string; pulled: number }> | null;
  errorMessage: string | null;
}

interface Props {
  rules: Rule[];
  branches: Branch[];
  groups: Group[];
  syncLogs: SyncLog[];
  followUpGroups?: FollowUpGroupItem[];
  closers?: CloserWithBranches[];
  excludedIds?: string[];
  activeCsBranchIds?: string[];
}

const STATUS_OPTIONS = [
  // CART_ABANDONMENT removed — cart orders now have a standalone page.
  { value: 'UNPROCESSED', label: 'Unassigned' },
  { value: 'CS_ASSIGNED', label: 'Assigned' },
  { value: 'CS_ENGAGED', label: 'Unconfirmed' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'AGENT_ASSIGNED', label: 'Agent Assigned' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'REMITTED', label: 'Cash Remitted' },
];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

const AGE_OPTIONS = [
  { value: 'h:1', label: '1 hour' }, { value: 'h:2', label: '2 hours' }, { value: 'h:4', label: '4 hours' },
  { value: 'h:6', label: '6 hours' }, { value: 'h:8', label: '8 hours' }, { value: 'h:12', label: '12 hours' },
  { value: '1', label: '1 day' }, { value: '2', label: '2 days' }, { value: '3', label: '3 days' }, { value: '5', label: '5 days' }, { value: '7', label: '7 days' }, { value: '10', label: '10 days' },
  { value: '14', label: '14 days' }, { value: '21', label: '21 days' }, { value: '30', label: '30 days' },
  { value: '45', label: '45 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' },
  { value: '120', label: '120 days' }, { value: '180', label: '180 days' }, { value: '365', label: '365 days' },
];

const AGE_RELATIVE_TO_OPTIONS = [
  { value: 'STATUS_TIMESTAMP', label: 'Status date (e.g. confirmed date)' },
  { value: 'CREATED_AT', label: 'Order creation date' },
  { value: 'PREFERRED_DELIVERY_DATE', label: 'Scheduled delivery date' },
];

const AGE_RELATIVE_TO_LABEL: Record<string, string> = Object.fromEntries(AGE_RELATIVE_TO_OPTIONS.map((o) => [o.value, o.label]));

/** Encode rule age into the combo value used by the age dropdown. */
function ageToValue(r: { ageThresholdHours?: number | null; ageThresholdDays: number }): string {
  return r.ageThresholdHours ? `h:${r.ageThresholdHours}` : String(r.ageThresholdDays);
}

/** Decode the combo dropdown value into hours / days. */
function parseAgeValue(v: string): { ageThresholdDays: number; ageThresholdHours: number | null } {
  if (v.startsWith('h:')) {
    const hours = parseInt(v.slice(2), 10);
    return { ageThresholdDays: 1, ageThresholdHours: hours };
  }
  return { ageThresholdDays: parseInt(v, 10), ageThresholdHours: null };
}

function formatAge(r: Rule) {
  if (r.ageThresholdHours) {
    return r.maxAgeDays ? `${r.ageThresholdHours}h–${r.maxAgeDays}d` : `>${r.ageThresholdHours}h`;
  }
  return r.maxAgeDays ? `${r.ageThresholdDays}–${r.maxAgeDays}d` : `>${r.ageThresholdDays}d`;
}

export function FollowUpConfigPage({ rules, branches, groups, syncLogs, followUpGroups = [], closers = [], excludedIds = [], activeCsBranchIds = [] }: Props) {
  const [tab, setTab] = useState('rules');
  const [modalOpen, setModalOpen] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [deleteRuleTarget, setDeleteRuleTarget] = useState<Rule | null>(null);
  const [viewRule, setViewRule] = useState<Rule | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(50);
  const [breakdownLog, setBreakdownLog] = useState<SyncLog | null>(null);
  const [syncErrorModal, setSyncErrorModal] = useState<string | null>(null);
  const [syncPreview, setSyncPreview] = useState<Array<{ ruleId: string; ruleName: string; eligible: number }> | null>(null);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const rev = useRevalidator();

  // ── Real-time sync progress ─────────────────────────────────────
  type SyncProgressData = {
    syncId: string;
    triggeredBy: 'cron' | 'manual';
    startedAt: string;
    totalRules: number;
    currentRuleIndex: number;
    currentRuleName: string;
    currentRulePulled: number;
    totalPulledSoFar: number;
    ruleResults: Array<{ ruleName: string; pulled: number }>;
    status: 'running' | 'complete' | 'error';
    errorMessage?: string;
  };
  const [syncProgress, setSyncProgress] = useState<SyncProgressData | null>(null);
  const syncCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: check if a sync is already running (Redis-backed persistence)
  useEffect(() => {
    fetch('/trpc/orders.followUpConfigSyncStatus', { credentials: 'include' })
      .then((res) => res.ok ? res.json() : null)
      .then((json) => {
        const data = json?.result?.data;
        if (data && data.status === 'running') setSyncProgress(data);
      })
      .catch(() => {});
  }, []);

  // Socket.io: real-time progress updates
  useSocketEvent('followup:sync_progress', useCallback((data: SyncProgressData) => {
    if (data.status === 'complete') {
      setSyncProgress(data);
      // Show "Complete" for 3 seconds, then clear and refresh history
      if (syncCompleteTimerRef.current) clearTimeout(syncCompleteTimerRef.current);
      syncCompleteTimerRef.current = setTimeout(() => {
        setSyncProgress(null);
        rev.revalidate();
      }, 3000);
    } else if (data.status === 'error') {
      setSyncProgress(data);
      if (syncCompleteTimerRef.current) clearTimeout(syncCompleteTimerRef.current);
      syncCompleteTimerRef.current = setTimeout(() => {
        setSyncProgress(null);
        rev.revalidate();
      }, 5000);
    } else {
      setSyncProgress(data);
    }
  }, [rev]));

  // Cleanup timer
  useEffect(() => () => { if (syncCompleteTimerRef.current) clearTimeout(syncCompleteTimerRef.current); }, []);

  const isSyncRunning = syncProgress?.status === 'running';

  const [name, setName] = useState('');
  const [sourceStatus, setSourceStatus] = useState('CONFIRMED');
  const [ageValue, setAgeValue] = useState('7');
  const [maxAgeDays, setMaxAgeDays] = useState<number | null>(null);
  const [ageRelativeTo, setAgeRelativeTo] = useState('STATUS_TIMESTAMP');
  const [sourceBranchId, setSourceBranchId] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<'all' | 'branch' | 'group'>('all');
  const [targetBranchId, setTargetBranchId] = useState<string | null>(null);
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [freezeOriginal, setFreezeOriginal] = useState(true);

  const saveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(saveFetcher.data, { successMessage: editRule ? 'Rule updated' : 'Rule created' });
  useCloseOnFetcherSuccess(saveFetcher, () => { setModalOpen(false); setEditRule(null); rev.revalidate(); });

  const deleteFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(deleteFetcher.data, { successMessage: 'Rule deleted' });
  useCloseOnFetcherSuccess(deleteFetcher, () => { setDeleteRuleTarget(null); rev.revalidate(); });

  const syncFetcher = useFetcher<{ success?: boolean; error?: string; totalPulled?: number }>();
  useFetcherToast(syncFetcher.data, {
    successMessage: syncFetcher.data?.totalPulled != null ? `Sync complete: ${syncFetcher.data.totalPulled} orders pulled` : 'Sync complete',
  });

  const createGroupFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(createGroupFetcher.data, { successMessage: 'Group created' });
  useCloseOnFetcherSuccess(createGroupFetcher, () => { setCreateGroupOpen(false); rev.revalidate(); });

  const openCreate = () => {
    setEditRule(null); setName(''); setSourceStatus('CONFIRMED'); setAgeValue('7'); setMaxAgeDays(null);
    setAgeRelativeTo('STATUS_TIMESTAMP'); setSourceBranchId(null); setTargetType('all'); setTargetBranchId(null); setTargetGroupId(null);
    setEnabled(true); setFreezeOriginal(true); setModalOpen(true);
  };
  const openEdit = (rule: Rule) => {
    setEditRule(rule); setName(rule.name); setSourceStatus(rule.sourceStatus);
    setAgeValue(ageToValue(rule)); setMaxAgeDays(rule.maxAgeDays ?? null); setAgeRelativeTo(rule.ageRelativeTo ?? 'STATUS_TIMESTAMP');
    setSourceBranchId(rule.sourceBranchId);
    setTargetType(rule.targetBranchId ? 'branch' : rule.targetGroupId ? 'group' : 'all');
    setTargetBranchId(rule.targetBranchId); setTargetGroupId(rule.targetGroupId);
    setEnabled(rule.enabled); setFreezeOriginal(rule.freezeOriginal ?? true); setModalOpen(true);
  };
  const handleSave = () => {
    const parsed = parseAgeValue(ageValue);
    const payload: Record<string, unknown> = {
      name, sourceStatus, ageThresholdDays: parsed.ageThresholdDays, ageThresholdHours: parsed.ageThresholdHours, maxAgeDays: maxAgeDays || null, ageRelativeTo, sourceBranchId: sourceBranchId || null,
      targetBranchId: targetType === 'branch' ? targetBranchId : null,
      targetGroupId: targetType === 'group' ? targetGroupId : null,
      targetAll: targetType === 'all',
      priority: 0, enabled, freezeOriginal,
    };
    if (editRule) payload.ruleId = editRule.id;
    const fd = new FormData();
    fd.set('intent', editRule ? 'updateRule' : 'createRule');
    fd.set('json', JSON.stringify(payload));
    saveFetcher.submit(fd, { method: 'post' });
  };
  const confirmDelete = () => {
    if (!deleteRuleTarget) return;
    const fd = new FormData(); fd.set('intent', 'deleteRule'); fd.set('ruleId', deleteRuleTarget.id);
    deleteFetcher.submit(fd, { method: 'post' });
  };
  const handleSyncPreview = async () => {
    setSyncPreviewLoading(true);
    try {
      const res = await fetch('/trpc/orders.followUpConfigDryRun', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        const data = json?.result?.data ?? [];
        setSyncPreview(Array.isArray(data) ? data : []);
      } else {
        setSyncPreview([]);
      }
    } catch {
      setSyncPreview([]);
    } finally {
      setSyncPreviewLoading(false);
    }
  };
  const handleSyncConfirm = () => {
    setSyncPreview(null);
    setTab('history');
    const fd = new FormData(); fd.set('intent', 'syncNow');
    syncFetcher.submit(fd, { method: 'post' });
  };

  const activeCsSet = new Set(activeCsBranchIds);
  const branchOptions = (branches ?? [])
    .filter((b: Branch) => b.status !== 'INACTIVE' && activeCsSet.has(b.id))
    .map((b: Branch) => ({ value: b.id, label: b.name }));
  const groupOptions = (groups ?? []).map((g: Group) => ({ value: g.id, label: g.name }));
  const isSyncing = syncFetcher.state !== 'idle';
  const safeRules = rules ?? [];
  const ruleTargetMap = new Map(safeRules.map((r) => [r.id, r.targetBranchName ?? r.targetGroupName ?? 'All branches']));
  const knownRuleIds = new Set(safeRules.map((r) => r.id));
  const [historyFilter, setHistoryFilter] = useState<'all' | 'with_data' | 'empty'>('all');
  const allLogs = syncLogs ?? [];
  const visibleLogs = historyFilter === 'all'
    ? allLogs
    : historyFilter === 'with_data'
      ? allLogs.filter((l) => l.totalPulled > 0 || l.errorMessage)
      : allLogs.filter((l) => l.totalPulled === 0 && !l.errorMessage);
  const historyTotalPages = Math.max(1, Math.ceil(visibleLogs.length / historyPageSize));
  const paginatedLogs = visibleLogs.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow Up Order Config"
        description="Auto-pull stale orders for CS follow-up."
        backTo="/admin/settings"
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Config tools"
            desktop={
              <>
                <Button size="sm" variant="secondary" onClick={handleSyncPreview} disabled={isSyncing || syncPreviewLoading || isSyncRunning} loading={syncPreviewLoading} loadingText="Checking...">Sync Now</Button>
                <Button size="sm" variant="secondary" onClick={openCreate}>Add Rule</Button>
                <Button size="sm" onClick={() => setCreateGroupOpen(true)}>Add Group</Button>
              </>
            }
            sheet={
              <>
                <Button size="sm" variant="secondary" className="w-full" onClick={handleSyncPreview} disabled={isSyncing || syncPreviewLoading || isSyncRunning} loading={syncPreviewLoading} loadingText="Checking...">Sync Now</Button>
                <Button size="sm" variant="secondary" className="w-full mt-2" onClick={openCreate}>Add Rule</Button>
                <Button size="sm" className="w-full mt-2" onClick={() => setCreateGroupOpen(true)}>Add Group</Button>
              </>
            }
          />
        }
        mobileInlineActions
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'rules', label: 'Rules' },
          { value: 'groups', label: 'Groups & Branches' },
          { value: 'history', label: 'Sync History' },
        ]}
      />

      {/* ── Rules Tab ───────────────────────────────────────────── */}
      {tab === 'rules' && (
        <>
          {safeRules.length === 0 ? (
            <EmptyState
              title="No rules configured"
              description="Add a rule to start auto-pulling stale orders."
              action={<Button size="sm" onClick={openCreate}>Add Rule</Button>}
            />
          ) : (
            <>
              {/* Mobile cards */}
              <div className="sm:hidden space-y-2">
                {safeRules.map((r) => (
                  <div key={r.id} className="rounded-lg border border-app-border bg-app-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-app-fg truncate">{r.name}</span>
                      <StatusBadge status={r.enabled ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-app-fg-muted">
                      {r.sourceStatus === 'CART_ABANDONMENT' ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">Cart</span>
                      ) : (
                        <OrderStatusBadge status={r.sourceStatus} expanded />
                      )}
                      <span>{formatAge(r)}</span>
                      <span>from {r.sourceBranchName ?? 'All'}</span>
                      <span>→ {r.targetBranchName ?? r.targetGroupName ?? 'All branches'}</span>
                      {r.freezeOriginal === false && (
                        <span className="inline-flex items-center rounded-full bg-cyan-100 dark:bg-cyan-900/30 px-2 py-0.5 text-micro font-medium text-cyan-700 dark:text-cyan-300">No freeze</span>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <TableActionButton onClick={() => setViewRule(r)}>View</TableActionButton>
                      <TableActionButton onClick={() => openEdit(r)}>Edit</TableActionButton>
                      <TableActionButton variant="danger" onClick={() => setDeleteRuleTarget(r)}>Delete</TableActionButton>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block">
                <CompactTable
                  rowKey={(r: Rule) => r.id}
                  columns={[
                    { key: 'name', header: 'Name', render: (r: Rule) => r.name },
                    { key: 'sourceStatus', header: 'Status', render: (r: Rule) => r.sourceStatus === 'CART_ABANDONMENT' ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">Cart</span>
                      ) : (
                        <OrderStatusBadge status={r.sourceStatus} expanded />
                      ) },
                    { key: 'age', header: 'Age', render: (r: Rule) => formatAge(r) },
                    { key: 'sourceBranch', header: 'From', render: (r: Rule) => r.sourceBranchName ?? 'All' },
                    { key: 'target', header: 'Target', render: (r: Rule) => r.targetBranchName ?? r.targetGroupName ?? 'All branches' },
                    { key: 'freeze', header: 'Freeze', render: (r: Rule) => (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium ${
                        r.freezeOriginal !== false
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                      }`}>
                        {r.freezeOriginal !== false ? 'Freeze' : 'No freeze'}
                      </span>
                    ) },
                    { key: 'enabled', header: '', render: (r: Rule) => <StatusBadge status={r.enabled ? 'ACTIVE' : 'INACTIVE'} /> },
                    {
                      key: 'actions', header: '',
                      render: (r: Rule) => (
                        <div className="flex gap-1">
                          <TableActionButton onClick={() => setViewRule(r)}>View</TableActionButton>
                          <TableActionButton onClick={() => openEdit(r)}>Edit</TableActionButton>
                          <TableActionButton variant="danger" onClick={() => setDeleteRuleTarget(r)}>Delete</TableActionButton>
                        </div>
                      ),
                    },
                  ]}
                  rows={safeRules}
                />
              </div>
            </>
          )}
        </>
      )}

      {/* ── Groups & Branches Tab ─────────────────────────────── */}
      {tab === 'groups' && (
        <GroupsAndBranchesTab
          branches={branches}
          followUpGroups={followUpGroups}
          closers={closers}
          excludedIds={excludedIds}
          activeCsBranchIds={activeCsBranchIds}
          createGroupFetcher={createGroupFetcher}
          onCreateGroup={() => setCreateGroupOpen(true)}
        />
      )}

      {/* ── Sync History Tab ────────────────────────────────────── */}
      {tab === 'history' && (
        <>
          {/* Live sync progress bar */}
          {syncProgress && (
            <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-app-fg">
                    {syncProgress.status === 'complete'
                      ? `Sync complete — ${syncProgress.totalPulledSoFar} orders pulled`
                      : syncProgress.status === 'error'
                        ? `Sync error — ${syncProgress.totalPulledSoFar} orders pulled before failure`
                        : `Syncing... Rule ${syncProgress.currentRuleIndex} of ${syncProgress.totalRules}`}
                  </p>
                  <p className="text-xs text-app-fg-muted mt-0.5 truncate">
                    {syncProgress.status === 'running'
                      ? `${syncProgress.currentRuleName} — ${syncProgress.totalPulledSoFar} orders pulled so far`
                      : syncProgress.status === 'error'
                        ? syncProgress.errorMessage ?? 'Unknown error'
                        : `${syncProgress.ruleResults.length} rules processed`}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  syncProgress.status === 'complete'
                    ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                    : syncProgress.status === 'error'
                      ? 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                      : 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                }`}>
                  {syncProgress.status === 'complete' ? 'Done' : syncProgress.status === 'error' ? 'Error' : 'Running'}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-2 w-full rounded-full bg-app-hover overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    syncProgress.status === 'complete'
                      ? 'bg-success-500'
                      : syncProgress.status === 'error'
                        ? 'bg-danger-500'
                        : 'bg-brand-500'
                  }`}
                  style={{
                    width: syncProgress.totalRules > 0
                      ? `${Math.round((syncProgress.currentRuleIndex / syncProgress.totalRules) * 100)}%`
                      : '5%',
                  }}
                />
              </div>
              {/* Per-rule breakdown (live) */}
              {syncProgress.ruleResults.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-app-fg-muted">
                  {syncProgress.ruleResults.filter((r: { ruleName: string }) => !r.ruleName.toLowerCase().includes('cart')).map((r) => (
                    <span key={r.ruleName}>
                      {r.ruleName}: <span className="font-semibold text-app-fg">{r.pulled}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {([
              { value: 'all' as const, label: `All (${allLogs.length})` },
              { value: 'with_data' as const, label: `With data (${allLogs.filter((l) => l.totalPulled > 0 || l.errorMessage).length})` },
              { value: 'empty' as const, label: `Empty (${allLogs.filter((l) => l.totalPulled === 0 && !l.errorMessage).length})` },
            ]).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setHistoryFilter(opt.value); setHistoryPage(1); }}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  historyFilter === opt.value
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'border-app-border text-app-fg-muted hover:bg-app-hover'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {visibleLogs.length === 0 ? (
            <EmptyState title="No sync runs" description={historyFilter === 'with_data' ? 'No syncs pulled any orders yet.' : historyFilter === 'empty' ? 'No empty sync runs.' : 'No sync runs yet.'} />
          ) : (
            <>
              {/* Mobile cards */}
              <div className="sm:hidden space-y-2">
                {paginatedLogs.map((l) => (
                  <div key={l.id} className="rounded-lg border border-app-border bg-app-card p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-app-fg">
                        {l.startedAt ? new Date(l.startedAt).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                      <span className="text-xs text-app-fg-muted">{l.triggeredBy === 'cron' ? 'Auto' : 'Manual'}</span>
                    </div>
                    <p className="text-sm font-semibold text-app-fg">{l.totalPulled} orders pulled</p>
                    {l.errorMessage && (
                      <button
                        type="button"
                        onClick={() => setSyncErrorModal(l.errorMessage!)}
                        className="inline-flex items-center gap-1 text-danger-600 dark:text-danger-400 text-xs"
                      >
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                        </svg>
                        View error
                      </button>
                    )}
                    <div className="flex items-center gap-3 pt-1">
                      {l.ruleResults?.length ? (
                        <button type="button" onClick={() => setBreakdownLog(l)} className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">
                          View breakdown
                        </button>
                      ) : null}
                      {l.totalPulled > 0 && l.startedAt && (
                        <Link
                          to={`/admin/cs/follow-up?startDate=${new Date(l.startedAt).toISOString().slice(0, 10)}&endDate=${new Date(l.startedAt).toISOString().slice(0, 10)}`}
                          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                        >
                          View orders
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block">
                <CompactTable
                  rowKey={(l: SyncLog) => l.id}
                  columns={[
                    {
                      key: 'time', header: 'Time',
                      render: (l: SyncLog) => l.startedAt
                        ? new Date(l.startedAt).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : '—',
                    },
                    { key: 'type', header: 'Type', render: (l: SyncLog) => l.triggeredBy === 'cron' ? 'Auto' : 'Manual' },
                    { key: 'pulled', header: 'Pulled', align: 'right', render: (l: SyncLog) => <span className="tabular-nums">{l.totalPulled}</span> },
                    {
                      key: 'details', header: 'Breakdown',
                      render: (l: SyncLog) => (
                        <div className="space-y-0.5">
                          {l.errorMessage && (
                            <button
                              type="button"
                              onClick={() => setSyncErrorModal(l.errorMessage!)}
                              className="inline-flex items-center gap-1 text-danger-600 dark:text-danger-400 text-xs hover:underline"
                              title="View error details"
                            >
                              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                              </svg>
                              Error
                            </button>
                          )}
                          {l.ruleResults?.length ? (
                            <button type="button" onClick={() => setBreakdownLog(l)} className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">
                              View breakdown
                            </button>
                          ) : !l.errorMessage ? <span className="text-xs text-app-fg-muted">—</span> : null}
                        </div>
                      ),
                    },
                    {
                      key: 'actions', header: '', align: 'right',
                      render: (l: SyncLog) => {
                        if (!l.totalPulled) return null;
                        const d = l.startedAt ? new Date(l.startedAt).toISOString().slice(0, 10) : '';
                        if (!d) return null;
                        return (
                          <TableActionButton to={`/admin/cs/follow-up?startDate=${d}&endDate=${d}`} variant="primary">
                            View orders
                          </TableActionButton>
                        );
                      },
                    },
                  ]}
                  rows={paginatedLogs}
                />
              </div>

              {/* Pagination */}
              {historyTotalPages > 1 && (
                <Pagination
                  page={historyPage}
                  totalPages={historyTotalPages}
                  onPageChange={setHistoryPage}
                  pageSize={historyPageSize}
                  onPageSizeChange={(s) => { setHistoryPageSize(s); setHistoryPage(1); }}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ── Add/Edit Rule Modal ─────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditRule(null); }}
        maxWidth="max-w-lg"
        contentClassName="p-0 flex flex-col overflow-hidden min-h-0 border border-app-border"
      >
        <div className="flex items-center justify-between border-b border-app-border px-4 pt-4 pb-3 sm:px-5 sm:pt-5 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-app-fg">{editRule ? 'Edit rule' : 'Add rule'}</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">Pull matching orders into follow-up.</p>
          </div>
          <button type="button" onClick={() => { setModalOpen(false); setEditRule(null); }} className="rounded-md p-1 text-app-fg-muted hover:text-app-fg hover:bg-app-hover">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5 overflow-y-auto">
          <TextInput label="Rule name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Confirmed > 7 days" />

          <div>
            <label className="block text-xs font-medium text-app-fg-muted mb-1.5">Source status</label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSourceStatus(opt.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    sourceStatus === opt.value
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'border-app-border text-app-fg-muted hover:bg-app-hover hover:text-app-fg'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-app-fg-muted mb-1">Older than</label>
              <FormSelect id="fu-age" value={ageValue} onChange={(e) => setAgeValue(e.target.value)} options={AGE_OPTIONS} />
            </div>
            <div>
              <label className="block text-xs font-medium text-app-fg-muted mb-1">Max age (optional)</label>
              <FormSelect id="fu-max-age" value={maxAgeDays ? String(maxAgeDays) : ''} onChange={(e) => setMaxAgeDays(e.target.value ? parseInt(e.target.value, 10) : null)} options={AGE_OPTIONS} placeholder="No limit" />
            </div>
          </div>

          {sourceStatus !== 'CART_ABANDONMENT' && (
            <div>
              <label className="block text-xs font-medium text-app-fg-muted mb-1">Measure age from</label>
              <FormSelect id="fu-age-relative" value={ageRelativeTo} onChange={(e) => setAgeRelativeTo(e.target.value)} options={AGE_RELATIVE_TO_OPTIONS} />
              <p className="text-[11px] text-app-fg-muted mt-1">
                {ageRelativeTo === 'STATUS_TIMESTAMP' && 'Age counts from when the order entered the selected status.'}
                {ageRelativeTo === 'CREATED_AT' && 'Age counts from when the order was first created.'}
                {ageRelativeTo === 'PREFERRED_DELIVERY_DATE' && 'Age counts from the customer\'s scheduled delivery date.'}
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-app-fg-muted mb-1">Source branch</label>
            <SearchableSelect value={sourceBranchId ?? ''} onChange={(v) => setSourceBranchId(v || null)} options={[{ value: '', label: 'All branches' }, ...branchOptions]} placeholder="All branches" searchPlaceholder="Search..." />
          </div>

          <div>
            <label className="block text-xs font-medium text-app-fg-muted mb-1">Push to</label>
            <FormSelect id="fu-target-type" value={targetType} onChange={(e) => setTargetType(e.target.value as 'all' | 'branch' | 'group')} options={[
              { value: 'all', label: 'All branches (round-robin)' },
              { value: 'branch', label: 'Specific branch' },
              { value: 'group', label: 'Follow-up group' },
            ]} />
          </div>

          {targetType === 'branch' && (
            <div>
              <label className="block text-xs font-medium text-app-fg-muted mb-1">Target branch</label>
              <SearchableSelect value={targetBranchId ?? ''} onChange={(v) => setTargetBranchId(v || null)} options={branchOptions} placeholder="Select branch" searchPlaceholder="Search..." />
            </div>
          )}
          {targetType === 'group' && (
            <div>
              <label className="block text-xs font-medium text-app-fg-muted mb-1">Target group</label>
              <SearchableSelect value={targetGroupId ?? ''} onChange={(v) => setTargetGroupId(v || null)} options={groupOptions} placeholder="Select group" searchPlaceholder="Search..." />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-app-fg">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded border-app-border text-brand-600 focus:ring-brand-500" />
            Enabled
          </label>

          <div className="rounded-lg border border-app-border p-3 space-y-1.5">
            <label className="flex items-center gap-2 text-sm text-app-fg">
              <input type="checkbox" checked={freezeOriginal} onChange={(e) => setFreezeOriginal(e.target.checked)} className="rounded border-app-border text-brand-600 focus:ring-brand-500" />
              Freeze original order
            </label>
            <p className="text-[11px] text-app-fg-muted leading-snug pl-6">
              {freezeOriginal
                ? 'The original order will be locked when the follow-up copy is created. Only the follow-up can be worked.'
                : 'The original order stays active. Both the original and follow-up can be worked by closers simultaneously.'}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-app-border px-4 py-3 sm:px-5 shrink-0">
          <Button size="sm" variant="secondary" onClick={() => { setModalOpen(false); setEditRule(null); }}>Cancel</Button>
          <Button
            size="sm" onClick={handleSave}
            disabled={!name.trim() || (targetType === 'branch' && !targetBranchId) || (targetType === 'group' && !targetGroupId) || saveFetcher.state === 'submitting'}
            loading={saveFetcher.state !== 'idle'} loadingText="Saving..."
          >
            {editRule ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      {/* ── Create Group Modal ─────────────────────────────────── */}
      <GroupFormModal
        open={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        closers={closers}
        fetcher={createGroupFetcher}
        intent="createFollowUpGroup"
        title="Create follow-up group"
      />

      {/* ── Delete Rule Confirmation Modal ─────────────────────── */}
      {deleteRuleTarget && (
        <Modal open onClose={() => setDeleteRuleTarget(null)}>
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-app-fg">Delete rule</h3>
              <p className="text-sm text-app-fg-muted mt-1">
                Are you sure you want to delete <strong className="text-app-fg">{deleteRuleTarget.name}</strong>?
              </p>
              <p className="text-xs text-app-fg-muted mt-2">
                Previously pulled orders will not be affected — they stay in their current state.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeleteRuleTarget(null)}>Cancel</Button>
              <Button
                size="sm"
                variant="danger"
                onClick={confirmDelete}
                disabled={deleteFetcher.state !== 'idle'}
                loading={deleteFetcher.state !== 'idle'}
                loadingText="Deleting..."
              >
                Delete rule
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── View Rule Detail Modal ──────────────────────────── */}
      {viewRule && (
        <Modal open onClose={() => setViewRule(null)} maxWidth="max-w-md" contentClassName="p-0 flex flex-col overflow-hidden min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-app-border">
            <h3 className="text-lg font-semibold text-app-fg min-w-0 truncate">{viewRule.name}</h3>
            <StatusBadge status={viewRule.enabled ? 'ACTIVE' : 'INACTIVE'} />
          </div>

          {/* Details */}
          <div className="px-5 py-4 divide-y divide-app-border">
            <ViewRow label="Source Status" value={viewRule.sourceStatus === 'CART_ABANDONMENT' ? 'Cart Abandonment' : (STATUS_LABEL[viewRule.sourceStatus] ?? viewRule.sourceStatus)} />
            <ViewRow label="Age Threshold" value={viewRule.ageThresholdHours ? `${viewRule.ageThresholdHours} hour${viewRule.ageThresholdHours !== 1 ? 's' : ''}` : `${viewRule.ageThresholdDays} day${viewRule.ageThresholdDays !== 1 ? 's' : ''}`} />
            {viewRule.maxAgeDays != null && (
              <ViewRow label="Max Age" value={`${viewRule.maxAgeDays} day${viewRule.maxAgeDays !== 1 ? 's' : ''}`} />
            )}
            {viewRule.sourceStatus !== 'CART_ABANDONMENT' && (
              <ViewRow label="Measure From" value={AGE_RELATIVE_TO_LABEL[viewRule.ageRelativeTo] ?? viewRule.ageRelativeTo} />
            )}
            <ViewRow label="Source Branch" value={viewRule.sourceBranchName ?? 'All branches'} />
            <ViewRow label="Target" value={viewRule.targetBranchName ?? viewRule.targetGroupName ?? 'All branches (round-robin)'} />
            <ViewRow label="Freeze Original" value={viewRule.freezeOriginal !== false ? 'Yes — original locked' : 'No — both compete'} />
            <ViewRow label="Priority" value={String(viewRule.priority)} />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-app-border">
            <Button size="sm" variant="secondary" onClick={() => setViewRule(null)}>Close</Button>
            <Button size="sm" variant="primary" onClick={() => { setViewRule(null); openEdit(viewRule); }}>Edit</Button>
          </div>
        </Modal>
      )}

      {/* Sync preview confirmation modal */}
      {syncPreview && (
        <Modal open onClose={() => setSyncPreview(null)} maxWidth="max-w-md" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[80dvh]">
          <div className="px-4 pt-4 pb-3 border-b border-app-border shrink-0">
            <h3 className="text-base font-semibold text-app-fg">Sync Preview</h3>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {syncPreview.reduce((s, r) => s + r.eligible, 0)} eligible order{syncPreview.reduce((s, r) => s + r.eligible, 0) !== 1 ? 's' : ''} found across {syncPreview.length} rule{syncPreview.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-app-border">
            {syncPreview.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-app-fg-muted">No enabled rules configured.</p>
            ) : (
              syncPreview.map((r) => (
                <div key={r.ruleId} className="px-4 py-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-app-fg truncate min-w-0">{r.ruleName}</span>
                  <span className={`text-sm font-bold tabular-nums shrink-0 ${r.eligible > 0 ? 'text-brand-600 dark:text-brand-400' : 'text-app-fg-muted'}`}>
                    {r.eligible}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-app-border p-3 shrink-0 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setSyncPreview(null)}>Cancel</Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={isSyncing}
              loading={isSyncing}
              loadingText="Syncing..."
              onClick={handleSyncConfirm}
            >
              Sync Now ({syncPreview.reduce((s, r) => s + r.eligible, 0)})
            </Button>
          </div>
        </Modal>
      )}

      {/* Sync breakdown modal */}
      {/* Sync error detail modal */}
      {syncErrorModal && (
        <Modal open onClose={() => setSyncErrorModal(null)} maxWidth="max-w-md" contentClassName="p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-app-fg">Sync Error</h3>
              <p className="mt-1 text-sm text-app-fg-muted">The sync encountered an error during processing. Orders pulled before the error are still saved.</p>
            </div>
          </div>
          <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800/50 px-3 py-2.5">
            <p className="text-sm text-danger-800 dark:text-danger-200 font-mono break-all whitespace-pre-wrap">{syncErrorModal}</p>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setSyncErrorModal(null)}>Close</Button>
          </div>
        </Modal>
      )}

      {breakdownLog && (
        <Modal open onClose={() => setBreakdownLog(null)} maxWidth="max-w-md" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[80dvh]">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-app-border shrink-0">
            <div>
              <h3 className="text-base font-semibold text-app-fg">Sync Breakdown</h3>
              <p className="text-xs text-app-fg-muted mt-0.5">
                {breakdownLog.startedAt
                  ? new Date(breakdownLog.startedAt).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'}
                {' · '}{breakdownLog.triggeredBy === 'cron' ? 'Auto sync' : 'Manual sync'}
                {' · '}<span className="font-semibold">{breakdownLog.totalPulled} orders pulled</span>
              </p>
            </div>
            <button type="button" onClick={() => setBreakdownLog(null)} className="text-app-fg-muted hover:text-app-fg p-1 shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-app-border">
            {(breakdownLog.ruleResults ?? []).filter((r) => knownRuleIds.has(r.ruleId)).map((r) => (
              <div key={r.ruleId} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-app-fg truncate">{r.ruleName}</p>
                  <p className="text-xs text-app-fg-muted mt-0.5">
                    Target: {ruleTargetMap.get(r.ruleId) ?? 'All branches'}
                  </p>
                </div>
                <span className={`text-sm font-bold tabular-nums shrink-0 ${r.pulled > 0 ? 'text-app-fg' : 'text-app-fg-muted'}`}>
                  {r.pulled}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-app-border p-3 shrink-0">
            {breakdownLog.totalPulled > 0 && breakdownLog.startedAt && (
              <Link
                to={`/admin/cs/follow-up?startDate=${new Date(breakdownLog.startedAt).toISOString().slice(0, 10)}&endDate=${new Date(breakdownLog.startedAt).toISOString().slice(0, 10)}`}
                className="btn-primary btn-sm w-full inline-flex items-center justify-center gap-1.5"
                onClick={() => setBreakdownLog(null)}
              >
                View pulled orders
              </Link>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Unified Groups & Branches Tab ─────────────────────────────────

type UnifiedRow =
  | { kind: 'branch'; id: string; name: string; closerCount: number }
  | { kind: 'group'; id: string; name: string; memberCount: number; members: Array<{ userId: string; userName: string }>; createdByName: string | null; createdAt: string };

function GroupsAndBranchesTab({
  branches,
  followUpGroups,
  closers,
  excludedIds = [],
  activeCsBranchIds = [],
  createGroupFetcher,
  onCreateGroup,
}: {
  branches: Branch[];
  followUpGroups: FollowUpGroupItem[];
  closers: CloserWithBranches[];
  excludedIds?: string[];
  activeCsBranchIds?: string[];
  createGroupFetcher: ReturnType<typeof useFetcher>;
  onCreateGroup: () => void;
}) {
  const [peekGroup, setPeekGroup] = useState<FollowUpGroupItem | null>(null);
  const [editGroup, setEditGroup] = useState<FollowUpGroupItem | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<FollowUpGroupItem | null>(null);

  const editFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(editFetcher.data, { successMessage: 'Group updated' });
  useCloseOnFetcherSuccess(editFetcher, () => setEditGroup(null));

  const deleteFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(deleteFetcher.data, { successMessage: 'Group deleted' });
  useCloseOnFetcherSuccess(deleteFetcher, () => setDeleteGroup(null));

  const toggleFetcher = useFetcher<{ success?: boolean; error?: string; redistributed?: number }>();
  useFetcherToast(toggleFetcher.data, {
    successMessage: toggleFetcher.data?.redistributed
      ? `Updated — ${toggleFetcher.data.redistributed} orders redistributed`
      : 'Updated',
  });
  const [toggleTarget, setToggleTarget] = useState<{ id: string; name: string; kind: string; isExcluded: boolean } | null>(null);
  const tabRev = useRevalidator();
  useCloseOnFetcherSuccess(toggleFetcher, () => { setToggleTarget(null); tabRev.revalidate(); });
  const excludedSet = new Set(excludedIds);

  // Compute closer count per branch from the closers array
  const branchCloserCounts = new Map<string, number>();
  for (const c of closers) {
    for (const b of c.branches) {
      branchCloserCounts.set(b.branchId, (branchCloserCounts.get(b.branchId) ?? 0) + 1);
    }
  }

  // Show all active branches — branches with disabled CS are shown but marked inactive
  const activeCsSet = new Set(activeCsBranchIds ?? []);
  const visibleBranches = branches.filter((b) => b.status !== 'INACTIVE');

  const rows: UnifiedRow[] = [
    ...visibleBranches.map((b): UnifiedRow => ({ kind: 'branch', id: b.id, name: b.name, closerCount: branchCloserCounts.get(b.id) ?? 0 })),
    ...followUpGroups.map((g): UnifiedRow => ({ kind: 'group', ...g })),
  ];

  return (
    <>
      <p className="text-sm text-app-fg-muted mb-3">
        {visibleBranches.length} branch{visibleBranches.length !== 1 ? 'es' : ''} · {followUpGroups.length} group{followUpGroups.length !== 1 ? 's' : ''}
      </p>

      {rows.length === 0 ? (
        <EmptyState title="No branches or groups" description="Add branches or create a follow-up group to get started." />
      ) : (
        <CompactTable<UnifiedRow>
          rowKey={(r) => `${r.kind}-${r.id}`}
          rowClassName={() => ''}
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (r) => {
                if (r.kind === 'group') {
                  return (
                    <button type="button" onClick={() => setPeekGroup(r as FollowUpGroupItem)} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline text-left">
                      {r.name}
                    </button>
                  );
                }
                return <span className="text-sm font-medium text-app-fg">{r.name}</span>;
              },
            },
            {
              key: 'type',
              header: 'Type',
              render: (r) => (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium ${
                  r.kind === 'branch'
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                    : 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                }`}>
                  {r.kind === 'branch' ? 'Branch' : 'Group'}
                </span>
              ),
            },
            {
              key: 'members',
              header: 'CS Closers',
              align: 'right',
              render: (r) => {
                const count = r.kind === 'group' ? (r as UnifiedRow & { kind: 'group' }).memberCount : (r as UnifiedRow & { kind: 'branch' }).closerCount;
                return <span className="text-sm tabular-nums text-app-fg">{count}</span>;
              },
            },
            {
              key: 'createdBy',
              header: 'Created by',
              render: (r) => {
                if (r.kind === 'group') {
                  return <span className="text-xs text-app-fg-muted">{(r as UnifiedRow & { kind: 'group' }).createdByName ?? '—'}</span>;
                }
                return <span className="text-xs text-app-fg-muted">—</span>;
              },
            },
            {
              key: 'created',
              header: 'Created',
              render: (r) => {
                if (r.kind === 'group') {
                  return (
                    <span className="text-xs text-app-fg-muted">
                      {new Date((r as UnifiedRow & { kind: 'group' }).createdAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  );
                }
                return <span className="text-xs text-app-fg-muted">—</span>;
              },
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => {
                const isExcluded = excludedSet.has(r.id);
                const hasCsDisabled = r.kind === 'branch' && !activeCsSet.has(r.id);
                const isInactive = isExcluded || hasCsDisabled;
                return (
                  <span title={hasCsDisabled ? 'CS department disabled on this branch' : undefined}>
                    <StatusBadge status={isInactive ? 'INACTIVE' : 'ACTIVE'} />
                  </span>
                );
              },
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (r) => {
                const isExcluded = excludedSet.has(r.id);
                if (r.kind === 'branch') {
                  const hasCsDisabled = !activeCsSet.has(r.id);
                  return (
                    <div className="flex gap-1 justify-end">
                      <TableActionButton to={`/admin/cs/follow-up?view=orders&branchId=${r.id}&backTo=/admin/settings/follow-up-config`} variant="primary">
                        View
                      </TableActionButton>
                      {hasCsDisabled ? (
                        <TableActionButton to={`/admin/branches/${r.id}`} variant="success">
                          Activate
                        </TableActionButton>
                      ) : (
                        <TableActionButton
                          onClick={() => setToggleTarget({ id: r.id, name: r.name, kind: r.kind, isExcluded })}
                          variant={isExcluded ? undefined : 'danger'}
                        >
                          {isExcluded ? 'Activate' : 'Disable'}
                        </TableActionButton>
                      )}
                    </div>
                  );
                }
                const g = r as FollowUpGroupItem;
                return (
                  <div className="flex gap-1 justify-end">
                    <TableActionButton onClick={() => setPeekGroup(g)}>View</TableActionButton>
                    <TableActionButton onClick={() => setEditGroup(g)}>Edit</TableActionButton>
                    <TableActionButton
                      onClick={() => setToggleTarget({ id: r.id, name: r.name, kind: r.kind, isExcluded })}
                      variant={isExcluded ? undefined : 'danger'}
                    >
                      {isExcluded ? 'Activate' : 'Disable'}
                    </TableActionButton>
                  </div>
                );
              },
            },
          ]}
          rows={rows}
          renderMobileCard={(r) => {
            if (r.kind === 'branch') {
              return (
                <Link
                  to={`/admin/cs/follow-up?view=orders&branchId=${r.id}&backTo=/admin/settings/follow-up-config`}
                  className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-app-fg truncate">{r.name}</span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">Branch</span>
                  </div>
                </Link>
              );
            }
            const g = r as FollowUpGroupItem;
            return (
              <button
                type="button"
                onClick={() => setPeekGroup(g)}
                className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg truncate">{g.name}</span>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">Group</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-app-fg-muted">
                  <span>{g.memberCount} members</span>
                  {g.createdByName && <span>by {g.createdByName}</span>}
                </div>
              </button>
            );
          }}
        />
      )}

      {/* Edit group modal */}
      {editGroup && (
        <GroupFormModal
          open={!!editGroup}
          onClose={() => setEditGroup(null)}
          closers={closers}
          fetcher={editFetcher}
          intent="updateFollowUpGroup"
          title={`Edit ${editGroup.name}`}
          group={editGroup}
        />
      )}

      {/* Delete group confirm */}
      {deleteGroup && (
        <Modal open onClose={() => setDeleteGroup(null)} maxWidth="max-w-sm" contentClassName="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-app-fg">Delete group</h3>
          <p className="text-sm text-app-fg-muted">
            Are you sure you want to delete <strong>{deleteGroup.name}</strong>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeleteGroup(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleteFetcher.state === 'submitting'}
              loadingText="Deleting…"
              onClick={() => {
                deleteFetcher.submit(
                  { intent: 'deleteFollowUpGroup', groupId: deleteGroup.id },
                  { method: 'post' },
                );
              }}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}

      {/* Toggle follow-up active/inactive confirmation */}
      {toggleTarget && (
        <Modal open onClose={() => setToggleTarget(null)} maxWidth="max-w-sm" contentClassName="p-5 space-y-4">
          <h3 className="text-base font-semibold text-app-fg">
            {toggleTarget.isExcluded ? 'Enable' : 'Disable'} follow-up distribution
          </h3>
          <p className="text-sm text-app-fg-muted">
            {toggleTarget.isExcluded
              ? `Re-enable follow-up order distribution to ${toggleTarget.name}. New syncs will include this ${toggleTarget.kind}.`
              : `Disable follow-up distribution to ${toggleTarget.name}. Unprocessed orders will be redistributed to other active branches.`}
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => setToggleTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              variant={toggleTarget.isExcluded ? 'primary' : 'danger'}
              disabled={toggleFetcher.state === 'submitting'}
              loading={toggleFetcher.state === 'submitting'}
              loadingText={toggleTarget.isExcluded ? 'Enabling...' : 'Disabling...'}
              onClick={() => {
                toggleFetcher.submit(
                  { intent: 'toggleFollowUpActive', targetId: toggleTarget.id },
                  { method: 'post' },
                );
              }}
            >
              {toggleTarget.isExcluded ? 'Enable' : 'Disable'}
            </Button>
          </div>
        </Modal>
      )}

      {/* Peek members modal */}
      {peekGroup && (
        <Modal open onClose={() => setPeekGroup(null)} maxWidth="max-w-sm" contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[80dvh]">
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-app-border shrink-0">
            <div>
              <h3 className="text-base font-semibold text-app-fg">{peekGroup.name}</h3>
              <p className="text-xs text-app-fg-muted mt-0.5">
                {peekGroup.memberCount} {peekGroup.memberCount === 1 ? 'member' : 'members'}
                {peekGroup.createdByName ? ` · Created by ${peekGroup.createdByName}` : ''}
              </p>
            </div>
            <button type="button" onClick={() => setPeekGroup(null)} className="text-app-fg-muted hover:text-app-fg p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-app-border">
            {peekGroup.members.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-app-fg-muted">No members in this group.</p>
            ) : (
              peekGroup.members.map((m) => (
                <div key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-semibold shrink-0">
                    {m.userName.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-app-fg">{m.userName}</span>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-app-border p-3 shrink-0 flex gap-2">
            <button
              type="button"
              onClick={() => { setPeekGroup(null); setEditGroup(peekGroup); }}
              className="btn-secondary btn-sm flex-1 justify-center"
            >
              Edit group
            </button>
            <button type="button" onClick={() => setPeekGroup(null)} className="btn-secondary btn-sm flex-1 justify-center">
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ViewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 gap-6">
      <span className="text-sm text-app-fg-muted shrink-0">{label}</span>
      <span className="text-sm font-medium text-app-fg text-right">{value}</span>
    </div>
  );
}
