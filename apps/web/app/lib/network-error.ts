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

/** Specific codes thrown by `throwSessionCheckUnavailable` (api.server.ts). */
export type ApiUnavailableCode =
  | 'API_TIMEOUT'
  | 'API_UNREACHABLE'
  | 'API_RATE_LIMITED'
  | 'API_UPSTREAM_ERROR'
  // Legacy generic code — older payloads or callers not yet migrated.
  | 'API_UNAVAILABLE';

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

const KNOWN_API_CODES: ReadonlySet<ApiUnavailableCode> = new Set<ApiUnavailableCode>([
  'API_TIMEOUT',
  'API_UNREACHABLE',
  'API_RATE_LIMITED',
  'API_UPSTREAM_ERROR',
  'API_UNAVAILABLE',
]);

function readPayloadCode(payload: unknown): ApiUnavailableCode | null {
  if (typeof payload === 'object' && payload !== null && 'code' in payload) {
    const raw = (payload as { code?: unknown }).code;
    if (typeof raw === 'string' && KNOWN_API_CODES.has(raw as ApiUnavailableCode)) {
      return raw as ApiUnavailableCode;
    }
  }
  return null;
}

/**
 * Best-effort network error classifier for route/action error payloads.
 * Uses explicit message markers first, then optional status hints (503/504).
 */
export function isNetworkErrorLike(payload: unknown, status?: number): boolean {
  const normalized = normalizeRouteErrorData(payload);
  if (readPayloadCode(normalized) !== null) return true;
  const text = flattenErrorPayload(normalized).toLowerCase();
  if (NETWORK_ERROR_MARKERS.some((marker) => text.includes(marker))) return true;
  if ((status === 503 || status === 504) && text.length > 0) return true;
  return false;
}

/** Generic copy when we can't classify the error any further. */
export const NETWORK_ERROR_MESSAGE = {
  title: 'Connection issue',
  description: 'Couldn’t reach the server. We’ll retry shortly.',
} as const;

export interface NetworkErrorCopy {
  /** Specific code the API server attached (or null when only legacy markers matched). */
  code: ApiUnavailableCode | null;
  title: string;
  /** Multi-sentence body — already includes the "what to try next" guidance. */
  description: string;
  /** Status the API/server reported, when present. Useful for the small "details" pill. */
  upstreamStatus?: number;
}

const COPY_BY_CODE: Record<ApiUnavailableCode, { title: string; description: string }> = {
  API_TIMEOUT: {
    title: 'Server is slow',
    description: 'The server took too long. Try again in a moment.',
  },
  API_UNREACHABLE: {
    title: 'Can’t reach the server',
    description: 'Check your connection — we’ll retry automatically.',
  },
  API_RATE_LIMITED: {
    title: 'Too many requests',
    description: 'Slow down a little, then try again.',
  },
  API_UPSTREAM_ERROR: {
    title: 'Server error',
    description: 'Something went wrong on the server. Try again shortly.',
  },
  // Legacy generic code from older payloads.
  API_UNAVAILABLE: {
    title: NETWORK_ERROR_MESSAGE.title,
    description: NETWORK_ERROR_MESSAGE.description,
  },
};

/**
 * Resolve the best title + description for a route error payload.
 * Prefers the specific `code` field if the API attached one (`API_TIMEOUT`, etc.),
 * falls back to the generic "Connection Issue" copy when only marker-text matched.
 */
export function getNetworkErrorCopy(payload: unknown, status?: number): NetworkErrorCopy {
  const normalized = normalizeRouteErrorData(payload);
  const code = readPayloadCode(normalized);

  // Pull payload-supplied title/description if the API attached them — service may
  // have richer copy than the static map (e.g. when behaviour differs by endpoint).
  let payloadTitle: string | undefined;
  let payloadDescription: string | undefined;
  let upstreamStatus: number | undefined;
  if (typeof normalized === 'object' && normalized !== null) {
    const obj = normalized as { title?: unknown; message?: unknown; upstreamStatus?: unknown };
    if (typeof obj.title === 'string') payloadTitle = obj.title;
    if (typeof obj.message === 'string') payloadDescription = obj.message;
    if (typeof obj.upstreamStatus === 'number') upstreamStatus = obj.upstreamStatus;
  }

  if (code) {
    const baseline = COPY_BY_CODE[code];
    return {
      code,
      title: payloadTitle ?? baseline.title,
      description: payloadDescription ?? baseline.description,
      ...(upstreamStatus != null ? { upstreamStatus } : {}),
    };
  }

  return {
    code: null,
    title: payloadTitle ?? NETWORK_ERROR_MESSAGE.title,
    description: payloadDescription ?? NETWORK_ERROR_MESSAGE.description,
    ...(status != null ? { upstreamStatus: status } : {}),
  };
}

