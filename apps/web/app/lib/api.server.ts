import { redirect } from '@remix-run/node';

/**
 * Server-side API helper for Remix loaders/actions.
 * Proxies requests to the NestJS backend with cookie forwarding.
 */

const API_URL = process.env['API_URL'] ?? 'http://localhost:4444';

interface ApiOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
}

interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
  setCookie?: string;
}

/**
 * Make an authenticated request to the NestJS API.
 * Forwards the session cookie from the browser request.
 */
export async function apiRequest<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, cookie } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (cookie) {
    headers['Cookie'] = cookie;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({})) as T;

  return {
    ok: response.ok,
    status: response.status,
    data,
    setCookie: response.headers.get('set-cookie') ?? undefined,
  };
}

/**
 * Extract the session cookie string from a Request.
 */
export function getSessionCookie(request: Request): string | undefined {
  return request.headers.get('Cookie') ?? undefined;
}

/**
 * Get the current user from the session.
 * Returns null if not authenticated.
 */
export async function getCurrentUser(request: Request) {
  const cookie = getSessionCookie(request);
  if (!cookie) return null;

  const res = await apiRequest<{
    user: { id: string; email: string; name: string; role: string; permissions?: string[] };
  }>('/auth/me', { method: 'POST', cookie });

  if (!res.ok) return null;

  return res.data.user;
}

/**
 * Require the current user to have one of the allowed roles.
 * @deprecated Use requirePermission for granular RBAC.
 */
export async function requireRole(request: Request, allowedRoles: string[]) {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (!allowedRoles.includes(user.role)) throw redirect('/admin/unauthorized');
  return user;
}

/**
 * Require the current user to have at least one of the required permissions.
 * SuperAdmin bypasses all checks.
 */
export async function requirePermission(
  request: Request,
  permissionCode: string | string[],
): Promise<{ id: string; email: string; name: string; role: string; permissions?: string[] }> {
  const user = await getCurrentUser(request);
  if (!user) throw redirect(`/auth?redirectTo=${new URL(request.url).pathname}`);
  if (user.role === 'SUPER_ADMIN') return user;
  const codes = Array.isArray(permissionCode) ? permissionCode : [permissionCode];
  const perms = user.permissions ?? [];
  const hasAny = codes.some((c) => perms.includes(c));
  if (!hasAny) throw redirect('/admin/unauthorized');
  return user;
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
