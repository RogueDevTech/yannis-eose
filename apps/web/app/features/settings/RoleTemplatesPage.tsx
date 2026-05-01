import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useRevalidator } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { Modal } from '~/components/ui/modal';
import { DataTable, type TableColumn } from '~/components/ui/data-table';
import type { RoleTemplateOption } from '~/features/users/types';

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
}

interface LoaderShape {
  templates: RoleTemplateOption[];
  permissions: PermissionCatalogRow[];
}

type ActionData = { ok?: boolean; error?: string; permissionCodes?: string[] };

function parseCodes(text: string): string[] {
  const parts = text
    .split(/[\n,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

export function RoleTemplatesPage({ templates, permissions }: LoaderShape) {
  const fetcher = useFetcher<ActionData>();
  const revalidator = useRevalidator();
  const lastSuccess = useRef<string | null>(null);

  const permCodesSorted = useMemo(() => permissions.map((p) => p.code).sort(), [permissions]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [active, setActive] = useState<RoleTemplateOption | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftCodesText, setDraftCodesText] = useState('');

  const busy = fetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.state !== 'idle') return;
    const d = fetcher.data;
    if (!d || !('ok' in d) || !d.ok) return;
    const sig = JSON.stringify(d);
    if (lastSuccess.current === sig) return;
    lastSuccess.current = sig;
    setCreateOpen(false);
    setEditOpen(false);
    setActive(null);
    setDraftCodesText('');
    revalidator.revalidate();
  }, [fetcher.state, fetcher.data, revalidator]);

  useEffect(() => {
    if (!editOpen || !active) return;
    if (fetcher.state !== 'idle') return;
    const codes = fetcher.data?.permissionCodes;
    if (!codes) return;
    setDraftCodesText(codes.join('\n'));
  }, [editOpen, active, fetcher.state, fetcher.data?.permissionCodes]);

  const openCreate = () => {
    setDraftKey('');
    setDraftName('');
    setDraftDesc('');
    setDraftCodesText('');
    setCreateOpen(true);
  };

  const openEdit = (t: RoleTemplateOption) => {
    setActive(t);
    setDraftCodesText('');
    setEditOpen(true);
    const fd = new FormData();
    fd.set('intent', 'getTemplate');
    fd.set('templateId', t.id);
    fetcher.submit(fd, { method: 'post' });
  };

  const rows: TemplateTableRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    key: t.key,
    kind: t.kind,
    mappedRole: t.mappedRole ?? '—',
    __tpl: t,
  }));

  const templateColumns: TableColumn<TemplateTableRow>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'key', header: 'Key', render: (r) => <span className="font-mono text-xs">{r.key}</span> },
    { key: 'kind', header: 'Kind', render: (r) => r.kind },
    { key: 'mappedRole', header: 'Mapped role', render: (r) => r.mappedRole },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => openEdit(r.__tpl)}
          disabled={busy}
        >
          Edit perms
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role templates"
        description="Permission-first presets. SYSTEM templates map to legacy enum roles; CUSTOM templates can combine any permissions."
        actions={
          <Button type="button" variant="primary" onClick={openCreate} disabled={busy}>
            New template
          </Button>
        }
      />

      {fetcher.data?.error && (
        <div className="rounded-md border border-danger-200 bg-danger-50 dark:bg-danger-900/20 px-3 py-2 text-sm text-danger-700">
          {fetcher.data.error}
        </div>
      )}

      <Card>
        <CardHeader title="Templates" />
        <CardBody className="p-0">
          <DataTable columns={templateColumns} data={rows} keyField="id" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Permission catalog" />
        <CardBody>
          <p className="text-sm text-app-fg-muted mb-3">
            {permCodesSorted.length} codes — use these strings in templates. The API rejects unknown
            codes.
          </p>
          <div className="max-h-64 overflow-auto rounded-md border border-app-border">
            <table className="min-w-full text-xs">
              <thead className="bg-app-hover sticky top-0">
                <tr>
                  <th className="text-left p-2">Code</th>
                  <th className="text-left p-2">Resource</th>
                  <th className="text-left p-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((p) => (
                  <tr key={p.code} className="border-t border-app-border">
                    <td className="p-2 font-mono">{p.code}</td>
                    <td className="p-2">{p.resource}</td>
                    <td className="p-2">{p.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => !busy && setCreateOpen(false)}
        maxWidth="max-w-2xl"
        contentClassName="flex max-h-[90vh] flex-col gap-4 bg-app-elevated p-6"
      >
        <h3 className="text-lg font-semibold text-app-fg">Create custom template</h3>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
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
          <Textarea
            label="Initial permission codes (optional)"
            value={draftCodesText}
            onChange={(e) => setDraftCodesText(e.target.value)}
            hint="One per line or comma-separated."
            rows={6}
          />
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
              fd.set('permissionCodes', JSON.stringify(parseCodes(draftCodesText)));
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
          setDraftCodesText('');
        }}
        maxWidth="max-w-2xl"
        contentClassName="flex max-h-[90vh] flex-col gap-4 bg-app-elevated p-6"
      >
        <h3 className="text-lg font-semibold text-app-fg">
          {active ? `Edit permissions — ${active.name}` : 'Edit permissions'}
        </h3>
        <Textarea
          label="Permission codes"
          value={draftCodesText}
          onChange={(e) => setDraftCodesText(e.target.value)}
          rows={12}
        />
        <div className="flex shrink-0 justify-end gap-2 border-t border-app-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEditOpen(false);
              setActive(null);
              setDraftCodesText('');
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
              fd.set('permissionCodes', JSON.stringify(parseCodes(draftCodesText)));
              fetcher.submit(fd, { method: 'post' });
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </div>
  );
}
