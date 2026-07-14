
import { json, defer } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { Await, useLoaderData, useFetcher } from '@remix-run/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { apiRequest, getSessionCookie, requirePermissionOrRoles, safeStatus } from '~/lib/api.server';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { extractApiErrorMessage } from '~/lib/api-error';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { useFetcherToast } from '~/components/ui/toast';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { CachedAwait } from '~/components/ui/cached-await';
import { cachedClientLoader } from '~/lib/loader-cache';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { CSMessageTemplatesLoadingShell } from '~/features/cs/CSDeferredLoadingShells';

export const meta: MetaFunction = () => [{ title: 'Message Templates — Yannis EOSE' }];

interface MessageTemplate {
  id: string;
  name: string;
  channel: 'SMS' | 'WHATSAPP';
  body: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
  /** Sales closers can only edit templates they themselves created. Heads/Admins can edit any. */
  createdBy: string;
}

function channelPillClass(channel: MessageTemplate['channel']): string {
  return channel === 'WHATSAPP'
    ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
    : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300';
}

function statusPillClass(status: MessageTemplate['status']): string {
  return status === 'ACTIVE'
    ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
    : 'bg-app-hover text-app-fg-muted';
}

// Sales closers can read & contribute templates (own templates editable; others read-only).
// Heads/Admins (via cs.teamOverview) can edit anything.
const TEMPLATE_ACCESS: { roles: string[]; permission: string } = {
  roles: ['CS_CLOSER'],
  permission: 'cs.teamOverview',
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requirePermissionOrRoles(request, TEMPLATE_ACCESS);
  const cookie = getSessionCookie(request);

  const pageData = (async () => {
    const res = await apiRequest<{ result?: { data?: MessageTemplate[] } }>(
      '/trpc/messaging.templates.list?input=%7B%22includeArchived%22%3Atrue%7D',
      { method: 'GET', cookie },
    );

    const templates: MessageTemplate[] = res.ok ? (res.data?.result?.data ?? []) : [];
    const userPerms = ((user as { permissions?: string[] }).permissions ?? []).map((p) =>
      canonicalPermissionCode(p),
    );
    const canEditAnyTemplate =
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'HEAD_OF_CS' ||
      userPerms.includes(canonicalPermissionCode('messaging.templates.update'));
    return {
      templates,
      currentUserId: user.id,
      canEditAnyTemplate,
    };
  })();

  return defer({ pageData });
}

export const clientLoader = cachedClientLoader;
clientLoader.hydrate = false;

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissionOrRoles(request, TEMPLATE_ACCESS);
  const cookie = getSessionCookie(request);
  const form = await request.formData();
  const intent = form.get('intent') as string;
  const normalizeBodyForBackend = (value: string) => toBackendBody(toUiBody(value));

  if (intent === 'create') {
    const name = form.get('name')?.toString()?.trim() ?? '';
    const channel = form.get('channel')?.toString() as 'SMS' | 'WHATSAPP';
    const body = normalizeBodyForBackend(form.get('body')?.toString()?.trim() ?? '');
    if (!name || !channel || !body) return json({ error: 'All fields are required' }, { status: 400 });

    const res = await apiRequest('/trpc/messaging.templates.create', {
      method: 'POST',
      cookie,
      body: { name, channel, body },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to create template') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  if (intent === 'update') {
    const templateId = form.get('templateId')?.toString() ?? '';
    const name = form.get('name')?.toString()?.trim();
    const bodyRaw = form.get('body')?.toString()?.trim();
    const body = bodyRaw !== undefined ? normalizeBodyForBackend(bodyRaw) : undefined;
    const status = form.get('status')?.toString() as 'ACTIVE' | 'ARCHIVED' | undefined;

    const res = await apiRequest('/trpc/messaging.templates.update', {
      method: 'POST',
      cookie,
      body: { templateId, name, body, status },
    });
    if (!res.ok) {
      return json({ error: extractApiErrorMessage(res.data, 'Failed to update template') }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const UI_TOKEN_PREFIX = '@';
const ALLOWED_PLACEHOLDER_KEYS = ['customer_name', 'customer_phone', 'order_id', 'product_name', 'delivery_address', 'estimated_date', 'quantity', 'total_amount', 'payment_status'] as const;
const ALLOWED_PLACEHOLDER_SET = new Set<string>(ALLOWED_PLACEHOLDER_KEYS);
const ALLOWED_UI_TOKENS = ALLOWED_PLACEHOLDER_KEYS.map((key) => `${UI_TOKEN_PREFIX}${key}`);
const PLACEHOLDER_HELP = ALLOWED_UI_TOKENS.join(', ');

/** Sample values for “Preview all” — same placeholders as live sends use from order data. */
const PREVIEW_SAMPLE_BY_KEY: Record<(typeof ALLOWED_PLACEHOLDER_KEYS)[number], string> = {
  customer_name: 'Jane Customer',
  customer_phone: '08031234567',
  order_id: 'A1B2C3D4',
  product_name: '2L Mineral Water (Pack of 12)',
  delivery_address: '15 Admiralty Way, Lekki Phase 1, Lagos',
  estimated_date: 'Mon, 28 Apr 2026',
  quantity: '2',
  total_amount: '45000.00',
  payment_status: 'Pay on Delivery',
};

function renderTemplateWithSampleData(body: string): string {
  let out = body;
  for (const key of ALLOWED_PLACEHOLDER_KEYS) {
    const sample = PREVIEW_SAMPLE_BY_KEY[key];
    const brace = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
    out = out.replace(brace, sample);
    const atTok = new RegExp(`@${key}\\b`, 'g');
    out = out.replace(atTok, sample);
  }
  return out;
}

function toUiBody(value: string): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (fullToken, key: string) => {
    if (!ALLOWED_PLACEHOLDER_SET.has(key)) return fullToken;
    return `${UI_TOKEN_PREFIX}${key}`;
  });
}

function toBackendBody(value: string): string {
  return value.replace(/@([a-zA-Z0-9_]+)\b/g, (fullToken, key: string) => {
    if (!ALLOWED_PLACEHOLDER_SET.has(key)) return fullToken;
    return `{{${key}}}`;
  });
}

function extractUnsupportedBodyTokens(body: string): string[] {
  const unsupported = new Set<string>();
  const atTokenRegex = /@([a-zA-Z0-9_]+)/g;
  const braceTokenRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

  for (const match of body.matchAll(atTokenRegex)) {
    const key = match[1]?.trim();
    if (key && !ALLOWED_PLACEHOLDER_SET.has(key)) {
      unsupported.add(`@${key}`);
    }
  }

  for (const match of body.matchAll(braceTokenRegex)) {
    const key = match[1]?.trim();
    if (key && !ALLOWED_PLACEHOLDER_SET.has(key)) {
      unsupported.add(`{{${key}}}`);
    }
  }

  return Array.from(unsupported);
}

function BodyEditor({
  body,
  onBodyChange,
  inputName,
  placeholder,
}: {
  body: string;
  onBodyChange: (value: string) => void;
  inputName: string;
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [insertVarKey, setInsertVarKey] = useState(0);

  const segments: Array<{ type: 'text' | 'valid' | 'invalid'; value: string }> = [];
  const tokenRegex = /(@[a-zA-Z0-9_]+)|(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g;
  let lastIndex = 0;

  for (const match of body.matchAll(tokenRegex)) {
    const start = match.index ?? 0;
    const fullToken = match[0] ?? '';
    const atTokenMatch = fullToken.match(/^@([a-zA-Z0-9_]+)$/);
    const braceTokenMatch = fullToken.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
    const key = (atTokenMatch?.[1] ?? braceTokenMatch?.[1] ?? '').trim();
    if (start > lastIndex) {
      segments.push({ type: 'text', value: body.slice(lastIndex, start) });
    }
    segments.push({
      type: !!atTokenMatch && ALLOWED_PLACEHOLDER_SET.has(key) ? 'valid' : 'invalid',
      value: fullToken,
    });
    lastIndex = start + fullToken.length;
  }

  if (lastIndex < body.length) {
    segments.push({ type: 'text', value: body.slice(lastIndex) });
  }

  const insertTokenAtCursor = (uiToken: string) => {
    const target = textareaRef.current;
    if (!target) return;

    const start = target.selectionStart ?? body.length;
    const end = target.selectionEnd ?? body.length;
    const nextValue = `${body.slice(0, start)}${uiToken}${body.slice(end)}`;
    onBodyChange(nextValue);

    window.requestAnimationFrame(() => {
      target.focus();
      const cursorPos = start + uiToken.length;
      target.setSelectionRange(cursorPos, cursorPos);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-app-fg-muted">Message Body</label>
        <div className="flex items-center gap-2">
          <FormSelect
            key={insertVarKey}
            id={`insert-variable-${insertVarKey}`}
            defaultValue=""
            onChange={(event) => {
              const token = event.target.value;
              if (!token) return;
              insertTokenAtCursor(token);
              setInsertVarKey((k) => k + 1);
            }}
            placeholder="Insert variable..."
            options={ALLOWED_UI_TOKENS.map((token) => ({ value: token, label: token }))}
            controlSize="sm"
            wrapperClassName="w-44"
            aria-label="Insert variable"
          />
        </div>
      </div>
      <Textarea
        ref={textareaRef}
        name={inputName}
        required
        minLength={5}
        maxLength={1600}
        rows={5}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        className="w-full font-mono text-sm resize-none"
        placeholder={placeholder}
      />
      <div className="rounded-lg border border-app-border bg-app-hover p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {body.length === 0 ? (
          <span className="text-app-fg-muted">Preview appears here</span>
        ) : (
          segments.map((segment, index) => {
            if (segment.type === 'text') return <span key={`${segment.type}-${index}`}>{segment.value}</span>;
            if (segment.type === 'valid') {
              return (
                <span
                  key={`${segment.type}-${index}`}
                  className="mx-0.5 inline-flex rounded-md bg-primary-100 px-1.5 py-0.5 font-mono text-xs font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
                >
                  {segment.value}
                </span>
              );
            }
            return (
              <span
                key={`${segment.type}-${index}`}
                className="mx-0.5 inline-flex rounded-md bg-danger-100 px-1.5 py-0.5 font-mono text-xs font-medium text-danger-700 dark:bg-danger-900/40 dark:text-danger-300"
              >
                {segment.value}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function MessageTemplatesPage({
  templates,
  currentUserId,
  canEditAnyTemplate,
}: {
  templates: MessageTemplate[];
  currentUserId: string;
  canEditAnyTemplate: boolean;
}) {
  const fetcher = useFetcher();
  const templateSurface = useFetcherActionSurface(fetcher);
  // Heads / Admins / `messaging.templates.update` holders can edit any template.
  // Sales closers can only edit ones they authored.
  const canEditTemplate = useCallback(
    (tpl: MessageTemplate) => canEditAnyTemplate || tpl.createdBy === currentUserId,
    [canEditAnyTemplate, currentUserId],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [previewAllOpen, setPreviewAllOpen] = useState(false);
  const [viewTemplate, setViewTemplate] = useState<MessageTemplate | null>(null);
  const [editTemplate, setEditTemplate] = useState<MessageTemplate | null>(null);
  const [filterChannel, setFilterChannel] = useState<'ALL' | 'SMS' | 'WHATSAPP'>('ALL');
  const [createBody, setCreateBody] = useState('');
  const [editBody, setEditBody] = useState('');

  const isSubmitting = fetcher.state !== 'idle';
  const createUnsupported = extractUnsupportedBodyTokens(createBody);
  const editUnsupported = extractUnsupportedBodyTokens(editBody);
  const createHasUnsupported = createUnsupported.length > 0;
  const editHasUnsupported = editUnsupported.length > 0;

  const filtered = filterChannel === 'ALL'
    ? templates
    : templates.filter((t) => t.channel === filterChannel);

  useFetcherToast(fetcher.data, {
    successMessage: 'Template saved',
    skipErrorToast: createOpen || !!editTemplate,
  });

  useEffect(() => {
    if (editTemplate) {
      setEditBody(toUiBody(editTemplate.body));
    }
  }, [editTemplate]);

  // Intent-filtered close: each modal closes only when its OWN action
  // succeeds, so submitting create never tears down the edit panel and vice
  // versa.
  const handleCreateSuccess = useCallback(() => setCreateOpen(false), []);
  const handleEditSuccess = useCallback(() => setEditTemplate(null), []);
  useCloseOnFetcherSuccess(fetcher, handleCreateSuccess, { intent: 'create' });
  useCloseOnFetcherSuccess(fetcher, handleEditSuccess, { intent: 'update' });

  const channelCounts = {
    ALL: templates.length,
    SMS: templates.filter((t) => t.channel === 'SMS').length,
    WHATSAPP: templates.filter((t) => t.channel === 'WHATSAPP').length,
  };

  const templateColumns: CompactTableColumn<MessageTemplate>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        hideable: false,
        render: (tpl) => <span className="font-medium text-app-fg">{tpl.name}</span>,
      },
      {
        key: 'channel',
        header: 'Channel',
        render: (tpl) => (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${channelPillClass(tpl.channel)}`}>
            {tpl.channel}
          </span>
        ),
      },
      {
        key: 'preview',
        header: 'Preview',
        minWidth: 'min-w-[200px]',
        cellClassName: 'max-w-xs',
        cellTitle: (tpl) => toUiBody(tpl.body),
        render: (tpl) => (
          <span className="text-app-fg-muted text-xs truncate block">{toUiBody(tpl.body)}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (tpl) => (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusPillClass(tpl.status)}`}>
            {tpl.status}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        mobileLabel: 'Actions',
        align: 'right',
        tight: true,
        nowrap: true,
        hideable: false,
        minWidth: 'min-w-[9.5rem]',
        render: (tpl) => (
          <div className="inline-flex flex-nowrap items-center justify-end gap-1.5 shrink-0">
            <CompactTableActionButton onClick={() => setViewTemplate(tpl)}>View</CompactTableActionButton>
            {canEditTemplate(tpl) ? (
              <CompactTableActionButton
                className="!text-app-fg-muted hover:!text-brand-500 dark:hover:!text-brand-400"
                onClick={() => setEditTemplate(tpl)}
              >
                Edit
              </CompactTableActionButton>
            ) : null}
          </div>
        ),
      },
    ],
    [canEditTemplate],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Message Templates"
        mobileInlineActions
        description="Manage SMS and WhatsApp templates."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Message template tools"
            sheetSubtitle={<span>Preview and create</span>}
            triggerAriaLabel="Message template toolbar"
            desktop={
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPreviewAllOpen(true)}
                  disabled={filtered.length === 0}
                  title={filtered.length === 0 ? 'No templates to preview' : 'See every template with sample data'}
                >
                  Preview all
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setCreateBody('');
                    setCreateOpen(true);
                  }}
                >
                  + New Template
                </Button>
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setPreviewAllOpen(true);
                  }}
                  disabled={filtered.length === 0}
                  title={filtered.length === 0 ? 'No templates to preview' : 'See every template with sample data'}
                >
                  Preview all
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setCreateBody('');
                    setCreateOpen(true);
                  }}
                >
                  + New Template
                </Button>
              </>
            )}
          />
        }
      />

      {/* Channel tabs */}
      <Tabs
        value={filterChannel}
        onChange={(v) => setFilterChannel(v as typeof filterChannel)}
        tabs={[
          { value: 'ALL', label: `All (${channelCounts.ALL})` },
          { value: 'SMS', label: `SMS (${channelCounts.SMS})` },
          { value: 'WHATSAPP', label: `WhatsApp (${channelCounts.WHATSAPP})` },
        ]}
      />

      <CompactTable<MessageTemplate>
        columnVisibilityKey="admin.sales.message-templates"
        columns={templateColumns}
        rows={filtered}
        rowKey={(tpl) => tpl.id}
        emptyTitle="No templates yet"
        emptyDescription="Create one to enable SMS/WhatsApp messaging."
        renderMobileCard={(tpl) => (
          <button
            type="button"
            onClick={() => setViewTemplate(tpl)}
            className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-app-fg truncate">{tpl.name}</span>
              <span
                className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-xs font-medium ${channelPillClass(tpl.channel)}`}
              >
                {tpl.channel}
              </span>
            </div>
            <p className="text-xs text-app-fg-muted line-clamp-2 break-words">{toUiBody(tpl.body)}</p>
          </button>
        )}
      />

      {viewTemplate && (
        <Modal
          open
          onClose={() => setViewTemplate(null)}
          maxWidth="max-w-2xl"
          contentClassName="p-5 max-h-[85vh] overflow-y-auto"
          aria-labelledby="view-template-title"
          aria-describedby="view-template-desc"
        >
          <h3 id="view-template-title" className="text-lg font-semibold text-app-fg">
            {viewTemplate.name}
          </h3>
          <p id="view-template-desc" className="mt-1 text-xs text-app-fg-muted">
            Sample values stand in for variables (same placeholders as on orders). Live sends use real order fields.
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  viewTemplate.channel === 'WHATSAPP'
                    ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                    : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                }`}
              >
                {viewTemplate.channel}
              </span>
            </div>
            <p className="text-xs text-app-fg-muted">
              Status: <span className="font-medium text-app-fg">{viewTemplate.status}</span>
            </p>
            <div className="rounded-md border border-app-border bg-app-canvas px-3 py-2.5 text-sm text-app-fg whitespace-pre-wrap break-words leading-relaxed">
              {renderTemplateWithSampleData(viewTemplate.body)}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 justify-end border-t border-app-border pt-4">
            {canEditTemplate(viewTemplate) && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  const tpl = viewTemplate;
                  setViewTemplate(null);
                  setEditTemplate(tpl);
                }}
              >
                Edit
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => setViewTemplate(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {/* Preview all templates */}
      {previewAllOpen && (
        <Modal
          open
          onClose={() => setPreviewAllOpen(false)}
          maxWidth="max-w-2xl"
          contentClassName="p-5 max-h-[85vh] overflow-y-auto"
          aria-labelledby="preview-all-templates-title"
          aria-describedby="preview-all-templates-desc"
        >
          <h3 id="preview-all-templates-title" className="text-lg font-semibold text-app-fg">
            Preview all templates
          </h3>
          <p id="preview-all-templates-desc" className="mt-1 text-xs text-app-fg-muted">
            Sample values stand in for variables (same placeholders as on orders). Live sends use real order fields.
          </p>
          <div className="mt-4 space-y-4">
            {filtered.map((tpl) => (
              <div
                key={tpl.id}
                className="rounded-lg border border-app-border bg-app-elevated p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-app-fg">{tpl.name}</p>
                  <span
                    className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      tpl.channel === 'WHATSAPP'
                        ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                        : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                    }`}
                  >
                    {tpl.channel}
                  </span>
                </div>
                <p className="mt-1 text-xs text-app-fg-muted">
                  Status: <span className="font-medium text-app-fg">{tpl.status}</span>
                </p>
                <div className="mt-3 rounded-md border border-app-border bg-app-canvas px-3 py-2.5 text-sm text-app-fg whitespace-pre-wrap break-words leading-relaxed">
                  {renderTemplateWithSampleData(tpl.body)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end border-t border-app-border pt-4">
            <Button type="button" variant="secondary" size="sm" onClick={() => setPreviewAllOpen(false)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {/* Create Modal */}
      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} maxWidth="max-w-lg" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">Create Template</h3>
          <p className="text-xs text-app-fg-muted mb-4">
            Available variables: <span className="font-mono text-primary-600">{PLACEHOLDER_HELP}</span>
          </p>
          <fetcher.Form
            method="post"
            className="space-y-4"
            onSubmit={(event) => {
              if (createHasUnsupported) {
                event.preventDefault();
                return;
              }
            }}
          >
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="body" value={toBackendBody(createBody)} />
            <TextInput
              name="name"
              type="text"
              label="Template Name"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Order Confirmation"
            />
            <FormSelect
              name="channel"
              label="Channel"
              required
              defaultValue=""
              placeholder="Select channel…"
              options={[
                { value: 'SMS', label: 'SMS' },
                { value: 'WHATSAPP', label: 'WhatsApp' },
              ]}
            />
            <BodyEditor
              body={createBody}
              onBodyChange={setCreateBody}
              inputName="body_editor"
              placeholder="Hi @customer_name, your order @order_id is confirmed."
            />
            {createHasUnsupported && (
              <p className="text-sm text-danger-600">
                Only these variables are supported: {ALLOWED_UI_TOKENS.join(', ')}. Remove: {createUnsupported.join(', ')}.
              </p>
            )}
            <ModalFetcherInlineError message={templateSurface.errorMatchingIntent('create')} />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={isSubmitting || createHasUnsupported} loading={isSubmitting} loadingText="Creating…">
                Create
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Edit Modal */}
      {editTemplate && (
        <Modal open onClose={() => setEditTemplate(null)} maxWidth="max-w-lg" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">Edit Template</h3>
          <p className="text-xs text-app-fg-muted mb-4">
            Available variables: <span className="font-mono text-primary-600">{PLACEHOLDER_HELP}</span>
          </p>
          <fetcher.Form
            method="post"
            className="space-y-4"
            onSubmit={(event) => {
              if (editHasUnsupported) {
                event.preventDefault();
                return;
              }
            }}
          >
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="templateId" value={editTemplate.id} />
            <input type="hidden" name="body" value={toBackendBody(editBody)} />
            <TextInput
              name="name"
              type="text"
              label="Template Name"
              defaultValue={editTemplate.name}
              required
            />
            <BodyEditor
              body={editBody}
              onBodyChange={setEditBody}
              inputName="body_editor"
              placeholder="Hi @customer_name, your order @order_id is confirmed."
            />
            {editHasUnsupported && (
              <p className="text-sm text-danger-600">
                Only these variables are supported: {ALLOWED_UI_TOKENS.join(', ')}. Remove: {editUnsupported.join(', ')}.
              </p>
            )}
            <FormSelect
              name="status"
              label="Status"
              defaultValue={editTemplate.status}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'ARCHIVED', label: 'Archived' },
              ]}
            />
            <ModalFetcherInlineError message={templateSurface.errorMatchingIntent('update')} />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="secondary" onClick={() => setEditTemplate(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={isSubmitting || editHasUnsupported} loading={isSubmitting} loadingText="Saving…">
                Save
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}
    </div>
  );
}

export default function MessageTemplatesRoute() {
  const { pageData } = useLoaderData<typeof loader>();
  return (
    <CachedAwait
      resolve={pageData}
      fallback={<CSMessageTemplatesLoadingShell />}
      loaderShell={{}}
      deferredKey="pageData"
    >
        {(data) => (
          <MessageTemplatesPage
            templates={data.templates}
            currentUserId={data.currentUserId}
            canEditAnyTemplate={data.canEditAnyTemplate}
          />
        )}
      </CachedAwait>
  );
}
