import { redirect } from '@remix-run/node';
import { isNetworkErrorLike } from './network-error';
import { canAccessGlobalAuditLog } from './rbac';
import { canonicalPermissionCode } from './permission-codes';

/**
 * Server-side API helper for Remix loaders/actions.
 * Proxies requests to the NestJS backend with cookie forwarding.
 */

const API_URL = process.env['API_URL'] ?? 'http://localhost:4444';

/** Format a Date as YYYY-MM-DD in local time (avoids UTC offset bugs from toISOString). */
export function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns { startDate, endDate } for the current month in local time. */
export function defaultThisMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  return {
    startDate: toLocalDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: toLocalDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

/** Returns { startDate, endDate } both set to today in local time. */
export function defaultTodayRange(): { startDate: string; endDate: string } {
  const today = toLocalDateString(new Date());
  return { startDate: today, endDate: today };
}

/** Default request timeout in ms. Deferred promises must resolve before Remix single-fetch timeout (~5s). */
const DEFAULT_API_TIMEOUT_MS = 8_000;

/** `/auth/me` can run on layout revalidation after tab resume — slightly longer than default to reduce false timeouts. */
const AUTH_ME_TIMEOUT_MS = 15_000;

/** Timeout used for deferred loader requests so they resolve before server timeout. */
export const DEFERRED_LOADER_TIMEOUT_MS = 4_000;

interface ApiOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  /** Override timeout in ms (used by deferred loaders to stay under Remix server timeout). */
  timeoutMs?: number;
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
export async function apiRequest<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, cookie, timeoutMs = DEFAULT_API_TIMEOUT_MS } = options;

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${resolvedPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: isTimeout ? 504 : 503,
      data: { error: isTimeout ? 'API request timed out' : 'API unreachable' } as T,
      setCookies: [],
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({})) as T;

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

function throwSessionCheckUnavailable(): never {
  throw new Response(
    JSON.stringify({
      message:
        'We could not reach the server to verify your session. If you were signed in, try refreshing once your connection is stable.',
      code: 'API_UNAVAILABLE',
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * Get the current user from the session.
 * Returns null when there is no cookie or the API returns 401 (invalid/expired session).
 * On transient API failures (503/504/5xx from network or server), throws Response(503) so layout
 * loaders do not mis-treat a blip as logout — unless `softNetwork: true`.
 */
export async function getCurrentUser(request: Request, options?: GetCurrentUserOptions) {
  const cookie = getSessionCookie(request);
  if (!cookie) return null;

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
      appTheme?: string | null;
      isFinanceOfficer?: boolean;
      /** Set when this session is in Mirror Mode — see CLAUDE.md "Mirror Mode". */
      mirroredBy?: { id: string; name: string; role: string } | null;
    };
  }>('/auth/me', { method: 'POST', cookie, timeoutMs: AUTH_ME_TIMEOUT_MS });

  if (res.ok) {
    const u = res.data.user;
    return u ?? null;
  }

  if (res.status === 401) return null;

  if (isTransientAuthMeFailure(res.status)) {
    if (options?.softNetwork) return null;
    throwSessionCheckUnavailable();
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

/**
 * Require auth; allow specific roles without permission, others need one of the permissions.
 * Use for routes where Super Admin and Head of Marketing should always have access.
 */
export async function requirePermissionOrRoles(
  request: Request,
  options: { roles: string[]; permission: string | string[] },
): Promise<{ id: string; email: string; name: string; role: string; permissions?: string[] }> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (user.role === 'SUPER_ADMIN') return user;
  if (options.roles.includes(user.role)) return user;
  const codes = (Array.isArray(options.permission) ? options.permission : [options.permission]).map((c) =>
    canonicalPermissionCode(c),
  );
  const perms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const hasAny = codes.some((c) => perms.includes(c));
  if (!hasAny) throw redirect(buildUnauthorizedRedirect(request, codes, { roles: options.roles }));
  return user;
}

/**
 * Guard for staff-account management pages.
 * Allowed:
 * - Admin-level users (SUPER_ADMIN / ADMIN)
 * - HR manager
 * - Finance officer primary role
 * - Finance hat holders (isFinanceOfficer = true)
 */
export async function requireStaffAccountsAccess(
  request: Request,
): Promise<{
  id: string;
  email: string;
  name: string;
  role: string;
  permissions?: string[];
  logisticsLocationId?: string | null;
  isFinanceOfficer?: boolean;
}> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (user.role === 'SUPER_ADMIN') return user;
  const perms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  if (
    perms.includes('users.staff.view') ||
    perms.includes('users.staff.create') ||
    perms.includes('users.staff.update') ||
    perms.includes('users.staff.deactivate')
  ) {
    return user;
  }
  if (user.role === 'FINANCE_OFFICER' || user.isFinanceOfficer === true) {
    return user;
  }
  throw redirect(
    buildUnauthorizedRedirect(
      request,
      ['users.staff.view', 'users.staff.create', 'users.staff.update', 'users.staff.deactivate'],
      { roles: ['SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'FINANCE_OFFICER'], action: 'manage staff accounts' },
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
  isFinanceOfficer?: boolean;
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
 * Never forward 5xx to the client — Remix treats action 5xx as unhandled errors.
 */
export function safeStatus(apiStatus: number): number {
  if (apiStatus === 401) return 401;
  if (apiStatus === 403) return 403;
  if (apiStatus >= 400 && apiStatus < 500) return apiStatus;
  return 422;
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
