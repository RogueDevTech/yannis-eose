/**
 * Extract the data from a tRPC-style API response.
 * Handles the nested `{ result: { data: T } }` wrapper that tRPC produces.
 *
 * @param res - The API response { ok, data }
 * @param fallback - Value returned when the response is not ok or data is missing
 */
export function extractTrpc<T>(res: { ok: boolean; data: unknown }, fallback: T): T {
  if (!res.ok) return fallback;
  const trpc = res.data as { result?: { data?: T } } | undefined;
  return trpc?.result?.data ?? fallback;
}
