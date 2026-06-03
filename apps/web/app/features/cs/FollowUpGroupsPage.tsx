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
import { Spinner } from '~/components/ui/spinner';
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

interface Props {
  groups: FollowUpGroupItem[];
  closers: Array<{ agentId: string; agentName: string }>;
  deferredLoading?: boolean;
}

export function FollowUpGroupsPage({ groups, closers, deferredLoading = false }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<FollowUpGroupItem | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<FollowUpGroupItem | null>(null);

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
        render: (g) => <span className="text-sm font-medium text-app-fg">{g.name}</span>,
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
      <PageHeader
        title="Follow Up"
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
                <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary btn-sm inline-flex items-center gap-1.5">
                  + New group
                </button>
              </>
            }
            sheet={
              <>
                <Link to="/admin/cs/follow-up" className="btn-secondary w-full inline-flex items-center justify-center">
                  Batches
                </Link>
                <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary w-full inline-flex items-center justify-center mt-2">
                  + New group
                </button>
              </>
            }
          />
        }
      />

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
              onClick={() => setEditGroup(g)}
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
    </div>
  );
}

// ── Group Form Modal (shared create/edit) ──────────────────

interface GroupFormModalProps {
  open: boolean;
  onClose: () => void;
  closers: Array<{ agentId: string; agentName: string }>;
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

  // Reset state when group changes (edit vs create)
  const groupId = group?.id;
  const [lastGroupId, setLastGroupId] = useState(groupId);
  if (groupId !== lastGroupId) {
    setLastGroupId(groupId);
    setName(group?.name ?? '');
    setSelectedMembers(new Set(group?.members.map((m) => m.userId) ?? []));
    setMemberSearch('');
  }

  const filteredClosers = useMemo(() => {
    if (!memberSearch) return closers;
    const q = memberSearch.toLowerCase();
    return closers.filter((c) => c.agentName.toLowerCase().includes(q));
  }, [closers, memberSearch]);

  const toggleMember = useCallback((id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
        <SearchInput
          value={memberSearch}
          onChange={setMemberSearch}
          placeholder="Search closers…"
          controlSize="sm"
          wrapperClassName="mb-2"
        />
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
                <span className="text-sm text-app-fg">{c.agentName}</span>
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
