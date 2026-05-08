const NETWORK_ERROR_MARKERS = [
  'api unreachable',
  'api request timed out',
  'err_network_changed',
  'failed to fetch',
  'network error',
  'network changed',
  'fetch failed',
  'offline',
  /** From `throwSessionCheckUnavailable` in `api.server.ts` */
  'could not reach the server',
  'could not reach',
  'verify your session',
  'econnrefused',
  'connection refused',
  'connect econnrefused',
  'socket hang up',
  'und_err_connect',
  'enotfound',
  'enetunreach',
  'eai_again',
] as const;

function flattenErrorPayload(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => flattenErrorPayload(v)).join(' ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.values(obj)
      .map((v) => flattenErrorPayload(v))
      .join(' ');
  }
  return '';
}

/**
 * Remix sometimes surfaces `throw new Response(JSON.stringify(...))` with `data` as a
 * string; other times as a parsed object. Normalize so classifiers see stable shapes.
 */
export function normalizeRouteErrorData(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  const t = data.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      return data;
    }
  }
  return data;
}

/**
 * Best-effort network error classifier for route/action error payloads.
 * Uses explicit message markers first, then optional status hints (503/504).
 */
export function isNetworkErrorLike(payload: unknown, status?: number): boolean {
  const normalized = normalizeRouteErrorData(payload);
  if (
    typeof normalized === 'object' &&
    normalized !== null &&
    'code' in normalized &&
    (normalized as { code?: string }).code === 'API_UNAVAILABLE'
  ) {
    return true;
  }
  const text = flattenErrorPayload(normalized).toLowerCase();
  if (NETWORK_ERROR_MARKERS.some((marker) => text.includes(marker))) return true;
  if ((status === 503 || status === 504) && text.length > 0) return true;
  return false;
}

export const NETWORK_ERROR_MESSAGE = {
  title: 'Connection Issue',
  description:
    'The app could not reach the API (slow network, VPN, or the server restarted). Wait a few seconds and refresh — your session is usually still valid.',
} as const;

