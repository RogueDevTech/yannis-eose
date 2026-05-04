/** Version bump if stored JSON shape changes. */
export const LIST_FILTER_STORAGE_VERSION = 'v1';

export function listFilterStorageKey(userId: string, scope: string): string {
  return `yannis:listFilters:${LIST_FILTER_STORAGE_VERSION}:${userId}:${scope}`;
}

/** Snapshot allowlisted keys from a URLSearchParams (non-empty values only). */
export function pickAllowlisted(
  searchParams: URLSearchParams,
  allowlist: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of allowlist) {
    if (key === 'page') continue;
    const v = searchParams.get(key);
    if (v !== null && v !== '') {
      out[key] = v;
    }
  }
  return out;
}

export function parseStoredFilters(raw: string | null): Record<string, string> | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v !== '') out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export type MergeSearchParamsResult = {
  next: URLSearchParams;
  addedKeys: string[];
};

/**
 * For each allowlisted key missing from the current URL, fill from `stored`.
 * URL always wins for keys already present (including empty string — has() is true).
 */
export function mergeSearchParamsFromStorage(
  currentSearch: string,
  stored: Record<string, string> | null,
  allowlist: readonly string[],
): MergeSearchParamsResult {
  const next = new URLSearchParams(currentSearch);
  const addedKeys: string[] = [];
  if (!stored) return { next, addedKeys };

  for (const key of allowlist) {
    if (key === 'page') continue;
    if (next.has(key)) continue;
    const v = stored[key];
    if (v !== undefined && v !== '') {
      next.set(key, v);
      addedKeys.push(key);
    }
  }
  return { next, addedKeys };
}
