import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListMerge } from '~/hooks/useOptimisticListMerge';
import { isOptimisticId, optimisticId } from '~/lib/optimistic';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Card, CardBody } from '~/components/ui/card';
import { Tabs } from '~/components/ui/tabs';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { Modal } from '~/components/ui/modal';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import type { RoleTemplateOption } from '~/features/users/types';
import { PermissionCheckboxPicker } from '~/features/settings/PermissionCheckboxPicker';
import { PermissionCodeDetailPanel } from '~/features/users/PermissionCodeDetailPanel';
import { TemplatePermissionsViewPanel } from '~/features/settings/TemplatePermissionsViewPanel';
import { canonicalPermissionCode, formatPermissionCode } from '~/lib/permission-codes';

interface TemplateTableRow {
  id: string;
  name: string;
  key: string;
  kind: string;
  mappedRole: string;
  __tpl: RoleTemplateOption;
}

export interface PermissionCatalogRow {
  code: string;
  resource: string;
  action: string;
  description: string | null;
  legacyAliases?: string[];
}

interface LoaderShape {
  templates: RoleTemplateOption[];
  permissions: PermissionCatalogRow[];
  /** Current permission codes per template id (same source as edit modal; immediate checkbox state). */
  templatePermissionsById: Record<string, string[]>;
}

type ActionData = {
  /** Standard success marker — see CLAUDE.md → "Modal + Optimistic UI Pattern". */
  success?: boolean;
  error?: string;
  permissionCodes?: string[];
  templateId?: string;
};

function codesFromSelection(selected: Set<string>): string[] {
  return [...selected].sort((a, b) => a.localeCompare(b));
}

export function RoleTemplatesPage({
  templates,
  permissions,
  templatePermissionsById,
}: LoaderShape) {
  const fetcher = useFetcher<ActionData>();

  const permCodesSorted = useMemo(() => permissions.map((p) => p.code).sort(), [permissions]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [active, setActive] = useState<RoleTemplateOption | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [createSelectedCodes, setCreateSelectedCodes] = useState<Set<string>>(() => new Set());
  const [editSelectedCodes, setEditSelectedCodes] = useState<Set<string>>(() => new Set());
  const [viewCodes, setViewCodes] = useState<Set<string>>(() => new Set());
  const [catalogDetailPermission, setCatalogDetailPermission] = useState<PermissionCatalogRow | null>(null);
  const [mainTab, setMainTab] = useState<'templates' | 'catalog'>('templates');

  const busy = fetcher.state !== 'idle';

  // Close-on-success — edge-triggered via the shared hook. Filtered to the
  // create + setPermissions intents; `getTemplate` (which prefills the edit
  // modal) returns its own payload and does NOT close anything.
  // See CLAUDE.md → "Modal + Optimistic UI Pattern".
  const handleTemplateMutationSuccess = useCallback(() => {
    setCreateOpen(false);
    setEditOpen(false);
    setActive(null);
    setCreateSelectedCodes(new Set());
    setEditSelectedCodes(new Set());
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleTemplateMutationSuccess, {
    intent: ['createTemplate', 'setTemplatePermissions'],
  });

  useEffect(() => {
    if (!editOpen || !active) return;
    if (fetcher.state !== 'idle') return;
    const d = fetcher.data;
    if (!d?.permissionCodes || !Array.isArray(d.permissionCodes)) return;
    if (d.templateId !== undefined && d.templateId !== active.id) return;
    const canon = d.permissionCodes.map((c) => canonicalPermissionCode(c));
    setEditSelectedCodes(new Set(canon));
  }, [editOpen, active, fetcher.state, fetcher.data]);

  // View modal mirrors the edit fetch flow — same `getTemplate` action returns
  // `permissionCodes`; the view modal renders them through the picker in
  // read-only mode.
  useEffect(() => {
    if (!viewOpen || !active) return;
    if (fetcher.state !== 'idle') return;
    const d = fetcher.data;
    if (!d?.permissionCodes || !Array.isArray(d.permissionCodes)) return;
    if (d.templateId !== undefined && d.templateId !== active.id) return;
    const canon = d.permissionCodes.map((c) => canonicalPermissionCode(c));
    setViewCodes(new Set(canon));
  }, [viewOpen, active, fetcher.state, fetcher.data]);

  const openCreate = () => {
    setDraftKey('');
    setDraftName('');
    setDraftDesc('');
    setCreateSelectedCodes(new Set());
    setCreateOpen(true);
  };

  const openEdit = (t: RoleTemplateOption) => {
    setActive(t);
    const baseline = templatePermissionsById[t.id] ?? [];
    setEditSelectedCodes(new Set(baseline.map((c) => canonicalPermissionCode(c))));
    setEditOpen(true);
    const fd = new FormData();
    fd.set('intent', 'getTemplate');
    fd.set('templateId', t.id);
    fetcher.submit(fd, { method: 'post' });
  };

  const openView = (t: RoleTemplateOption) => {
    setActive(t);
    // Pre-fill from loader baseline so the picker isn't blank during the fetch
    // round-trip — same pattern openEdit uses.
    const baseline = templatePermissionsById[t.id] ?? [];
    setViewCodes(new Set(baseline.map((c) => canonicalPermissionCode(c))));
    setViewOpen(true);
    const fd = new FormData();
    fd.set('intent', 'getTemplate');
    fd.set('templateId', t.id);
    fetcher.submit(fd, { method: 'post' });
  };

  // Optimistic-add: while createTemplate is in flight, render a synthetic row
  // so the new template appears the same tick as the toast.
  const buildOptimisticTemplates = useCallback<
    (fd: FormData, intent: string) => RoleTemplateOption[] | null
  >((fd, intent) => {
    if (intent !== 'createTemplate') return null;
    const name = fd.get('name')?.toString().trim();
    const key = fd.get('key')?.toString().trim();
    if (!name || !key) return null;
    return [
      {
        id: optimisticId(),
        name,
        key,
        kind: 'CUSTOM',
        mappedRole: null,
      } as unknown as RoleTemplateOption,
    ];
  }, []);
  const optimisticTemplates = useOptimisticListMerge<RoleTemplateOption>(fetcher, buildOptimisticTemplates);

  const rows: TemplateTableRow[] = useMemo(
    () =>
      [...optimisticTemplates, ...templates].map((t) => ({
        id: t.id,
        name: t.name,
        key: t.key,
        kind: t.kind,
        mappedRole: t.mappedRole ?? '—',
        __tpl: t,
      })),
    [templates, optimisticTemplates],
  );

  const templateColumns: CompactTableColumn<TemplateTableRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) =>
        isOptimisticId(r.id) ? (
          <span>
            {r.name}
            <span className="ml-2 text-xs text-app-fg-muted italic">Saving…</span>
          </span>
        ) : (
          r.name
        ),
    },
    { key: 'key', header: 'Key', render: (r) => <span className="font-mono text-xs">{r.key}</span> },
    { key: 'kind', header: 'Kind', render: (r) => r.kind },
    { key: 'mappedRole', header: 'Mapped role', render: (r) => r.mappedRole },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      render: (r) => {
        const isOptimistic = isOptimisticId(r.id);
        return (
          <div className="inline-flex items-center justify-end gap-1.5">
            <CompactTableActionButton disabled={busy || isOptimistic} onClick={() => openView(r.__tpl)}>
              View
            </CompactTableActionButton>
            <CompactTableActionButton disabled={busy || isOptimistic} onClick={() => openEdit(r.__tpl)}>
              Edit perms
            </CompactTableActionButton>
          </div>
        );
      },
    },
  ];

  // Catalog columns — same CompactTable shape as the Templates / Orders tables so
  // the catalog reads visually identical to every other table in the app.
  const catalogColumns: CompactTableColumn<PermissionCatalogRow>[] = [
    {
      key: 'permission',
      header: 'Permission',
      render: (p) => (
        <div className="min-w-0">
          <span className="block text-sm font-medium text-app-fg">
            {formatPermissionCode(p.code)}
          </span>
          <span className="block font-mono text-[11px] text-app-fg-muted break-all">
            {p.code}
          </span>
        </div>
      ),
    },
    { key: 'resource', header: 'Resource', render: (p) => <span className="font-mono text-xs">{p.resource}</span> },
    { key: 'action', header: 'Action', render: (p) => <span className="font-mono text-xs">{p.action}</span> },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      render: (p) => (
        <CompactTableActionButton onClick={() => setCatalogDetailPermission(p)}>View</CompactTableActionButton>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role templates"
        description="Permission-first presets. SYSTEM templates map to legacy enum roles; CUSTOM templates can combine any permissions."
        actions={
          <>
            <PageRefreshButton />
            <Button type="button" variant="primary" onClick={openCreate} disabled={busy}>
              New template
            </Button>
          </>
        }
      />

      {fetcher.data?.error && (
        <div className="rounded-md border border-danger-200 bg-danger-50 dark:bg-danger-900/20 px-3 py-2 text-sm text-danger-700">
          {fetcher.data.error}
        </div>
      )}

      <Tabs
        value={mainTab}
        onChange={(v) => {
          if (v === 'templates' || v === 'catalog') setMainTab(v);
        }}
        tabs={[
          { value: 'templates', label: 'Templates' },
          {
            value: 'catalog',
            label: 'Permission catalog',
            badge:
              permissions.length > 0 ? (
                <span className="rounded-full bg-app-hover px-2 py-0.5 text-xs font-semibold text-app-fg-muted tabular-nums">
                  {permissions.length}
                </span>
              ) : undefined,
          },
        ]}
      />

      {mainTab === 'templates' && (
        <Card>
          <CardBody className="p-0">
            <CompactTable<TemplateTableRow>
              columns={templateColumns}
              rows={rows}
              rowKey={(r) => r.id}
              rowClassName={(r) => (isOptimisticId(r.id) ? 'opacity-60' : '')}
              withCard={false}
            />
          </CardBody>
        </Card>
      )}

      {mainTab === 'catalog' && (
        <div className="space-y-3">
          <p className="text-sm text-app-fg-muted">
            {permCodesSorted.length} codes — use these strings in templates. The API rejects unknown
            codes.
          </p>
          <Card>
            <CardBody className="p-0">
              <CompactTable<PermissionCatalogRow>
                columns={catalogColumns}
                rows={permissions}
                rowKey={(p) => p.code}
                emptyTitle="No permissions yet"
                withCard={false}
              />
            </CardBody>
          </Card>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        maxWidth="max-w-3xl"
        contentClassName="flex max-h-[90vh] flex-col gap-4 bg-app-elevated p-6"
      >
        <h3 className="text-lg font-semibold text-app-fg">Create custom template</h3>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <TextInput
            label="Key"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            hint="Immutable identifier (slug)."
          />
          <TextInput
            label="Name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
          />
          <TextInput
            label="Description"
            value={draftDesc}
            onChange={(e) => setDraftDesc(e.target.value)}
          />
          <div className="space-y-2 border-t border-app-border pt-4">
            <div>
              <p className="text-sm font-medium text-app-fg">Initial permissions (optional)</p>
              <p className="mt-0.5 text-xs text-app-fg-muted">
                Select from the catalog. Unchecked permissions are not included — same as the API{' '}
                <span className="font-mono">permissionCodes</span> list.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || permissions.length === 0}
                onClick={() => setCreateSelectedCodes(new Set())}
              >
                Clear all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || permissions.length === 0}
                onClick={() => setCreateSelectedCodes(new Set(permissions.map((p) => p.code)))}
              >
                Select all
              </Button>
            </div>
            <PermissionCheckboxPicker
              permissions={permissions}
              selectedCodes={createSelectedCodes}
              onToggle={(code, checked) => {
                setCreateSelectedCodes((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(code);
                  else next.delete(code);
                  return next;
                });
              }}
            />
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-app-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setCreateOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !draftKey.trim() || !draftName.trim()}
            onClick={() => {
              const fd = new FormData();
              fd.set('intent', 'createTemplate');
              fd.set('key', draftKey.trim());
              fd.set('name', draftName.trim());
              fd.set('description', draftDesc.trim());
              fd.set('permissionCodes', JSON.stringify(codesFromSelection(createSelectedCodes)));
              fetcher.submit(fd, { method: 'post' });
            }}
          >
            Create
          </Button>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => {
          if (busy) return;
          setEditOpen(false);
          setActive(null);
          setEditSelectedCodes(new Set());
        }}
        maxWidth="max-w-3xl"
        contentClassName="flex max-h-[90vh] flex-col gap-4 bg-app-elevated p-6"
      >
        <h3 className="text-lg font-semibold text-app-fg">
          {active ? `Edit permissions — ${active.name}` : 'Edit permissions'}
        </h3>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2 border-t border-app-border pt-4">
            <div>
              <p className="text-sm font-medium text-app-fg">Permissions</p>
              <p className="mt-0.5 text-xs text-app-fg-muted">
                Select from the catalog — same as creating a template. Save replaces this template’s
                permission set.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || permissions.length === 0}
                onClick={() => setEditSelectedCodes(new Set())}
              >
                Clear all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || permissions.length === 0}
                onClick={() => setEditSelectedCodes(new Set(permissions.map((p) => p.code)))}
              >
                Select all
              </Button>
            </div>
            <PermissionCheckboxPicker
              permissions={permissions}
              selectedCodes={editSelectedCodes}
              onToggle={(code, checked) => {
                setEditSelectedCodes((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(code);
                  else next.delete(code);
                  return next;
                });
              }}
            />
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-app-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditOpen(false);
              setActive(null);
              setEditSelectedCodes(new Set());
            }}
            disabled={busy}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !active}
            onClick={() => {
              const fd = new FormData();
              fd.set('intent', 'setTemplatePermissions');
              fd.set('templateId', active?.id ?? '');
              fd.set('permissionCodes', JSON.stringify(codesFromSelection(editSelectedCodes)));
              fetcher.submit(fd, { method: 'post' });
            }}
          >
            Save
          </Button>
        </div>
      </Modal>

      <Modal
        open={catalogDetailPermission !== null}
        onClose={() => setCatalogDetailPermission(null)}
        maxWidth="max-w-lg"
        aria-labelledby="permission-catalog-detail-title"
        contentClassName="p-6 space-y-4 bg-app-elevated"
      >
        {catalogDetailPermission ? (
          <PermissionCodeDetailPanel
            code={catalogDetailPermission.code}
            description={catalogDetailPermission.description}
            legacyAliases={catalogDetailPermission.legacyAliases}
            onClose={() => setCatalogDetailPermission(null)}
            titleId="permission-catalog-detail-title"
          />
        ) : null}
      </Modal>

      <Modal
        open={viewOpen}
        onClose={() => {
          setViewOpen(false);
          setActive(null);
          setViewCodes(new Set());
        }}
        maxWidth="max-w-3xl"
        contentClassName="flex max-h-[90vh] flex-col gap-4 bg-app-elevated p-6"
      >
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-app-fg">
            {active ? `Permissions — ${active.name}` : 'Permissions'}
          </h3>
          {active ? (
            <p className="font-mono text-xs text-app-fg-muted break-all">{active.key}</p>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-app-border pt-4">
          <TemplatePermissionsViewPanel catalog={permissions} grantedCodes={viewCodes} />
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-app-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setViewOpen(false);
              setActive(null);
              setViewCodes(new Set());
            }}
          >
            Close
          </Button>
          {active ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setViewOpen(false);
                openEdit(active);
              }}
              disabled={busy}
            >
              Edit perms
            </Button>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
