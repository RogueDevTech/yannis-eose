/** Strings that look like a stack trace, not a user-facing message. */
function looksLikeStackTrace(s: string): boolean {
  return /\n\s*at\s+/.test(s) || s.startsWith('TRPCError:') || s.startsWith('Error:');
}

/** Drill into the well-known places a tRPC / NestJS error payload puts the user-facing message. */
function readKnownMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;

  // Plain `{ error: 'string' }` shape from action helpers
  if (typeof root.error === 'string' && root.error.trim()) return root.error.trim();
  // Plain `{ message: 'string' }` shape from REST controllers
  if (typeof root.message === 'string' && root.message.trim() && !looksLikeStackTrace(root.message)) {
    return root.message.trim();
  }

  const error = root.error;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    // tRPC v11 wraps the error in `{ json: { message, ... } }`
    const json = e.json;
    if (json && typeof json === 'object') {
      const jm = (json as Record<string, unknown>).message;
      if (typeof jm === 'string' && jm.trim()) return jm.trim();
    }
    // Plain `{ error: { message: 'string' } }`
    if (typeof e.message === 'string' && e.message.trim() && !looksLikeStackTrace(e.message)) {
      return e.message.trim();
    }
  }

  // tRPC payloads sometimes surface `result.error.message` on partial responses
  const result = root.result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const rerr = r.error;
    if (rerr && typeof rerr === 'object') {
      const rm = (rerr as Record<string, unknown>).message;
      if (typeof rm === 'string' && rm.trim() && !looksLikeStackTrace(rm)) return rm.trim();
    }
  }

  return null;
}

function collectStrings(value: unknown, out: string[]): void {
  if (value == null) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.error === 'object' && obj.error != null) {
      collectStrings((obj.error as Record<string, unknown>).message, out);
    }
    collectStrings(obj.message, out);
    if (typeof obj.cause === 'object' && obj.cause != null) {
      collectStrings((obj.cause as Record<string, unknown>).message, out);
    }
    for (const val of Object.values(obj)) collectStrings(val, out);
  }
}

/**
 * Extract a user-facing error message from an API response payload.
 *
 * Order of preference:
 *   1. Known structured paths — `error` (string), `error.json.message` (tRPC v11),
 *      `error.message`, `message`, `result.error.message`. These are what the
 *      service layer actually authored as the user-facing copy.
 *   2. Fallback recursive scan, with stack traces filtered out and the
 *      *shortest* sensible candidate preferred (long strings are usually
 *      stack dumps, not messages).
 *
 * Previously this function picked the LONGEST string in the payload, which
 * caused tRPC stack traces to leak into UI toasts. The new fallback
 * deliberately filters traces and prefers concise text.
 */
export function extractApiErrorMessage(payload: unknown, fallback = 'Action failed. Please try again.'): string {
  const known = readKnownMessage(payload);
  if (known) return known;

  const raw: string[] = [];
  collectStrings(payload, raw);
  const candidates = raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !['data', 'error', 'result', 'ok', 'false', 'true'].includes(s.toLowerCase()))
    .filter((s) => !looksLikeStackTrace(s))
    // Reject very long blobs (stringified payloads) and obvious code/path noise.
    .filter((s) => s.length < 500);

  if (candidates.length === 0) return fallback;
  // Prefer concise messages over verbose ones.
  candidates.sort((a, b) => a.length - b.length);
  // Skip 1-character noise (boolean-ish) if anything longer is available.
  for (const c of candidates) {
    if (c.length >= 4) return c;
  }
  return candidates[0] ?? fallback;
}

export function isBranchContextRequiredError(payload: unknown): boolean {
  const message = extractApiErrorMessage(payload, '').toLowerCase();
  return message.includes('branch context required');
}
