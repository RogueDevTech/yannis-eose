import { json } from '@remix-run/node';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { useLoaderData, useFetcher } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, getSessionCookie, requirePermission, safeStatus } from '~/lib/api.server';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';

export const meta: MetaFunction = () => [{ title: 'Message Templates — Yannis EOSE' }];

interface MessageTemplate {
  id: string;
  name: string;
  channel: 'SMS' | 'WHATSAPP';
  body: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermission(request, 'cs.teamOverview');
  const cookie = getSessionCookie(request);

  const res = await apiRequest<{ result?: { data?: MessageTemplate[] } }>(
    '/trpc/messaging.templates.list?input=%7B%22includeArchived%22%3Atrue%7D',
    { method: 'GET', cookie },
  );

  const templates: MessageTemplate[] = res.ok ? (res.data?.result?.data ?? []) : [];
  return { templates };
}

export async function action({ request }: ActionFunctionArgs) {
  await requirePermission(request, 'cs.teamOverview');
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
      const err = res.data as { error?: { message?: string } };
      return json({ error: err?.error?.message ?? 'Failed to create template' }, { status: safeStatus(res.status) });
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
      const err = res.data as { error?: { message?: string } };
      return json({ error: err?.error?.message ?? 'Failed to update template' }, { status: safeStatus(res.status) });
    }
    return json({ success: true });
  }

  return json({ error: 'Unknown intent' }, { status: 400 });
}

const UI_TOKEN_PREFIX = '@';
const ALLOWED_PLACEHOLDER_KEYS = ['customer_name', 'order_id', 'product_name', 'delivery_address', 'estimated_date'] as const;
const ALLOWED_PLACEHOLDER_SET = new Set<string>(ALLOWED_PLACEHOLDER_KEYS);
const ALLOWED_UI_TOKENS = ALLOWED_PLACEHOLDER_KEYS.map((key) => `${UI_TOKEN_PREFIX}${key}`);
const PLACEHOLDER_HELP = ALLOWED_UI_TOKENS.join(', ');

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
        <label className="block text-sm font-medium text-surface-800 dark:text-surface-200">Message Body</label>
        <div className="flex items-center gap-2">
          <select
            className="input w-44 text-xs"
            defaultValue=""
            onChange={(event) => {
              const token = event.target.value;
              if (!token) return;
              insertTokenAtCursor(token);
              event.target.value = '';
            }}
            aria-label="Insert variable"
          >
            <option value="">Insert variable...</option>
            {ALLOWED_UI_TOKENS.map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </select>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        name={inputName}
        required
        minLength={5}
        maxLength={1600}
        rows={5}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        className="input w-full resize-none font-mono text-sm"
        placeholder={placeholder}
      />
      <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50/70 dark:bg-surface-900/40 p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">
        {body.length === 0 ? (
          <span className="text-surface-500 dark:text-surface-400">Preview appears here</span>
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

export default function MessageTemplatesRoute() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  useFetcherToast(fetcher.data, { successMessage: 'Template saved' });
  const fetcherResult = fetcher.data as { success?: boolean; error?: string } | undefined;

  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<MessageTemplate | null>(null);
  const [filterChannel, setFilterChannel] = useState<'ALL' | 'SMS' | 'WHATSAPP'>('ALL');
  const [createBody, setCreateBody] = useState('');
  const [editBody, setEditBody] = useState('');
  const [submittingIntent, setSubmittingIntent] = useState<'create' | 'update' | null>(null);

  const isSubmitting = fetcher.state !== 'idle';
  const createUnsupported = extractUnsupportedBodyTokens(createBody);
  const editUnsupported = extractUnsupportedBodyTokens(editBody);
  const createHasUnsupported = createUnsupported.length > 0;
  const editHasUnsupported = editUnsupported.length > 0;

  const filtered = filterChannel === 'ALL'
    ? templates
    : templates.filter((t) => t.channel === filterChannel);

  useEffect(() => {
    if (editTemplate) {
      setEditBody(toUiBody(editTemplate.body));
    }
  }, [editTemplate]);

  useEffect(() => {
    if (!submittingIntent || fetcher.state !== 'idle') return;

    if (fetcherResult?.success) {
      if (submittingIntent === 'create') {
        setCreateOpen(false);
      } else {
        setEditTemplate(null);
      }
    }

    setSubmittingIntent(null);
  }, [fetcher.state, fetcherResult?.success, submittingIntent]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-surface-900 dark:text-white">Message Templates</h1>
          <p className="text-sm text-surface-600 dark:text-surface-400 mt-0.5">
            Pre-configured SMS and WhatsApp templates for CS agents. Type plain variable tokens like @customer_name.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => { setCreateBody(''); setCreateOpen(true); }}>
          + New Template
        </Button>
      </div>

      {/* Channel filter */}
      <div className="flex gap-2">
        {(['ALL', 'SMS', 'WHATSAPP'] as const).map((ch) => (
          <button
            key={ch}
            type="button"
            onClick={() => setFilterChannel(ch)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors duration-150 ${
              filterChannel === ch
                ? 'bg-primary-600 text-white'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}
          >
            {ch === 'ALL' ? 'All Channels' : ch}
          </button>
        ))}
      </div>

      {/* Templates table */}
      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 dark:border-surface-700">
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Name</th>
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Channel</th>
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Preview</th>
              <th className="px-4 py-3 text-left font-medium text-surface-600 dark:text-surface-400">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100 dark:divide-surface-800">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-surface-500 dark:text-surface-400">
                  No templates yet. Create one to enable SMS/WhatsApp messaging.
                </td>
              </tr>
            )}
            {filtered.map((tpl) => (
              <tr key={tpl.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/50">
                <td className="px-4 py-3 font-medium text-surface-900 dark:text-surface-100">{tpl.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    tpl.channel === 'WHATSAPP'
                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                      : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  }`}>
                    {tpl.channel}
                  </span>
                </td>
                <td className="px-4 py-3 text-surface-600 dark:text-surface-400 text-xs max-w-xs truncate">
                  {toUiBody(tpl.body)}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    tpl.status === 'ACTIVE'
                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                      : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'
                  }`}>
                    {tpl.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button variant="secondary" size="sm" onClick={() => setEditTemplate(tpl)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {createOpen && (
        <Modal open onClose={() => setCreateOpen(false)} maxWidth="max-w-lg" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Create Template</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
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
              setSubmittingIntent('create');
            }}
          >
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="body" value={toBackendBody(createBody)} />
            <div>
              <label className="block text-sm font-medium text-surface-800 dark:text-surface-200 mb-1">Template Name</label>
              <input name="name" type="text" required minLength={2} maxLength={100} className="input w-full" placeholder="e.g. Order Confirmation" />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-800 dark:text-surface-200 mb-1">Channel</label>
              <select name="channel" required className="input w-full">
                <option value="">Select channel…</option>
                <option value="SMS">SMS</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
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
            {fetcherResult?.error && (
              <p className="text-sm text-danger-600">{fetcherResult.error}</p>
            )}
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
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Edit Template</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
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
              setSubmittingIntent('update');
            }}
          >
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="templateId" value={editTemplate.id} />
            <input type="hidden" name="body" value={toBackendBody(editBody)} />
            <div>
              <label className="block text-sm font-medium text-surface-800 dark:text-surface-200 mb-1">Template Name</label>
              <input name="name" type="text" defaultValue={editTemplate.name} required className="input w-full" />
            </div>
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
            <div>
              <label className="block text-sm font-medium text-surface-800 dark:text-surface-200 mb-1">Status</label>
              <select name="status" defaultValue={editTemplate.status} className="input w-full">
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
            {fetcherResult?.error && (
              <p className="text-sm text-danger-600">{fetcherResult.error}</p>
            )}
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
