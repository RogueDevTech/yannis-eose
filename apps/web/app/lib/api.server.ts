import { redirect } from '@remix-run/node';
import { isNetworkErrorLike } from './network-error';
import { canAccessGlobalAuditLog, isAdminLevel, isOrgWideDepartmentHead } from './rbac';
import { canonicalPermissionCode } from './permission-codes';
import { decodeSessionBundleCookie } from './session-bundle-cookie.server';

/**
 * Server-side API helper for Remix loaders/actions.
 * Proxies requests to the NestJS backend with cookie forwarding.
 */

/** Legacy + granular staff-directory capability codes (see seed — `users.read` aliases `users.staff.view`). */
/**
 * Permission codes that grant access to `/admin/finance/staff-accounts`
 * (the finance-side staff list — surfaces payout bank fields, finance-hat
 * assignment, etc).
 *
 * Intentionally restricted to the `users.staff.*` codes — the broader
 * `users.read` / `users.create` / etc legacy aliases are NOT included here
 * because they're held by Heads of Marketing / CS / Logistics for their
 * own team management UIs. Conflating them lets HoM/HoCS browse the
 * finance-side staff page just by typing the URL — flagged by CEO 2026-05.
 *
 * If you need to grant a non-finance role access to this page, do it via
 * an explicit per-user override of `users.staff.view` rather than adding
 * a legacy alias here.
 */
const STAFF_ACCOUNTS_PERMISSION_CODES = [
  'users.staff.view',
  'users.staff.create',
  'users.staff.update',
  'users.staff.deactivate',
] as const;

/** Roles that always have access to the finance staff-accounts page,
 *  regardless of what permission codes their template carries. */
const STAFF_ACCOUNTS_ROLES = ['FINANCE_OFFICER', 'HR_MANAGER'] as const;

/** Vite dev server (must match `vite.config` server.port — used only for `/trpc` SSR in dev). */
const DEV_VITE_ORIGIN = 'http://127.0.0.1:4003';
/** NestJS default listen port in local dev for non-proxied paths (`/auth/*`, etc.). */
const DEV_NEST_ORIGIN = 'http://127.0.0.1:4444';

/**
 * Where Node-side `fetch` should send a path.
 * - Explicit `API_URL` / `PUBLIC_API_URL` wins (production + custom dev).
 * - Otherwise in dev: go direct to Nest for everything.
 *
 * We intentionally do NOT route server-side `/trpc/*` through the Vite dev proxy:
 * when Vite is busy (HMR, SSR errors in unrelated routes, websocket proxy resets),
 * the proxy hop can stall long enough to trip Remix single-fetch stream timeouts,
 * which surfaces as "Server Timeout" for deferred loader data.
 */
/**
 * Logged once per process when production resolves to localhost — without this guard the
 * symptom is "every login returns Invalid credentials" because the fetch fails silently and
 * the auth route falls back to the hard-coded message. The warning makes the misconfig
 * obvious in deploy logs.
 */
let warnedProductionFallback = false;

function resolveServerApiBase(_resolvedPath: string): string {
  const explicit = process.env['API_URL']?.trim() || process.env['PUBLIC_API_URL']?.trim();
  if (explicit) return explicit;
  if (process.env['NODE_ENV'] === 'production') {
    if (!warnedProductionFallback) {
      warnedProductionFallback = true;
      // eslint-disable-next-line no-console
      console.error(
        '[api.server] FATAL CONFIG: NODE_ENV=production but API_URL / PUBLIC_API_URL is unset. ' +
          'All API calls will fall back to ' +
          DEV_NEST_ORIGIN +
          ' which is not reachable from a deployed host — every login will appear as "Invalid credentials". ' +
          'Set API_URL (or PUBLIC_API_URL) to the deployed API origin (e.g. https://api.your-domain.com).',
      );
    }
    return DEV_NEST_ORIGIN;
  }
  return DEV_NEST_ORIGIN;
}

/**
 * YYYY-MM-DD formatter pinned to the company's operational TZ (Africa/Lagos).
 * The server runs in UTC, so server-local `getFullYear/getMonth/getDate` gives
 * the wrong calendar date for 00:00–01:00 WAT (= 23:00–00:00 UTC the previous
 * day) — the "Today" filter resolved to yesterday in Nigeria right after
 * midnight. Africa/Lagos pins the date to business hours regardless of where
 * the server is deployed.
 */
const NIGERIA_TZ = 'Africa/Lagos';
const NIGERIA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: NIGERIA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Format a Date as YYYY-MM-DD in Africa/Lagos (see formatter doc above). */
export function toLocalDateString(d: Date): string {
  return NIGERIA_DATE_FORMATTER.format(d);
}

/** Returns { startDate, endDate } for the current month in Africa/Lagos. */
export function defaultThisMonthRange(): { startDate: string; endDate: string } {
  // Resolve "now" to a Nigeria calendar date, then build the month bounds
  // straight from that — no Date constructor in server-local TZ to drift.
  const [yStr, mStr] = toLocalDateString(new Date()).split('-');
  const year = parseInt(yStr!, 10);
  const month = parseInt(mStr!, 10);
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // Day-count per month is pure calendar arithmetic — same in every TZ.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { startDate, endDate };
}

/**
 * Resolve `?perPage=` from a request's URL search params, clamped to a safe set.
 *
 * Every paginated route should call this so the `<Pagination>` per-page picker maps to
 * an actual API limit. The default options are `[20, 50, 100]`; anything outside the set
 * (or missing) falls back to `defaultPerPage` (20). Returns the resolved size + the
 * options array so the loader can pass both straight into the page component.
 *
 * Usage in a Remix loader:
 *   const url = new URL(request.url);
 *   const { perPage, pageSizeOptions } = parsePerPage(url.searchParams);
 *   const inputForApi = { page, limit: perPage, ... };
 *
 * Pages with more than one paginated table pass a distinct `param` per table so each
 * picker writes its own search param (the matching `<Pagination pageSizeParam>` must agree):
 *   const { perPage: requestsPerPage } = parsePerPage(url.searchParams, { param: 'requestsPerPage' });
 */
const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [20, 50, 100, 200, 400, 500, 600, 800, 1000];

export function parsePerPage(
  searchParams: URLSearchParams,
  options?: { defaultPerPage?: number; allowed?: readonly number[]; param?: string },
): { perPage: number; pageSizeOptions: number[] } {
  const allowed = options?.allowed ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const fallback = options?.defaultPerPage ?? allowed[0] ?? 20;
  const raw = Number(searchParams.get(options?.param ?? 'perPage') ?? '');
  const perPage = allowed.includes(raw) ? raw : fallback;
  return { perPage, pageSizeOptions: [...allowed] };
}

/** Returns { startDate, endDate } both set to today in local time. */
export function defaultTodayRange(): { startDate: string; endDate: string } {
  const today = toLocalDateString(new Date());
  return { startDate: today, endDate: today };
}

/**
 * Default request timeout for **reads** (GET/HEAD and any non-mutating method) in ms.
 *
 * Parallel GETs each use this budget independently (wall time ≈ slowest call, not the sum).
 * Raised from ~4.7s so cold Nest / DB work is less likely to abort before the API responds.
 *
 * **Framework note:** Some Remix / React Router single-fetch deployments cap total loader
 * stream time (~5s in older docs). If heavy loaders still fail with a generic server timeout,
 * parallelize critical GETs or adjust your deploy’s stream/SSR timeout — this value only
 * controls `AbortController` inside {@link apiRequest}.
 *
 * **Mutations** (POST/PUT/PATCH/DELETE) default to {@link DEFAULT_MUTATION_API_TIMEOUT_MS}.
 * Override `timeoutMs` for auth flows, CSV exports, MV refresh, etc.; the login action uses 20_000ms.
 */
export const DEFAULT_READ_API_TIMEOUT_MS = 10_000;

/**
 * `/auth/me` runs on every protected route loader. The bound is generous because:
 * - Slow networks (3G / patchy Wi-Fi / VPN) need 10–20s for a single request to clear.
 * - First request after `UserBundleCacheService` cache miss does extra DB work.
 * - One quiet retry on fetch failure (see `apiRequest`) needs headroom too.
 * Set higher than read defaults so a slow auth check doesn't tip the user into the
 * "Connection Issue" modal for what was just a slow network.
 */
const AUTH_ME_TIMEOUT_MS = 30_000;

/**
 * Default `apiRequest` budget for POST/PUT/PATCH/DELETE when `timeoutMs` is omitted.
 * Aligns with typical Nest mutation work (DB, audit, notifications).
 */
export const DEFAULT_MUTATION_API_TIMEOUT_MS = 30_000;

/**
 * Order detail actions that hit VOIP providers or audited phone reveal (DB + optional state
 * transition). Alias of {@link DEFAULT_MUTATION_API_TIMEOUT_MS} for call-site clarity.
 */
export const ORDER_VOIP_ACTION_TIMEOUT_MS = DEFAULT_MUTATION_API_TIMEOUT_MS;

/**
 * `orders.bulkAssignToCS` / `orders.bulkTransition` run sequential per-order work server-side.
 */
export const BULK_ORDER_MUTATION_TIMEOUT_MS = DEFAULT_MUTATION_API_TIMEOUT_MS;

/**
 * `users.create` / `users.update` — permission snapshot, templates, notifications, finance-hat swap.
 */
export const USER_WRITE_ACTION_TIMEOUT_MS = DEFAULT_MUTATION_API_TIMEOUT_MS;

/** Alias of {@link DEFAULT_READ_API_TIMEOUT_MS} — use in loaders that spread shared read options. */
export const DEFERRED_LOADER_TIMEOUT_MS = DEFAULT_READ_API_TIMEOUT_MS;

interface ApiOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  /** Override timeout in ms when default {@link DEFAULT_READ_API_TIMEOUT_MS} / mutation budgets are too tight. */
  timeoutMs?: number;
  /**
   * When `false`, a single GET that fails at the TCP layer (ECONNREFUSED during API restart, etc.)
   * will not be retried. Defaults to allowing one retry for GET only.
   */
  disableNetworkRetry?: boolean;
  /**
   * Force one retry on fetch error (TCP / DNS / network) even for non-GET methods.
   * Use ONLY for idempotent POSTs like `/auth/me` (session lookup). Most POSTs are
   * mutations and must NOT retry — they could double-submit (e.g. payment, order
   * creation, fund disbursement).
   */
  forceFetchRetry?: boolean;
}

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
  /** `Set-Cookie` header(s) from the API — use `getSetCookie()` because `headers.get('set-cookie')` is often null in Node fetch. */
  setCookies: string[];
}

/** Convenience guard for apiRequest fallbacks (503/504) and network-like payload text. */
export function isApiNetworkFailure(res: { status: number; data?: unknown }): boolean {
  return isNetworkErrorLike(res.data, res.status);
}

/** Collect Set-Cookie lines from a fetch Response (Node undici). */
function getSetCookieValues(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === 'function') {
    return extended.getSetCookie();
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

/**
 * Make an authenticated request to the NestJS API.
 * Forwards the session cookie from the browser request.
 */
function defaultTimeoutForMethod(method: string | undefined): number {
  const m = (method ?? 'GET').toUpperCase();
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    return DEFAULT_MUTATION_API_TIMEOUT_MS;
  }
  return DEFAULT_READ_API_TIMEOUT_MS;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, cookie } = options;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutForMethod(method);
  const mUpper = (method ?? 'GET').toUpperCase();
  const allowFetchRetry =
    options.forceFetchRetry === true ||
    (mUpper === 'GET' && !options.disableNetworkRetry);

  // tRPC GET queries need ?input={} even when all fields are optional,
  // otherwise Zod receives undefined instead of an object and fails.
  let resolvedPath = path;
  if (method === 'GET' && path.includes('/trpc/') && !path.includes('?input=')) {
    const sep = path.includes('?') ? '&' : '?';
    resolvedPath = `${path}${sep}input=${encodeURIComponent(JSON.stringify({}))}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (cookie) {
    headers['Cookie'] = cookie;
  }

  const url = `${resolveServerApiBase(resolvedPath)}${resolvedPath}`;

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let response: Response;
  try {
    response = await doFetch();
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    if (allowFetchRetry && !isTimeout) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        response = await doFetch();
      } catch {
        return {
          ok: false,
          status: 503,
          data: { error: 'API unreachable' } as T,
          setCookies: [],
        };
      }
    } else {
      return {
        ok: false,
        status: isTimeout ? 504 : 503,
        data: { error: isTimeout ? 'API request timed out' : 'API unreachable' } as T,
        setCookies: [],
      };
    }
  }

  const data = (await response.json().catch(() => ({}))) as T;

  return {
    ok: response.ok,
    status: response.status,
    data,
    setCookies: getSetCookieValues(response.headers),
  };
}

/**
 * Extract the session cookie string from a Request.
 */
export function getSessionCookie(request: Request): string | undefined {
  return request.headers.get('Cookie') ?? undefined;
}

export interface GetCurrentUserOptions {
  /**
   * When the session cookie is present but `/auth/me` fails with a transient error (5xx, timeout,
   * network), return null instead of throwing. Use only on public auth routes so a cold API or
   * brief outage does not replace the login form with a global 503.
   */
  softNetwork?: boolean;
}

function isTransientAuthMeFailure(status: number): boolean {
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 408 ||
    status === 429 ||
    (status >= 500 && status < 600)
  );
}

/**
 * Classify the upstream failure into a specific code so the UI can show a
 * targeted message (timeout vs unreachable vs server error vs rate-limited)
 * instead of a generic "API unavailable".
 *
 * Reads:
 * - `upstreamStatus` — what `/auth/me` (or whichever endpoint) returned
 * - `upstreamReason` — the synthetic message `apiRequest` set on fetch failures
 *   ("API request timed out" | "API unreachable") OR any error string from the API
 */
type ApiUnavailableCode =
  | 'API_TIMEOUT'
  | 'API_UNREACHABLE'
  | 'API_RATE_LIMITED'
  | 'API_UPSTREAM_ERROR';

function classifyTransientFailure(
  upstreamStatus: number,
  upstreamReason: string | undefined,
): ApiUnavailableCode {
  const reason = (upstreamReason ?? '').toLowerCase();
  if (upstreamStatus === 504 || upstreamStatus === 408 || reason.includes('timed out')) {
    return 'API_TIMEOUT';
  }
  if (upstreamStatus === 429) return 'API_RATE_LIMITED';
  if (upstreamStatus === 503 || reason.includes('unreachable') || reason.includes('econnrefused')) {
    return 'API_UNREACHABLE';
  }
  return 'API_UPSTREAM_ERROR';
}

function describeCode(code: ApiUnavailableCode): { title: string; message: string } {
  switch (code) {
    case 'API_TIMEOUT':
      return {
        title: 'Server is taking too long',
        message:
          'The server didn’t respond in time. This is usually a slow network or a hiccup on our end — try again in a moment.',
      };
    case 'API_RATE_LIMITED':
      return {
        title: 'Too many requests',
        message:
          'You’re sending requests faster than the server allows. Wait a few seconds and try again.',
      };
    case 'API_UNREACHABLE':
      return {
        title: 'Can’t reach the server',
        message:
          'We couldn’t connect to the server. Check your internet connection — your session is usually still valid once you’re back online.',
      };
    case 'API_UPSTREAM_ERROR':
    default:
      return {
        title: 'Server error',
        message:
          'The server returned an error verifying your session. This is usually transient — try again in a few seconds.',
      };
  }
}

function throwSessionCheckUnavailable(detail: {
  upstreamStatus: number;
  upstreamReason?: string;
}): never {
  const code = classifyTransientFailure(detail.upstreamStatus, detail.upstreamReason);
  const { title, message } = describeCode(code);
  throw new Response(
    JSON.stringify({
      title,
      message,
      code,
      upstreamStatus: detail.upstreamStatus,
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Synchronous "must be signed in" gate for loaders that want to defer their
 * permission check inside a deferred promise.
 *
 * Pattern:
 *
 *   export async function loader({ request }) {
 *     // Sync — redirects immediately if no session cookie. Zero network calls.
 *     requireSessionOrRedirect(request);
 *
 *     // ... URL-only sync work (filters, page, etc.)
 *
 *     const pageData = (async () => {
 *       const user = await requirePermission(request, 'X');  // network here, not before defer()
 *       // ... user-dependent work + API calls
 *     })();
 *
 *     return defer({ pageData });
 *   }
 *
 * The skeleton paints in <16ms because `defer()` returns sync. The full
 * permission validation runs inside the deferred promise; an unauthorized
 * user is still caught — `requirePermission` throws a redirect Response,
 * Remix's `<Await>` handles thrown Responses as redirects (not errors).
 *
 * Use this ONLY on page loaders that have a `<Suspense fallback>`. Action /
 * resource routes still want the synchronous `await requirePermission(...)`.
 */
export function requireSessionOrRedirect(request: Request): void {
  const cookie = getSessionCookie(request);
  if (!cookie) {
    const url = new URL(request.url);
    const destination = url.pathname + (url.search || '');
    const redirectTo = destination ? `?redirectTo=${encodeURIComponent(destination)}` : '';
    throw redirect(`/auth${redirectTo}`);
  }
}

/**
 * Per-request memo for `/auth/me` so the parent layout loader + every child
 * route loader on the same navigation share ONE round-trip instead of N.
 *
 * Keyed by `Request` (a unique object per Remix request). The WeakMap entry
 * is GC'd as soon as the request is finished. No cross-request leakage; no
 * staleness concerns within a single navigation since the session cookie is
 * fixed for the duration of the request.
 *
 * Stores the in-flight Promise (not just the resolved value) so concurrent
 * loader calls (Remix runs them in parallel) all await the same fetch.
 */
const currentUserCache = new WeakMap<
  Request,
  Promise<Awaited<ReturnType<typeof getCurrentUserUncached>>>
>();

/**
 * Get the current user from the session.
 * Returns null when there is no cookie or the API returns 401 (invalid/expired session).
 * On transient API failures (503/504/5xx from network or server), throws Response(503) so layout
 * loaders do not mis-treat a blip as logout — unless `softNetwork: true`.
 *
 * Per-request memoized: repeated calls with the same `Request` reuse the
 * single in-flight `/auth/me` promise. `softNetwork: true` bypasses the cache
 * (it changes the contract — caller wants a null on transient failure rather
 * than a 503 throw).
 */
export async function getCurrentUser(request: Request, options?: GetCurrentUserOptions) {
  if (options?.softNetwork) {
    return getCurrentUserUncached(request, options);
  }
  const cached = currentUserCache.get(request);
  if (cached) return cached;
  const promise = getCurrentUserUncached(request, options);
  currentUserCache.set(request, promise);
  return promise;
}

async function getCurrentUserUncached(request: Request, options?: GetCurrentUserOptions) {
  const cookie = getSessionCookie(request);
  if (!cookie) return null;

  // FAST PATH — verify the API-signed bundle cookie locally instead of
  // calling `/auth/me`. Saves a round-trip on every loader as long as the
  // bundle is fresh (≤ BUNDLE_TTL_SECONDS, currently 60s). The bundle is
  // re-issued by the API on every successful `/auth/me` so this self-refreshes.
  // softNetwork callers (e.g. /auth route) skip this — they want a real network
  // probe to surface API-down state, not a cached optimistic answer.
  if (!options?.softNetwork) {
    const bundle = decodeSessionBundleCookie(request);
    if (bundle) {
      return {
        id: bundle.id,
        email: bundle.email,
        name: bundle.name,
        role: bundle.role,
        roleTemplateId: bundle.roleTemplateId,
        scopeGlobal: bundle.scopeGlobal,
        scopeOrgWideHead: bundle.scopeOrgWideHead,
        scopeTeamSupervisor: bundle.scopeTeamSupervisor,
        permissions: bundle.permissions,
        logisticsLocationId: bundle.logisticsLocationId,
        currentBranchId: bundle.currentBranchId,
        branchIds: bundle.branchIds,
        appTheme: bundle.appTheme,
        fontScale: bundle.fontScale,
        mirroredBy: bundle.mirroredBy,
        ...(bundle.staffOnboardingStatus !== undefined
          ? { staffOnboardingStatus: bundle.staffOnboardingStatus }
          : {}),
        ...(bundle.isMarketingTeamSupervisorOnActiveBranch === true
          ? { isMarketingTeamSupervisorOnActiveBranch: true as const }
          : {}),
        ...(bundle.isCsTeamSupervisorOnActiveBranch === true
          ? { isCsTeamSupervisorOnActiveBranch: true as const }
          : {}),
        ...(bundle.isTeamSupervisor === true ? { isTeamSupervisor: true as const } : {}),
      };
    }
  }

  const res = await apiRequest<{
    user?: {
      id: string;
      email: string;
      name: string;
      role: string;
      roleTemplateId?: string | null;
      scopeGlobal?: boolean;
      scopeOrgWideHead?: boolean;
      scopeTeamSupervisor?: boolean;
      permissions?: string[];
      logisticsLocationId?: string | null;
      currentBranchId?: string | null;
      /** All branches this user has membership in — used by `ensureBranchScopeOrRedirect` to skip the modal for single-branch heads. */
      branchIds?: string[];
      appTheme?: string | null;
      /** Set when this session is in Mirror Mode — see CLAUDE.md "Mirror Mode". */
      mirroredBy?: { id: string; name: string; role: string } | null;
      /** Staff onboarding packet — `/auth/me` omits for admin-class roles. */
      staffOnboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
      /** Branch marketing team supervisor — scoped surfaces; see BranchTeamsService. */
      isMarketingTeamSupervisorOnActiveBranch?: boolean;
      /** "Is supervisor anywhere" — for UI badging. Mirrors users.is_team_supervisor. */
      isTeamSupervisor?: boolean;
    };
  }>('/auth/me', {
    method: 'POST',
    cookie,
    timeoutMs: AUTH_ME_TIMEOUT_MS,
    // `/auth/me` is idempotent (read-only session lookup). Allow one quiet retry
    // on TCP-level fetch failures so a single dropped packet on slow networks
    // doesn't surface the "Connection Issue" modal. Mutations stay non-retried.
    forceFetchRetry: true,
  });

  if (res.ok) {
    const u = res.data.user;
    return u ?? null;
  }

  if (res.status === 401) return null;

  if (isTransientAuthMeFailure(res.status)) {
    if (options?.softNetwork) return null;
    const upstreamReason =
      typeof res.data === 'object' && res.data && 'error' in res.data
        ? String((res.data as { error?: unknown }).error ?? '')
        : undefined;
    throwSessionCheckUnavailable({
      upstreamStatus: res.status,
      upstreamReason,
    });
  }

  return null;
}

/**
 * Build the `/admin/unauthorized` redirect target with the canonical permission
 * codes the actor would need encoded in the query string. The unauthorized page
 * renders the `<PermissionRequiredModal>` and surfaces these codes so admins
 * can map the message back to the role-template matrix without guessing.
 */
function buildUnauthorizedRedirect(
  request: Request,
  required: string[],
  options?: { roles?: string[]; action?: string },
): string {
  const params = new URLSearchParams();
  const canonical = Array.from(new Set(required.map((c) => canonicalPermissionCode(c))));
  if (canonical.length > 0) params.set('required', canonical.join(','));
  if (options?.roles && options.roles.length > 0) params.set('roles', options.roles.join(','));
  if (options?.action) params.set('action', options.action);
  try {
    const from = new URL(request.url).pathname;
    if (from && from !== '/admin/unauthorized') params.set('from', from);
  } catch {
    // Non-standard URL — skip the from param.
  }
  const qs = params.toString();
  return qs ? `/admin/unauthorized?${qs}` : '/admin/unauthorized';
}

/**
 * Require the current user to have one of the allowed roles.
 * @deprecated Use requirePermission for granular RBAC.
 */
export async function requireRole(request: Request, allowedRoles: string[]) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (!allowedRoles.includes(user.role)) {
    throw redirect(buildUnauthorizedRedirect(request, [], { roles: allowedRoles }));
  }
  return user;
}

/**
 * Require the current user to have at least one of the required permissions.
 * SuperAdmin bypasses all checks.
 */
export async function requirePermission(
  request: Request,
  permissionCode: string | string[],
): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  roleTemplateId?: string | null;
  scopeGlobal?: boolean;
  scopeOrgWideHead?: boolean;
  scopeTeamSupervisor?: boolean;
  permissions?: string[];
  logisticsLocationId?: string | null;
  currentBranchId?: string | null;
  branchIds?: string[];
  /** Surfaces the marketing-supervisor session flag so loaders can treat them HoM-like. */
  isMarketingTeamSupervisorOnActiveBranch?: boolean;
  /** "Is supervisor anywhere" — for UI badging on user lists / detail pages. */
  isTeamSupervisor?: boolean;
}> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (user.role === 'SUPER_ADMIN') return user;
  const codes = (Array.isArray(permissionCode) ? permissionCode : [permissionCode]).map((c) =>
    canonicalPermissionCode(c),
  );
  const perms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const hasAny = codes.some((c) => perms.includes(c));
  if (!hasAny) throw redirect(buildUnauthorizedRedirect(request, codes));
  return user;
}

/** Permissions for HR-facing onboarding pages (list + per-user HR view). Catalog: `seed-permissions.ts`. */
export const HR_ONBOARDING_PAGE_PERMISSIONS = [
  'hr.onboarding.read',
  'hr.onboarding.write',
  'hr.onboarding.approve',
] as const;

/**
 * Staff onboarding pages that read/edit another user's record (`/hr/staff-onboarding-documents`,
 * `/hr/users/:id/onboarding`). Matches API `OnboardingService.canManageAnyOnboarding`:
 * admin-class bypass; everyone else needs at least one of `hr.onboarding.{read,write,approve}` —
 * holding `HR_MANAGER` alone is not enough unless those grants are on the session/template.
 */
export async function requireOnboardingHrPagesAccess(request: Request): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
  roleTemplateId?: string | null;
  currentBranchId?: string | null;
}> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (isAdminLevel(user)) return user;
  const codes = HR_ONBOARDING_PAGE_PERMISSIONS.map((c) => canonicalPermissionCode(c));
  const perms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  if (codes.some((c) => perms.includes(c))) return user;
  throw redirect(buildUnauthorizedRedirect(request, [...codes]));
}

/**
 * Require auth; allow specific roles without permission, others need one of the permissions.
 * Use for routes where Super Admin and Head of Marketing should always have access.
 */
export async function requirePermissionOrRoles(
  request: Request,
  options: {
    roles: string[];
    permission: string | string[];
    /** Allows branch marketing team supervisors (session flag + active branch). */
    orMarketingTeamSupervisorOnBranch?: boolean;
  },
): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
  logisticsLocationId?: string | null;
  currentBranchId?: string | null;
  isMarketingTeamSupervisorOnActiveBranch?: boolean;
}> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (user.role === 'SUPER_ADMIN') return user;
  if (options.roles.includes(user.role)) return user;
  const codes = (Array.isArray(options.permission) ? options.permission : [options.permission]).map((c) =>
    canonicalPermissionCode(c),
  );
  const perms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const hasAny = codes.some((c) => perms.includes(c));
  if (!hasAny) {
    if (
      options.orMarketingTeamSupervisorOnBranch === true &&
      user.isMarketingTeamSupervisorOnActiveBranch === true &&
      user.currentBranchId
    ) {
      return user;
    }
    throw redirect(buildUnauthorizedRedirect(request, codes, { roles: options.roles }));
  }
  return user;
}

/**
 * Guard for staff-account management pages.
 * Allowed:
 * - Admin-level users (SUPER_ADMIN / ADMIN)
 * - HR manager
 * - Finance officer primary role
 * - Anyone with the matching `users.staff.*` permission grant
 */
export async function requireStaffAccountsAccess(
  request: Request,
): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  scopeOrgWideHead?: boolean;
  permissions?: string[];
  logisticsLocationId?: string | null;
  currentBranchId?: string | null;
  branchIds?: string[];
}> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (user.role === 'SUPER_ADMIN') return user;
  if (isAdminLevel(user)) return user;
  if ((STAFF_ACCOUNTS_ROLES as readonly string[]).includes(user.role)) {
    return user;
  }
  const perms = new Set((user.permissions ?? []).map((p) => canonicalPermissionCode(p)));
  const allowed = STAFF_ACCOUNTS_PERMISSION_CODES.some((c) => perms.has(canonicalPermissionCode(c)));
  if (allowed) {
    return user;
  }
  throw redirect(
    buildUnauthorizedRedirect(
      request,
      [...STAFF_ACCOUNTS_PERMISSION_CODES],
      {
        roles: ['SUPER_ADMIN', 'ADMIN', ...STAFF_ACCOUNTS_ROLES],
        action: 'manage staff accounts',
      },
    ),
  );
}

/**
 * Global audit trail (`/admin/analytics/audit`) — aligned with `canAccessGlobalAuditLog` on the API.
 */
export async function requireGlobalAuditAccess(
  request: Request,
): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
  currentBranchId?: string | null;
}> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (canAccessGlobalAuditLog(user)) return user;
  throw redirect(
    buildUnauthorizedRedirect(request, ['audit.read', 'finance.costs.view'], {
      action: 'view the global audit log',
    }),
  );
}

/**
 * Map an API status code to a safe Remix action status.
 *
 * Preserves 4xx as-is (UI surfaces field-level errors).
 * Preserves 503/504 — these are the synthesized statuses `apiRequest`
 * returns on TCP failure / timeout; if we mask them as 422 the browser
 * console shows "Unprocessable Entity" and developers chase a phantom
 * validation bug while the real cause is "API server down".
 * Other 5xx (500/502/etc.) still collapse to 422 because Remix v2 treats a
 * thrown 5xx as an unhandled error — and some callers `throw` the result.
 */
export function safeStatus(apiStatus: number): number {
  if (apiStatus === 401) return 401;
  if (apiStatus === 403) return 403;
  if (apiStatus >= 400 && apiStatus < 500) return apiStatus;
  if (apiStatus === 503 || apiStatus === 504) return apiStatus;
  return 422;
}

/**
 * Loader-side safety net for the pre-flight branch picker.
 *
 * Returns a `redirect(...)` Response when the active user is an org-wide
 * department head (HEAD_OF_CS / HEAD_OF_MARKETING / HEAD_OF_LOGISTICS) viewing
 * "All Branches" (currentBranchId == null) AND belongs to multiple branches.
 * Returns `null` otherwise so the loader can proceed normally.
 *
 * The redirect lands on `fallbackPath` with `?branchPickerNext=<original URL>`.
 * The shared `BranchScopeGuardProvider` watches that param on mount and
 * auto-opens the picker modal — selecting a branch then submits to
 * `/admin/branches/switch` with `next=<original URL>`, which redirects there.
 *
 * Usage in a loader:
 * ```ts
 * const user = await requirePermission(request, 'marketing.campaigns');
 * const guard = ensureBranchScopeOrRedirect(request, user, '/admin/marketing/forms');
 * if (guard) return guard;
 * // ...rest of loader
 * ```
 *
 * Pairs with the `BranchScopedLink` click handler — the link is the fast
 * path (no flash of the doomed page); the loader guard is the safety net
 * for deep links, bookmarks, and search-modal jumps.
 */
export function ensureBranchScopeOrRedirect(
  request: Request,
  user: {
    role: string;
    scopeOrgWideHead?: boolean;
    currentBranchId?: string | null;
    branchIds?: string[];
  },
  fallbackPath: string,
): Response | null {
  if (!isOrgWideDepartmentHead({ role: user.role, scopeOrgWideHead: user.scopeOrgWideHead })) {
    return null;
  }
  if (user.currentBranchId != null) return null;
  const branchCount = (user.branchIds ?? []).length;
  if (branchCount <= 1) return null;
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  // Don't redirect-loop: if we're already AT the fallback path with the
  // param set, just proceed (the provider will surface the modal).
  if (url.pathname === fallbackPath && url.searchParams.get('branchPickerNext')) {
    return null;
  }
  const dest = new URL(fallbackPath, url.origin);
  dest.searchParams.set('branchPickerNext', next);
  return redirect(dest.pathname + (dest.search ? dest.search : ''));
}

function hasNotAuthenticatedError(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'object') {
    const msg = (obj.error as { message?: string }).message;
    if (msg === 'Not authenticated') return true;
  }
  if (Array.isArray(data) && data.some((item) => item === 'Not authenticated')) return true;
  return false;
}

/**
 * If the API response indicates "Not authenticated" (401 or tRPC UNAUTHORIZED),
 * redirect to login with redirectTo so the user can return after re-auth.
 * Call this before handling other errors in actions that require auth.
 */
export function redirectIfUnauthorized(
  res: { status: number; data?: unknown },
  currentPath: string,
): void {
  if (res.status === 401 || hasNotAuthenticatedError(res.data)) {
    throw redirect(`/auth?redirectTo=${encodeURIComponent(currentPath)}`);
  }
}
