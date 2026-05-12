import { useFetcher } from '@remix-run/react';
import { useState, useId, useRef, useEffect, useCallback } from 'react';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { humanizeZodIssuesString } from '~/lib/api-error';

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const TITLE_MAX = 80;
const BODY_MAX = 120;

// ─── Role helpers ─────────────────────────────────────────────────────────────

type RoleOption = { value: string; label: string };

const ALL_ROLES: RoleOption[] = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'CS_CLOSER', label: 'CS Closer' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'LOGISTICS_MANAGER', label: 'Logistics Manager' },
  { value: 'TPL_MANAGER', label: '3PL Manager' },
  { value: 'TPL_RIDER', label: '3PL Rider' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
];

const ROLE_LABELS: Record<string, string> = Object.fromEntries(ALL_ROLES.map((r) => [r.value, r.label]));

function getRolesForActor(actorRole: string): RoleOption[] {
  switch (actorRole) {
    case 'HEAD_OF_CS':
      return ALL_ROLES.filter((r) => r.value === 'CS_CLOSER');
    case 'HEAD_OF_MARKETING':
      return ALL_ROLES.filter((r) => r.value === 'MEDIA_BUYER');
    case 'HEAD_OF_LOGISTICS':
      return ALL_ROLES.filter((r) =>
        ['TPL_RIDER', 'HEAD_OF_LOGISTICS', 'LOGISTICS_MANAGER', 'TPL_MANAGER'].includes(r.value),
      );
    default:
      return ALL_ROLES;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type TargetType = 'ALL' | 'ROLE' | 'USER';

type UserResult = {
  id: string;
  name: string;
  email: string;
  role: string;
  hasPushSubscription: boolean;
};

export interface NotificationsBroadcastPanelProps {
  actorRole: string;
}

// ─── Avatar helpers ───────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => (n[0] ?? ''))
    .join('')
    .toUpperCase();
}

const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-indigo-500',
  'bg-sky-500',
  'bg-teal-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-pink-500',
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? 'bg-violet-500';
}

// ─── Push badge ───────────────────────────────────────────────────────────────

function PushBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-100 px-1.5 py-0.5 text-[10px] font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
        <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
        Push on
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-medium text-app-fg-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-app-fg-muted/40" />
      Not connected
    </span>
  );
}

// ─── User row (shared between dropdown list and selected state) ───────────────

function UserRow({ user }: { user: UserResult }) {
  return (
    <>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor(user.name)}`}
      >
        {getInitials(user.name)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-app-fg">{user.name}</span>
          <PushBadge active={user.hasPushSubscription} />
        </div>
        <p className="truncate text-xs text-app-fg-muted">
          {ROLE_LABELS[user.role] ?? user.role} · {user.email}
        </p>
      </div>
    </>
  );
}

// ─── UserPicker ───────────────────────────────────────────────────────────────

interface UserPickerProps {
  value: UserResult | null;
  onChange: (user: UserResult | null) => void;
}

function UserPicker({ value, onChange }: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const fetcher = useFetcher<{ users: UserResult[] }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track what fetch is currently in-flight so we know which state to update
  const pendingOffsetRef = useRef<number>(0);
  const pendingQueryRef = useRef<string>('');
  const isInitialFetchRef = useRef(false);

  // ── Build fetch URL ──
  const buildUrl = useCallback((q: string, off: number) => {
    const params = new URLSearchParams({
      intent: 'searchUsers',
      q,
      limit: String(PAGE_SIZE),
      offset: String(off),
    });
    return `/admin/notifications?${params.toString()}`;
  }, []);

  // ── Fetch first page (reset) ──
  const fetchFirstPage = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setLoadingInitial(true);
        setUsers([]);
        setOffset(0);
        setHasMore(true);
        setActiveIdx(-1);
        pendingOffsetRef.current = 0;
        pendingQueryRef.current = q;
        isInitialFetchRef.current = true;
        fetcher.load(buildUrl(q, 0));
      }, 220);
    },
    [fetcher, buildUrl],
  );

  // ── Fetch next page ──
  const fetchNextPage = useCallback(
    (q: string, currentOffset: number) => {
      if (loadingMore || !hasMore) return;
      setLoadingMore(true);
      pendingOffsetRef.current = currentOffset;
      pendingQueryRef.current = q;
      isInitialFetchRef.current = false;
      fetcher.load(buildUrl(q, currentOffset));
    },
    [fetcher, buildUrl, loadingMore, hasMore],
  );

  // ── Handle fetch response ──
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;

    const incoming = fetcher.data.users ?? [];
    const wasInitial = isInitialFetchRef.current;

    if (wasInitial) {
      setUsers(incoming);
      setLoadingInitial(false);
    } else {
      setUsers((prev) => {
        const existingIds = new Set(prev.map((u) => u.id));
        return [...prev, ...incoming.filter((u) => !existingIds.has(u.id))];
      });
      setLoadingMore(false);
    }

    const nextOffset = pendingOffsetRef.current + incoming.length;
    setOffset(nextOffset);
    setHasMore(incoming.length === PAGE_SIZE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  // ── Open dropdown: load first page immediately ──
  const openDropdown = useCallback(() => {
    setOpen(true);
    fetchFirstPage(query);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [fetchFirstPage, query]);

  // ── Close on outside click ──
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Infinite scroll sentinel via IntersectionObserver ──
  useEffect(() => {
    if (!open || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && hasMore && !loadingMore && !loadingInitial) {
          fetchNextPage(query, offset);
        }
      },
      { root: listRef.current, threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [open, hasMore, loadingMore, loadingInitial, fetchNextPage, query, offset]);

  // ── Keyboard navigation ──
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') openDropdown();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, users.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const picked = users[activeIdx];
      if (picked) selectUser(picked);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  // Scroll active row into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const item = listRef.current.children[activeIdx] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIdx]);

  function selectUser(u: UserResult) {
    onChange(u);
    setOpen(false);
    setQuery('');
    setUsers([]);
    setOffset(0);
    setHasMore(true);
    setActiveIdx(-1);
  }

  function clearSelection() {
    onChange(null);
  }

  function handleQueryChange(q: string) {
    setQuery(q);
    fetchFirstPage(q);
  }

  // ── If a user is already selected, show their card ──
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-app-border bg-app-elevated px-3 py-2.5">
        <UserRow user={value} />
        <button
          type="button"
          onClick={clearSelection}
          className="ml-1 shrink-0 rounded p-1 text-app-fg-muted hover:bg-app-hover hover:text-app-fg"
          aria-label="Clear selection"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button — looks like an input when closed */}
      {!open ? (
        <button
          type="button"
          onClick={openDropdown}
          className="input flex w-full items-center gap-2 text-left text-app-fg-muted"
        >
          <svg
            className="h-4 w-4 shrink-0 text-app-fg-muted/70"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
          <span className="text-sm">Select a user…</span>
          <svg
            className="ml-auto h-4 w-4 shrink-0 text-app-fg-muted/50"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      ) : (
        // Search input shown inside dropdown
        <div className="relative">
          <SearchInput
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search by name or email…"
            className="pr-9"
            clearable={false}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded
            role="combobox"
          />
          {loadingInitial && (
            <svg
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-app-fg-muted"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
      )}

      {/* Dropdown list */}
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-app-border bg-app-elevated shadow-lg"
        >
          {!loadingInitial && users.length === 0 && (
            <li className="px-4 py-3 text-sm text-app-fg-muted">
              {query.length > 0 ? 'No users found.' : 'No active users.'}
            </li>
          )}

          {users.map((u, i) => (
            <li
              key={u.id}
              role="option"
              aria-selected={i === activeIdx}
              onMouseDown={(e) => {
                e.preventDefault();
                selectUser(u);
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors ${
                i === activeIdx ? 'bg-brand-50 dark:bg-brand-900/20' : 'hover:bg-app-hover'
              }`}
            >
              <UserRow user={u} />
            </li>
          ))}

          {/* Infinite scroll sentinel */}
          {hasMore && (
            <li ref={sentinelRef} className="flex items-center justify-center py-3">
              {loadingMore ? (
                <svg
                  className="h-4 w-4 animate-spin text-app-fg-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                // Invisible spacer so the observer fires before hitting the bottom
                <span className="h-1" />
              )}
            </li>
          )}

          {!hasMore && users.length > 0 && (
            <li className="px-4 py-2 text-center text-xs text-app-fg-muted/60">
              {users.length} user{users.length !== 1 ? 's' : ''} shown
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function NotificationsBroadcastPanel({ actorRole }: NotificationsBroadcastPanelProps) {
  const fetcher = useFetcher<{
    success?: boolean;
    recipientCount?: number;
    pushDeliveryCount?: number;
    error?: string;
  }>();
  const titleId = useId();
  const bodyId = useId();

  const [targetType, setTargetType] = useState<TargetType>('ALL');
  const [targetRole, setTargetRole] = useState('');
  const [targetUser, setTargetUser] = useState<UserResult | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dismissedSuccess, setDismissedSuccess] = useState(false);

  const isSubmitting = fetcher.state !== 'idle';
  const actionData = fetcher.data;
  const availableRoles = getRolesForActor(actorRole);

  useEffect(() => {
    if (actionData?.success) setDismissedSuccess(false);
  }, [actionData?.success]);

  const canSubmit =
    title.length > 0 &&
    title.length <= TITLE_MAX &&
    body.length <= BODY_MAX &&
    (targetType !== 'ROLE' || targetRole !== '') &&
    (targetType !== 'USER' || targetUser !== null);

  const radioPillClass =
    'flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors border-app-border bg-app-elevated text-app-fg ' +
    'has-[:checked]:border-brand-500 has-[:checked]:bg-brand-500/10 has-[:checked]:text-brand-700 ' +
    'dark:has-[:checked]:border-brand-400 dark:has-[:checked]:bg-brand-900/30 dark:has-[:checked]:text-brand-300';

  const selectClass =
    'block w-full rounded-lg border border-app-border bg-app-elevated py-2 pl-3 pr-8 text-sm text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-app-fg">Broadcast push</h2>
        <p className="mt-0.5 text-sm text-app-fg-muted">
          Send a Web Push to subscribed devices. In-app notification rows are not created for broadcasts—only push
          delivery log entries.
        </p>
      </div>

      {actionData?.success && !dismissedSuccess && (
        <PageNotification
          variant="success"
          title="Broadcast sent"
          message={[
            `Queued for ${actionData.recipientCount} user${actionData.recipientCount !== 1 ? 's' : ''}.`,
            typeof actionData.pushDeliveryCount === 'number' && actionData.pushDeliveryCount > 0
              ? `Web Push reached ${actionData.pushDeliveryCount} subscribed device${actionData.pushDeliveryCount !== 1 ? 's' : ''}.`
              : actionData.pushDeliveryCount === 0 && (actionData.recipientCount ?? 0) > 0
                ? 'No Web Push deliveries — targets have no active push subscription or VAPID keys are not configured.'
                : '',
          ].filter(Boolean).join(' ')}
          durationMs={3000}
          onDismiss={() => setDismissedSuccess(true)}
        />
      )}

      {actionData?.error ? (
        <InlineNotification variant="danger" message={humanizeZodIssuesString(actionData.error)} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
        <div className="space-y-6 lg:col-span-7 min-w-0">
          <fetcher.Form method="post" className="space-y-6">
            <input type="hidden" name="intent" value="broadcast" />
            {targetType === 'USER' && targetUser && (
              <input type="hidden" name="targetUserId" value={targetUser.id} />
            )}

            {/* ── Audience card ── */}
            <div className="card overflow-visible p-0">
              <div className="flex items-center gap-3 rounded-t-xl border-b border-app-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/40">
                  <svg
                    className="h-5 w-5 text-brand-600 dark:text-brand-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                    />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-app-fg">Audience</h3>
                  <p className="text-xs text-app-fg-muted">Who receives this push (scoped by your role).</p>
                </div>
              </div>

              <div className="space-y-4 rounded-b-xl px-5 py-4">
                {/* Target type pills */}
                <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                  {(
                    [
                      { value: 'ALL', label: 'Everyone' },
                      { value: 'ROLE', label: 'By role' },
                      { value: 'USER', label: 'One user' },
                    ] as { value: TargetType; label: string }[]
                  ).map(({ value, label }) => (
                    <label key={value} className={radioPillClass}>
                      <input
                        type="radio"
                        name="targetType"
                        value={value}
                        checked={targetType === value}
                        onChange={() => {
                          setTargetType(value);
                          setTargetUser(null);
                          setTargetRole('');
                        }}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>

                {targetType === 'ROLE' && (
                  <div>
                    <FormSelect
                      id="broadcast-role"
                      name="targetRole"
                      label="Role"
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      placeholder="Select a role…"
                      options={availableRoles.map((r) => ({ value: r.value, label: r.label }))}
                      className={selectClass}
                    />
                  </div>
                )}

                {targetType === 'USER' && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="text-sm font-medium text-app-fg-muted">User</label>
                      {targetUser && !targetUser.hasPushSubscription && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          Not connected — may not receive push
                        </span>
                      )}
                    </div>
                    <UserPicker value={targetUser} onChange={setTargetUser} />
                  </div>
                )}
              </div>
            </div>

            {/* ── Message card ── */}
            <div className="card overflow-hidden p-0">
              <div className="flex items-center gap-3 border-b border-app-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-50 dark:bg-info-900/30">
                  <svg
                    className="h-5 w-5 text-info-600 dark:text-info-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.8}
                    stroke="currentColor"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
                    />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-app-fg">Message</h3>
                  <p className="text-xs text-app-fg-muted">Shown on the lock screen and notification tray.</p>
                </div>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={titleId} className="text-sm font-medium text-app-fg-muted">
                      Title
                    </label>
                    <span
                      className={`text-xs tabular-nums ${title.length > TITLE_MAX ? 'text-danger-500' : 'text-app-fg-muted'}`}
                    >
                      {title.length}/{TITLE_MAX}
                    </span>
                  </div>
                  <TextInput
                    id={titleId}
                    type="text"
                    name="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={TITLE_MAX}
                    placeholder="Short headline…"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor={bodyId} className="text-sm font-medium text-app-fg-muted">
                      Body
                    </label>
                    <span
                      className={`text-xs tabular-nums ${body.length > BODY_MAX ? 'text-danger-500' : 'text-app-fg-muted'}`}
                    >
                      {body.length}/{BODY_MAX}
                    </span>
                  </div>
                  <Textarea
                    id={bodyId}
                    name="body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    maxLength={BODY_MAX}
                    rows={4}
                    placeholder="Supporting text…"
                    showCount
                    className="min-h-[100px] resize-y"
                  />
                </div>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!canSubmit}
              loading={isSubmitting}
              loadingText="Sending…"
            >
              Send push
            </Button>
          </fetcher.Form>
        </div>

        {/* ── Preview — hidden on mobile, visible from lg ── */}
        <div className="hidden lg:block lg:col-span-5">
          <div className="card overflow-hidden p-0 lg:sticky lg:top-4">
            <div className="border-b border-app-border px-5 py-4">
              <h3 className="text-sm font-semibold text-app-fg">Preview</h3>
              <p className="mt-0.5 text-xs text-app-fg-muted">Approximate device appearance.</p>
            </div>
            <div className="px-5 py-4">
              <NotificationPreview title={title} body={body} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Notification preview widget ─────────────────────────────────────────────

function NotificationPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-app-border bg-app-hover/80 p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[10px] font-medium text-app-fg-muted">9:41</span>
        <div className="flex items-center gap-1 text-app-fg-muted">
          <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M1.5 8.353c6.075-5.804 15.426-5.804 21.5 0l-1.835 1.836a12.75 12.75 0 00-17.83 0L1.5 8.353z" />
            <path d="M5.096 12.04a9.75 9.75 0 0113.808 0l-1.835 1.835a7.25 7.25 0 00-10.138 0L5.096 12.04z" />
            <circle cx="12" cy="17.5" r="2" />
          </svg>
          <svg className="h-2.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <rect x="2" y="7" width="18" height="10" rx="2" />
            <path d="M22 11v2a1 1 0 000-2z" />
          </svg>
        </div>
      </div>
      <div className="rounded-xl border border-app-border bg-app-elevated px-3 py-2.5 shadow-card dark:shadow-none">
        <div className="mb-1.5 flex items-center gap-1.5">
          <div className="flex h-4 w-4 items-center justify-center rounded-sm bg-brand-500">
            <span className="text-[8px] font-bold text-white">Y</span>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-app-fg-muted">Yannis EOSE</span>
          <span className="ml-auto text-[10px] text-app-fg-muted">now</span>
        </div>
        <p className="text-sm font-semibold leading-snug text-app-fg">
          {title || <span className="text-app-fg-muted">Notification title</span>}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-app-fg-muted">
          {body || <span className="text-app-fg-muted/80">Body text appears here…</span>}
        </p>
      </div>
    </div>
  );
}
