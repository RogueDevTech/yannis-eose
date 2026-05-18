function unwrapTrpcProcedurePayload(data: unknown): unknown {
  if (data && typeof data === 'object' && data !== null && 'json' in data) {
    const inner = (data as { json?: unknown }).json;
    if (inner !== undefined) return inner;
  }
  return data;
}

function extractTrpcProcedureData(data: unknown): unknown | null {
  if (data === null || typeof data !== 'object') return null;

  let root: Record<string, unknown>;
  if (Array.isArray(data)) {
    const first = data[0];
    if (!first || typeof first !== 'object') return null;
    root = first as Record<string, unknown>;
  } else {
    root = data as Record<string, unknown>;
  }

  if ('error' in root && root.error != null) return null;

  const result = root.result as Record<string, unknown> | undefined;
  if (!result || typeof result !== 'object') return null;
  if ('error' in result && result.error != null) return null;
  if (!('data' in result)) return null;

  let payload: unknown = result.data;
  payload = unwrapTrpcProcedurePayload(payload);
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
  }
  return payload;
}

/**
 * Extract the data from a tRPC-style API response.
 * Handles `{ result: { data: T } }`, optional `{ json }` inside `result.data`, and single-item batch arrays.
 *
 * @param res - The API response { ok, data }
 * @param fallback - Value returned when the response is not ok or data is missing
 */
export function extractTrpc<T>(res: { ok: boolean; data: unknown }, fallback: T): T {
  if (!res.ok) return fallback;
  const unwrapped = extractTrpcProcedureData(res.data);
  if (unwrapped === null || unwrapped === undefined) return fallback;
  return (unwrapped as T) ?? fallback;
}
