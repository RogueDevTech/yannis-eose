const NETWORK_ERROR_MARKERS = [
  'api unreachable',
  'api request timed out',
  'err_network_changed',
  'failed to fetch',
  'network error',
  'network changed',
  'fetch failed',
  'offline',
] as const;

function flattenErrorPayload(value: unknown): string {
  if (value == null) return '';
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
 * Best-effort network error classifier for route/action error payloads.
 * Uses explicit message markers first, then optional status hints (503/504).
 */
export function isNetworkErrorLike(payload: unknown, status?: number): boolean {
  const text = flattenErrorPayload(payload).toLowerCase();
  if (NETWORK_ERROR_MARKERS.some((marker) => text.includes(marker))) return true;
  if ((status === 503 || status === 504) && text.length > 0) return true;
  return false;
}

export const NETWORK_ERROR_MESSAGE = {
  title: 'Connection Issue',
  description: 'Your network changed or the API is temporarily unreachable. Check your internet/VPN and try again.',
} as const;

