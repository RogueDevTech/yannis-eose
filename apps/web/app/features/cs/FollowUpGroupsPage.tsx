import { useCallback, useMemo, useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { EmptyState } from '~/components/ui/empty-state';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { Checkbox } from '~/components/ui/checkbox';
import { SearchInput } from '~/components/ui/search-input';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

export interface FollowUpGroupItem {
  id: string;
  name: string;
  createdByName: string | null;
  memberCount: number;
  members: Array<{ userId: string; userName: string }>;
  createdAt: string;
}

export interface CloserWithBranches {
  agentId: string;
  agentName: string;
  branches: Array<{ branchId: string; branchName: string }>;
}

interface Props {
  groups: FollowUpGroupItem[];
  closers: CloserWithBranches[];
  deferredLoading?: boolean;
}

/**
 * Embeddable panel — groups table + create/edit/delete modals, no PageHeader.
 * Used as a tab inside FollowUpBatchesPage.
 */
export function FollowUpGroupsPanel({ groups, closers, deferredLoading = false }: Props) {
  return <FollowUpGroupsBody groups={groups} closers={closers} deferredLoading={deferredLoading} />;
}

export function FollowUpGroupsPage({ groups, closers, deferredLoading = false }: Props) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow Up — Groups"
        mobileInlineActions
        description="Manage follow-up groups — teams of closers that work reopened orders."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Follow-up tools"
            desktop={
              <>
                <Link to="/admin/cs/follow-up" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                  Batches
                </Link>
                <PageRefreshButton />
              </>
            }
            sheet={
              <Link to="/admin/cs/follow-up" className="btn-secondary w-full inline-flex items-center justify-center">
                Batches
              </Link>
            }
          />
        }
      />
      <FollowUpGroupsBody groups={groups} closers={closers} deferredLoading={deferredLoading} />
    </div>
  );
}

function FollowUpGroupsBody({ groups, closers, deferredLoading = false }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<FollowUpGroupItem | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<FollowUpGroupItem | null>(null);
  const [peekGroup, setPeekGroup] = useState<FollowUpGroupItem | null>(null);

  const createFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(createFetcher, { successMessage: 'Group created' });
  useCloseOnFetcherSuccess(createFetcher, () => setCreateOpen(false));

  const editFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(editFetcher, { successMessage: 'Group updated' });
  useCloseOnFetcherSuccess(editFetcher, () => setEditGroup(null));

  const deleteFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(deleteFetcher, { successMessage: 'Group deleted' });
  useCloseOnFetcherSuccess(deleteFetcher, () => setDeleteGroup(null));

  const columns: CompactTableColumn<FollowUpGroupItem>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Group',
        render: (g) => (
          <button type="button" onClick={() => setPeekGroup(g)} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline text-left">
            {g.name}
          </button>
        ),
      },
      {
        key: 'members',
        header: 'Members',
        render: (g) => (
          <span className="text-sm text-app-fg-muted">
            {g.memberCount} {g.memberCount === 1 ? 'member' : 'members'}
          </span>
        ),
      },
      {
        key: 'memberNames',
        header: 'Team',
        render: (g) => (
          <span className="text-xs text-app-fg-muted truncate max-w-[14rem] block">
            {g.members.map((m) => m.userName).join(', ') || '—'}
          </span>
        ),
      },
      {
        key: 'createdBy',
        header: 'Created by',
        render: (g) => <span className="text-xs text-app-fg-muted">{g.createdByName ?? '—'}</span>,
      },
      {
        key: 'date',
        header: 'Created',
        render: (g) => (
          <span className="text-xs text-app-fg-muted">
            {new Date(g.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (g) => (
          <TableRowActionsSheet
            ariaLabel={`Actions for ${g.name}`}
            sheetTitle={g.name}
            actions={[
              { key: 'view', kind: 'button', label: 'View members', onClick: () => setPeekGroup(g) },
              { key: 'edit', kind: 'button', label: 'Edit group', onClick: () => setEditGroup(g) },
              { key: 'delete', kind: 'button', label: 'Delete group', tone: 'danger', onClick: () => setDeleteGroup(g) },
            ]}
          />
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary btn-sm inline-flex items-center gap-1.5">
          + New group
        </button>
      </div>

      {groups.length === 0 && !deferredLoading ? (
        <EmptyState
          title="No follow-up groups"
          description="Create a group of closers to assign follow-up batches."
          action={
            <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary btn-sm inline-flex items-center gap-1.5">
              + New group
            </button>
          }
        />
      ) : (
        <CompactTable<FollowUpGroupItem>
          columns={columns}
          rows={groups}
          rowKey={(g) => g.id}
          renderMobileCard={(g) => (
            <button
              type="button"
              onClick={() => setPeekGroup(g)}
              className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-app-fg truncate">{g.name}</span>
                <span className="shrink-0 text-xs text-app-fg-muted">{g.memberCount} members</span>
              </div>
              <div className="text-xs text-app-fg-muted truncate">
                {g.members.map((m) => m.userName).join(', ') || '—'}
              </div>
            </button>
          )}
        />
      )}

      {/* ── Create Group Modal ────────────────────── */}
      <GroupFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        closers={closers}
        fetcher={createFetcher}
        intent="createFollowUpGroup"
        title="New Follow-Up Group"
      />

      {/* ── Edit Group Modal ────────────────────── */}
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

      {/* ── Delete Confirm Modal ────────────────────── */}
      <Modal
        open={!!deleteGroup}
        onClose={() => setDeleteGroup(null)}
        maxWidth="max-w-sm"
        contentClassName="p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-app-fg">Delete group</h3>
        <p className="text-sm text-app-fg-muted">
          Are you sure you want to delete <strong>{deleteGroup?.name}</strong>? This cannot be undone.
        </p>
        {deleteFetcher.data?.error && (
          <p className="text-sm text-danger-600 dark:text-danger-400">{deleteFetcher.data.error}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setDeleteGroup(null)}>Cancel</Button>
          <Button
            variant="danger"
            loading={deleteFetcher.state === 'submitting'}
            loadingText="Deleting…"
            onClick={() => {
              deleteFetcher.submit(
                { intent: 'deleteFollowUpGroup', groupId: deleteGroup!.id },
                { method: 'post' },
              );
            }}
          >
            Delete
          </Button>
        </div>
      </Modal>

      {/* ── Peek Members Modal ────────────────────── */}
      <Modal
        open={!!peekGroup}
        onClose={() => setPeekGroup(null)}
        maxWidth="max-w-sm"
        contentClassName="p-0 flex flex-col overflow-hidden min-h-0 max-h-[80dvh]"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-app-border shrink-0">
          <div>
            <h3 className="text-base font-semibold text-app-fg">{peekGroup?.name}</h3>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {peekGroup?.memberCount} {peekGroup?.memberCount === 1 ? 'member' : 'members'}
              {peekGroup?.createdByName ? ` · Created by ${peekGroup.createdByName}` : ''}
            </p>
          </div>
          <button type="button" onClick={() => setPeekGroup(null)} className="text-app-fg-muted hover:text-app-fg p-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-app-border">
          {peekGroup?.members.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-app-fg-muted">No members in this group.</p>
          ) : (
            peekGroup?.members.map((m) => (
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
            onClick={() => { setPeekGroup(null); if (peekGroup) setEditGroup(peekGroup); }}
            className="btn-secondary btn-sm flex-1 justify-center"
          >
            Edit group
          </button>
          <button type="button" onClick={() => setPeekGroup(null)} className="btn-secondary btn-sm flex-1 justify-center">
            Close
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Group Form Modal (shared create/edit) ──────────────────

interface GroupFormModalProps {
  open: boolean;
  onClose: () => void;
  closers: CloserWithBranches[];
  fetcher: ReturnType<typeof useFetcher>;
  intent: string;
  title: string;
  group?: FollowUpGroupItem;
}

function GroupFormModal({ open, onClose, closers, fetcher, intent, title, group }: GroupFormModalProps) {
  const [name, setName] = useState(group?.name ?? '');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(group?.members.map((m) => m.userId) ?? []),
  );
  const [memberSearch, setMemberSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');

  // Reset state when group changes (edit vs create)
  const groupId = group?.id;
  const [lastGroupId, setLastGroupId] = useState(groupId);
  if (groupId !== lastGroupId) {
    setLastGroupId(groupId);
    setName(group?.name ?? '');
    setSelectedMembers(new Set(group?.members.map((m) => m.userId) ?? []));
    setMemberSearch('');
    setBranchFilter('');
  }

  // Derive unique branches from closers for the filter dropdown
  const branchOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of closers) {
      for (const b of c.branches) {
        if (!map.has(b.branchId)) map.set(b.branchId, b.branchName);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [closers]);

  const filteredClosers = useMemo(() => {
    let result = closers;
    if (branchFilter) {
      result = result.filter((c) => c.branches.some((b) => b.branchId === branchFilter));
    }
    if (memberSearch) {
      const q = memberSearch.toLowerCase();
      result = result.filter((c) => c.agentName.toLowerCase().includes(q));
    }
    return result;
  }, [closers, memberSearch, branchFilter]);

  const toggleMember = useCallback((id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Select all visible (filtered) closers
  const selectAllVisible = useCallback(() => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      for (const c of filteredClosers) next.add(c.agentId);
      return next;
    });
  }, [filteredClosers]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md" contentClassName="p-6 space-y-4">
      <h3 className="text-lg font-semibold text-app-fg">{title}</h3>

      <TextInput
        label="Group name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Re-engagement Team A"
      />

      <div>
        <label className="block text-sm font-medium text-app-fg mb-1.5">
          Members ({selectedMembers.size} selected)
        </label>

        {/* Branch filter + search row */}
        <div className="flex gap-2 mb-2">
          {branchOptions.length > 1 && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="h-8 rounded-lg border border-app-border bg-app-canvas px-2 text-xs text-app-fg min-w-0 flex-shrink-0"
            >
              <option value="">All branches</option>
              {branchOptions.map((b) => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          )}
          <SearchInput
            value={memberSearch}
            onChange={setMemberSearch}
            placeholder="Search closers…"
            controlSize="sm"
            wrapperClassName="flex-1 min-w-0"
          />
        </div>

        {/* Select all visible */}
        {filteredClosers.length > 0 && (
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-app-fg-muted">
              {filteredClosers.length} closer{filteredClosers.length !== 1 ? 's' : ''}
              {branchFilter ? ' in branch' : ''}
            </span>
            <button
              type="button"
              onClick={selectAllVisible}
              className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              Select all{branchFilter ? ' in branch' : ' visible'}
            </button>
          </div>
        )}

        <div className="max-h-48 overflow-y-auto border border-app-border rounded-lg divide-y divide-app-border">
          {filteredClosers.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-app-fg-muted">No closers found</p>
          ) : (
            filteredClosers.map((c) => (
              <label
                key={c.agentId}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-app-hover cursor-pointer transition-colors"
              >
                <Checkbox
                  checked={selectedMembers.has(c.agentId)}
                  onChange={() => toggleMember(c.agentId)}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-app-fg">{c.agentName}</span>
                  {c.branches.length > 0 && (
                    <span className="ml-1.5 text-micro text-app-fg-muted">
                      {c.branches.map((b) => b.branchName).join(', ')}
                    </span>
                  )}
                </div>
              </label>
            ))
          )}
        </div>
      </div>

      {(fetcher as { data?: { error?: string } }).data?.error && (
        <p className="text-sm text-danger-600 dark:text-danger-400">
          {(fetcher as { data?: { error?: string } }).data?.error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={fetcher.state === 'submitting' || !name.trim() || selectedMembers.size === 0}
          loading={fetcher.state === 'submitting'}
          loadingText="Saving…"
          onClick={() => {
            fetcher.submit(
              {
                intent,
                groupName: name.trim(),
                memberIds: JSON.stringify([...selectedMembers]),
                ...(group ? { groupId: group.id } : {}),
              },
              { method: 'post' },
            );
          }}
        >
          {group ? 'Save' : 'Create group'}
        </Button>
      </div>
    </Modal>
  );
}
