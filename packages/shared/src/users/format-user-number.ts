/**
 * Format sequential user_number into a human-friendly reference.
 *
 * Examples:
 *   1  -> "USR-1"
 *   42 -> "USR-42"
 *
 * The prefix is cosmetic -- only user_number is stored in the DB.
 */
export function formatUserNumber(n: number | null | undefined): string {
  if (n == null) return '';
  return `USR-${n}`;
}

/**
 * Parse a formatted user number string back into its numeric value.
 *
 * Examples:
 *   "USR-42" -> 42
 *   "USR-1"  -> 1
 *   "bad"    -> null
 */
export function parseUserNumber(s: string): number | null {
  const match = s.match(/^USR-(\d+)$/);
  if (!match?.[1]) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
