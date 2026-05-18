/**
 * Shared helpers for simulation scripts.
 * No config — each script defines its own at the top.
 */

import { createHash } from 'crypto';

// ── Types ────────────────────────────────────────────────

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ── Sleep ────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Phone hash ───────────────────────────────────────────

export function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

// ── Login ────────────────────────────────────────────────

/**
 * POST /auth/login → extracts `yannis_session` cookie.
 * Returns the full cookie string to send in subsequent requests.
 */
export async function login(
  apiUrl: string,
  email: string,
  password: string,
): Promise<ApiResult<string>> {
  try {
    const res = await fetch(`${apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Login failed (${res.status}): ${body}` };
    }

    // Extract yannis_session from Set-Cookie header
    const setCookies = res.headers.getSetCookie?.() ?? [];
    let sessionCookie = '';
    for (const sc of setCookies) {
      const match = sc.match(/yannis_session=([^;]+)/);
      if (match) {
        sessionCookie = `yannis_session=${match[1]}`;
        break;
      }
    }

    // Fallback: raw header
    if (!sessionCookie) {
      const raw = res.headers.get('set-cookie') ?? '';
      const match = raw.match(/yannis_session=([^;]+)/);
      if (match) {
        sessionCookie = `yannis_session=${match[1]}`;
      }
    }

    if (!sessionCookie) {
      return { ok: false, error: 'Login succeeded but no yannis_session cookie returned' };
    }

    return { ok: true, data: sessionCookie };
  } catch (err: unknown) {
    return { ok: false, error: `Login network error: ${(err as Error).message}` };
  }
}

// ── Error extraction ─────────────────────────────────────

function extractErrorMessage(json: unknown, status: number): string {
  if (!json) return `HTTP ${status}`;
  const j = json as Record<string, unknown>;
  // tRPC error shapes: { error: { message } } or { error: { json: { message } } }
  const err = j?.['error'] as Record<string, unknown> | undefined;
  if (err) {
    if (typeof err['message'] === 'string') return err['message'];
    const inner = err['json'] as Record<string, unknown> | undefined;
    if (inner && typeof inner['message'] === 'string') return inner['message'];
  }
  // Fallback: try top-level message
  if (typeof j['message'] === 'string') return j['message'];
  return `HTTP ${status}: ${JSON.stringify(json).slice(0, 200)}`;
}

// ── tRPC helpers ─────────────────────────────────────────

/**
 * tRPC mutation (POST).
 * Path format: "orders.create", "orders.transition", etc.
 */
export async function trpcPost<T = unknown>(
  apiUrl: string,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;

    const res = await fetch(`${apiUrl}/trpc/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = extractErrorMessage(json, res.status);
      return { ok: false, error: msg };
    }

    // tRPC wraps result in { result: { data } }
    const data = (json as any)?.result?.data ?? json;
    return { ok: true, data: data as T };
  } catch (err: unknown) {
    return { ok: false, error: `Network error: ${(err as Error).message}` };
  }
}

/**
 * tRPC query (GET).
 * Input is serialized as JSON in the `input` query param.
 */
export async function trpcGet<T = unknown>(
  apiUrl: string,
  path: string,
  input?: unknown,
  cookie?: string,
): Promise<ApiResult<T>> {
  try {
    const headers: Record<string, string> = {};
    if (cookie) headers['Cookie'] = cookie;

    let url = `${apiUrl}/trpc/${path}`;
    if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
    }

    const res = await fetch(url, { method: 'GET', headers });
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = extractErrorMessage(json, res.status);
      return { ok: false, error: msg };
    }

    const data = (json as any)?.result?.data ?? json;
    return { ok: true, data: data as T };
  } catch (err: unknown) {
    return { ok: false, error: `Network error: ${(err as Error).message}` };
  }
}

// ── Logging helpers ──────────────────────────────────────

export function logStep(prefix: string, i: number, total: number, msg: string) {
  console.log(`  [${i}/${total}] ${prefix}: ${msg}`);
}

export function logSummary(label: string, success: number, failed: number) {
  console.log(`\n${label} complete. Success: ${success}, Failed: ${failed}, Total: ${success + failed}\n`);
}
