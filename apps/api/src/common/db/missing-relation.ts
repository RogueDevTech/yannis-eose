/**
 * Detects undefined_table / missing relation errors for a specific table.
 * Useful for defensive read-path fallbacks when a non-critical table is absent.
 */
export function isMissingRelationError(err: unknown, relationName: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    err !== null && typeof err === 'object' && 'code' in err
      ? (err as { code?: string }).code
      : undefined;

  if (code === '42P01' && new RegExp(relationName, 'i').test(msg)) return true;
  if (!new RegExp(relationName, 'i').test(msg)) return false;
  return /does not exist/i.test(msg);
}
