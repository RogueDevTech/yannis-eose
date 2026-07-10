import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { canonicalPermissionCode } from '~/lib/permission-codes';

// ─── Types ───────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

type TrpcEnvelope<T> = { result?: { data?: T }; error?: { message?: string } };

type DrawerView = 'chat' | 'sessions' | 'settings';

// ─── API Helpers ─────────────────────────────────────────────────────

async function trpcQuery<T>(procedure: string, input?: Record<string, unknown>): Promise<T | null> {
  const base = getBrowserApiBaseUrl();
  if (!base) return null;
  const url = input
    ? `${base}/trpc/aiAssistant.${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
    : `${base}/trpc/aiAssistant.${procedure}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  const json = (await res.json()) as TrpcEnvelope<T>;
  return json?.result?.data ?? null;
}

async function trpcMutate<T>(procedure: string, input: Record<string, unknown>): Promise<T> {
  const base = getBrowserApiBaseUrl();
  if (!base) throw new Error('API not configured');
  const res = await fetch(`${base}/trpc/aiAssistant.${procedure}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const raw = await res.text();
  let json: TrpcEnvelope<T> & { error?: { message?: string } };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('Invalid response from server');
  }
  if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
  return json.result?.data as T;
}

// ─── Permission Check ────────────────────────────────────────────────

export function hasAiAssistantAccess(user: { role: string; permissions?: string[] } | null): boolean {
  if (!user) return false;
  // SSR: never render (uses createPortal → document.body)
  if (typeof window === 'undefined') return false;
  // Dev flag: hidden unless ENABLE_AI_ASSISTANT=true in env
  if (!window.__ENV?.ENABLE_AI_ASSISTANT) return false;
  if (['SUPER_ADMIN', 'ADMIN', 'SUPPORT'].includes(user.role)) return true;
  return (user.permissions ?? []).map(canonicalPermissionCode).includes('ai.assistant.access');
}

// ─── Markdown-ish Renderer ───────────────────────────────────────────

function renderMessageContent(content: string) {
  // Split into lines and process basic markdown
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let tableHeader: string[] = [];

  const flushTable = () => {
    if (tableRows.length === 0 && tableHeader.length === 0) return;
    elements.push(
      <div key={`table-${elements.length}`} className="overflow-x-auto my-2">
        <table className="min-w-full text-xs border-collapse">
          {tableHeader.length > 0 && (
            <thead>
              <tr className="border-b border-app-border">
                {tableHeader.map((h, i) => (
                  <th key={i} className="px-2 py-1.5 text-left font-medium text-app-fg-muted whitespace-nowrap">
                    {h.trim()}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {tableRows.map((row, ri) => (
              <tr key={ri} className="border-b border-app-border/50">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-2 py-1 text-app-fg whitespace-nowrap">
                    {cell.trim()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
    tableHeader = [];
    inTable = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table detection
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      // Check if this is a separator line (----)
      if (cells.every((c) => /^[\s-:]+$/.test(c))) {
        continue; // Skip separator
      }
      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    }

    if (inTable) flushTable();

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-semibold text-sm mt-3 mb-1 text-app-fg">{line.slice(4)}</h4>);
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="font-semibold text-sm mt-3 mb-1 text-app-fg">{line.slice(3)}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="font-bold text-base mt-3 mb-1 text-app-fg">{line.slice(2)}</h2>);
    }
    // Bullet points
    else if (/^[\s]*[-*]\s/.test(line)) {
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      elements.push(
        <div key={i} className="flex gap-1.5 text-sm text-app-fg" style={{ paddingLeft: `${Math.min(indent, 8) * 4}px` }}>
          <span className="text-app-fg-muted mt-0.5">-</span>
          <span>{formatInlineMarkdown(line.replace(/^[\s]*[-*]\s/, ''))}</span>
        </div>,
      );
    }
    // Bold line (starts with **)
    else if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(<p key={i} className="font-semibold text-sm text-app-fg mt-1">{line.slice(2, -2)}</p>);
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />);
    }
    // Regular text
    else {
      elements.push(<p key={i} className="text-sm text-app-fg leading-relaxed">{formatInlineMarkdown(line)}</p>);
    }
  }

  if (inTable) flushTable();

  return <>{elements}</>;
}

function formatInlineMarkdown(text: string): React.ReactNode {
  // Bold
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    // Code
    const codeParts = part.split(/(`[^`]+`)/g);
    if (codeParts.length > 1) {
      return codeParts.map((cp, j) => {
        if (cp.startsWith('`') && cp.endsWith('`')) {
          return (
            <code key={`${i}-${j}`} className="px-1 py-0.5 bg-app-hover rounded text-xs font-mono">
              {cp.slice(1, -1)}
            </code>
          );
        }
        return cp;
      });
    }
    return part;
  });
}

// ─── Floating Button ─────────────────────────────────────────────────

export function AiChatButton({ user }: {
  user: { id: string; role: string; permissions?: string[] } | null;
}) {
  const [open, setOpen] = useState(false);

  if (!hasAiAssistantAccess(user)) return null;

  return (
    <>
      {/* Floating action button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed z-[70] right-4 bottom-20 md:bottom-6 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center ${open ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}
        aria-label="Open AI Assistant"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      </button>

      {/* Chat drawer */}
      {open && <ChatDrawer user={user!} onClose={() => setOpen(false)} />}
    </>
  );
}

// ─── Chat Drawer ─────────────────────────────────────────────────────

function ChatDrawer({ user, onClose }: {
  user: { id: string; role: string; permissions?: string[] };
  onClose: () => void;
}) {
  const [view, setView] = useState<DrawerView>('chat');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mounted, setMounted] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null); // null = loading

  useEffect(() => { setMounted(true); }, []);

  // Check if any API key is configured on mount
  useEffect(() => {
    Promise.all([
      trpcQuery<{ exists: boolean }>('personalApiKeyExists'),
      trpcQuery<{ exists: boolean }>('orgApiKeyExists'),
    ]).then(([personal, org]) => {
      const connected = personal?.exists || org?.exists || false;
      setHasApiKey(connected);
      if (!connected) setView('settings');
    });
  }, []);

  // Load sessions on mount (only if we have a key)
  useEffect(() => {
    if (hasApiKey !== true) return;
    trpcQuery<ChatSession[]>('listSessions', { limit: 30, offset: 0 }).then((data) => {
      if (data) setSessions(data);
    });
  }, [hasApiKey]);

  // Load messages when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    trpcQuery<ChatMessage[]>('getSessionMessages', { sessionId: activeSessionId }).then((data) => {
      if (data) setMessages(data);
    });
  }, [activeSessionId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input
  useEffect(() => {
    if (view === 'chat') inputRef.current?.focus();
  }, [view]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || sending) return;

    setInput('');
    setSending(true);
    setError(null);

    // Optimistic user message
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: 'user', content: msg, createdAt: new Date().toISOString() }]);

    try {
      const result = await trpcMutate<{
        sessionId: string;
        assistantMessage: string;
        sessionTitle?: string;
      }>('sendMessage', {
        sessionId: activeSessionId ?? undefined,
        message: msg,
      });

      // Set session if new
      if (!activeSessionId) {
        setActiveSessionId(result.sessionId);
        setSessions((prev) => [
          { id: result.sessionId, title: result.sessionTitle || msg.slice(0, 60), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          ...prev,
        ]);
      }

      // Add assistant response
      setMessages((prev) => [
        ...prev,
        { id: `resp-${Date.now()}`, role: 'assistant', content: result.assistantMessage, createdAt: new Date().toISOString() },
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }, [input, sending, activeSessionId]);

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setView('chat');
    setError(null);
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await trpcMutate('deleteSession', { sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch {
      // silently fail
    }
  };

  const handleSelectSession = (session: ChatSession) => {
    setActiveSessionId(session.id);
    setView('chat');
  };

  if (!mounted) return null;

  const drawer = (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[85] bg-black/30 md:bg-transparent" onClick={onClose} aria-hidden />

      {/* Drawer panel */}
      <div className="fixed z-[86] inset-0 md:inset-auto md:right-4 md:bottom-4 md:top-auto md:left-auto md:w-[420px] md:h-[600px] md:max-h-[80vh] md:rounded-xl bg-app-elevated border border-app-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-1 px-3 py-2.5 border-b border-app-border bg-app-elevated shrink-0">
          <button type="button" onClick={() => setView('sessions')} className="p-1.5 rounded-md hover:bg-app-hover text-app-fg-muted" title="Chat history">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <h2 className="flex-1 text-sm font-semibold text-app-fg truncate">
            {view === 'sessions' ? 'Chat History' : view === 'settings' ? 'AI Settings' : 'AI Assistant'}
          </h2>
          <button type="button" onClick={handleNewChat} className="p-1.5 rounded-md hover:bg-app-hover text-app-fg-muted" title="New chat">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
          <button type="button" onClick={() => setView('settings')} className="p-1.5 rounded-md hover:bg-app-hover text-app-fg-muted" title="Settings">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button type="button" onClick={onClose} className="ml-1 p-1.5 rounded-md hover:bg-danger-100 dark:hover:bg-danger-900/30 text-app-fg-muted hover:text-danger-600" title="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        {hasApiKey === null ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-app-fg-muted">Loading...</p>
            </div>
          </div>
        ) : view === 'sessions' ? (
          <SessionsList
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
            onNewChat={handleNewChat}
          />
        ) : view === 'settings' ? (
          <ApiKeySettings user={user} onBack={() => setView('chat')} onKeyConnected={() => { setHasApiKey(true); setView('chat'); }} isFirstSetup={hasApiKey === false} />
        ) : (
          <>
            {/* Messages area */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {messages.length === 0 && !sending && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-3">
                    <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-app-fg mb-1">AI Assistant</p>
                  <p className="text-xs text-app-fg-muted max-w-[240px]">
                    Ask about orders, revenue, inventory, staff, or how to use the app.
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 ${
                      msg.role === 'user'
                        ? 'bg-primary-600 text-white'
                        : 'bg-app-hover text-app-fg'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      renderMessageContent(msg.content)
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="bg-app-hover rounded-lg px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-app-fg-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-app-fg-muted animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-app-fg-muted animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-lg px-3 py-2 text-xs text-danger-700 dark:text-danger-300">
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div className="shrink-0 border-t border-app-border px-3 py-2 bg-app-elevated">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask about your data..."
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-app-border bg-app-canvas px-3 py-2 text-sm text-app-fg placeholder:text-app-fg-muted focus:outline-none focus:ring-1 focus:ring-blue-500 max-h-[120px]"
                  style={{ minHeight: '36px' }}
                  disabled={sending}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                  className="shrink-0 w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              </div>
              <p className="text-[10px] text-app-fg-muted mt-1 text-right">
                {input.length}/4000
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );

  return createPortal(drawer, document.body);
}

// ─── Sessions List ───────────────────────────────────────────────────

function SessionsList({ sessions, activeSessionId, onSelect, onDelete, onNewChat }: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelect: (session: ChatSession) => void;
  onDelete: (sessionId: string) => void;
  onNewChat: () => void;
}) {
  const fmt = new Intl.DateTimeFormat('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex-1 overflow-y-auto">
      <button
        type="button"
        onClick={onNewChat}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-blue-600 dark:text-blue-400 hover:bg-app-hover border-b border-app-border"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New conversation
      </button>

      {sessions.length === 0 && (
        <p className="px-4 py-8 text-xs text-app-fg-muted text-center">No conversations yet</p>
      )}

      {sessions.map((session) => (
        <div
          key={session.id}
          className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-app-hover border-b border-app-border/50 ${
            session.id === activeSessionId ? 'bg-blue-50 dark:bg-blue-900/20' : ''
          }`}
          onClick={() => onSelect(session)}
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm text-app-fg truncate">{session.title || 'Untitled'}</p>
            <p className="text-[10px] text-app-fg-muted">
              {fmt.format(new Date(session.updatedAt))}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
            className="p-1 rounded hover:bg-danger-100 dark:hover:bg-danger-900/30 text-app-fg-muted hover:text-danger-600"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── API Key Settings ────────────────────────────────────────────────

function ApiKeySettings({ user, onBack, onKeyConnected, isFirstSetup }: {
  user: { id: string; role: string; permissions?: string[] };
  onBack: () => void;
  onKeyConnected?: () => void;
  /** True when opened because no API key exists yet */
  isFirstSetup?: boolean;
}) {
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(user.role);
  const [orgKeyExists, setOrgKeyExists] = useState<boolean | null>(null);
  const [personalKeyExists, setPersonalKeyExists] = useState<boolean | null>(null);
  const [orgKeyInput, setOrgKeyInput] = useState('');
  const [personalKeyInput, setPersonalKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    trpcQuery<{ exists: boolean }>('orgApiKeyExists').then((data) => {
      if (data) setOrgKeyExists(data.exists);
    });
    trpcQuery<{ exists: boolean }>('personalApiKeyExists').then((data) => {
      if (data) setPersonalKeyExists(data.exists);
    });
  }, []);

  const handleSaveOrgKey = async () => {
    if (!orgKeyInput.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await trpcMutate('saveOrgApiKey', { apiKey: orgKeyInput.trim() });
      setOrgKeyExists(true);
      setOrgKeyInput('');
      setMessage({ type: 'success', text: 'Organization API key saved' });
      onKeyConnected?.();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save key' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrgKey = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await trpcMutate('deleteOrgApiKey', {});
      setOrgKeyExists(false);
      setMessage({ type: 'success', text: 'Organization API key removed' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to remove key' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePersonalKey = async () => {
    if (!personalKeyInput.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await trpcMutate('savePersonalApiKey', { apiKey: personalKeyInput.trim() });
      setPersonalKeyExists(true);
      setPersonalKeyInput('');
      setMessage({ type: 'success', text: 'Personal API key saved' });
      onKeyConnected?.();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save key' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePersonalKey = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await trpcMutate('deletePersonalApiKey', {});
      setPersonalKeyExists(false);
      setMessage({ type: 'success', text: 'Personal API key removed' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to remove key' });
    } finally {
      setSaving(false);
    }
  };

  const [showConnectModal, setShowConnectModal] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
      {!isFirstSetup && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to chat
        </button>
      )}

      {message && (
        <div className={`rounded-lg px-3 py-2 text-xs ${
          message.type === 'success'
            ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300 border border-success-200 dark:border-success-800'
            : 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800'
        }`}>
          {message.text}
        </div>
      )}

      {/* Status + Connect / Disconnect */}
      <div className="flex flex-col items-center text-center gap-4 py-6">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${personalKeyExists ? 'bg-success-100 dark:bg-success-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
          <svg className={`w-7 h-7 ${personalKeyExists ? 'text-success-600 dark:text-success-400' : 'text-blue-600 dark:text-blue-400'}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
        </div>

        {personalKeyExists ? (
          <>
            <div>
              <p className="text-sm font-medium text-app-fg">API key connected</p>
              <p className="text-xs text-app-fg-muted mt-1">The AI assistant is ready to use.</p>
            </div>
            <button
              type="button"
              onClick={handleDeletePersonalKey}
              disabled={saving}
              className="text-xs text-danger-600 hover:text-danger-700 disabled:opacity-50"
            >
              Disconnect API key
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="text-sm font-medium text-app-fg">Connect your API key</p>
              <p className="text-xs text-app-fg-muted mt-1">Add a Claude API key to start using the AI assistant.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowConnectModal(true)}
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
            >
              Connect
            </button>
          </>
        )}
      </div>

      {/* How to get a key */}
      {!personalKeyExists && (
        <div className="rounded-lg border border-app-border bg-app-canvas px-4 py-3 space-y-2">
          <h4 className="text-xs font-semibold text-app-fg">How to get your API key</h4>
          <ol className="text-xs text-app-fg-muted space-y-1.5 list-decimal list-inside">
            <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">console.anthropic.com</a></li>
            <li>Sign in or create an account</li>
            <li>Navigate to <strong className="text-app-fg">API Keys</strong> in the sidebar</li>
            <li>Click <strong className="text-app-fg">Create Key</strong> and copy it</li>
          </ol>
          <p className="text-[10px] text-app-fg-muted pt-1">Your key is encrypted and stored securely. It is never exposed to the browser.</p>
        </div>
      )}

      {/* Connect Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowConnectModal(false)} aria-hidden />
          <div className="relative z-[1] w-full max-w-sm mx-4 bg-app-elevated rounded-xl shadow-2xl border border-app-border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-app-fg">Connect Claude API Key</h3>
              <button type="button" onClick={() => setShowConnectModal(false)} className="p-1 rounded-md hover:bg-app-hover text-app-fg-muted">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-app-fg-muted">Paste your API key from <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">console.anthropic.com</a></p>
            <input
              type="password"
              value={personalKeyInput}
              onChange={(e) => setPersonalKeyInput(e.target.value)}
              placeholder="sk-ant-..."
              autoFocus
              className="w-full rounded-lg border border-app-border bg-app-canvas px-3 py-2.5 text-sm text-app-fg placeholder:text-app-fg-muted focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {saving && (
              <div className="flex items-center gap-2 text-xs text-app-fg-muted">
                <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                Connecting...
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowConnectModal(false); setPersonalKeyInput(''); }}
                className="flex-1 px-4 py-2 rounded-lg border border-app-border text-sm text-app-fg hover:bg-app-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleSavePersonalKey();
                  setShowConnectModal(false);
                }}
                disabled={!personalKeyInput.trim() || saving}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
