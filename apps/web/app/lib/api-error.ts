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

export function extractApiErrorMessage(payload: unknown, fallback = 'Action failed. Please try again.'): string {
  const raw: string[] = [];
  collectStrings(payload, raw);
  const candidates = raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => !['data', 'error', 'result', 'ok', 'false', 'true'].includes(s.toLowerCase()));

  if (candidates.length === 0) return fallback;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0] ?? fallback;
}

export function isBranchContextRequiredError(payload: unknown): boolean {
  const message = extractApiErrorMessage(payload, '').toLowerCase();
  return message.includes('branch context required');
}
