import { canonicalPermissionCode } from './permission-codes';

/**
 * Merge role-template defaults with explicit UI toggles (same semantics as PermissionMatrix:
 * `effective = override ?? inherited`).
 *
 * Used at staff create/update to stamp `user_permissions` — templates are defaults only;
 * runtime access reads stamped rows.
 */
export function mergePermissionSnapshot(
  templateCodes: readonly string[],
  overrides: Record<string, boolean>,
): { granted: string[]; revoked: string[] } {
  const templateSet = new Set(templateCodes.map((c) => canonicalPermissionCode(c)));
  const canonOverrides: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(overrides)) {
    canonOverrides[canonicalPermissionCode(k)] = v;
  }
  const union = new Set<string>([...templateSet, ...Object.keys(canonOverrides)]);
  const granted: string[] = [];
  const revoked: string[] = [];
  for (const code of union) {
    const inherited = templateSet.has(code);
    const o = canonOverrides[code];
    const effective = o !== undefined ? o : inherited;
    if (effective) granted.push(code);
    else if (inherited && o === false) revoked.push(code);
  }
  return {
    granted: [...new Set(granted)].sort((a, b) => a.localeCompare(b)),
    revoked: [...new Set(revoked)].sort((a, b) => a.localeCompare(b)),
  };
}
