/**
 * Detects Postgres errors when `branch_teams` / `branch_team_members` are missing
 * (migration 0076 not applied). Prefer matching `branch_team` in the message so we
 * do not treat unrelated undefined_table (42P01) errors as branch-team gaps.
 */
export function isBranchTeamsSchemaMissingError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/branch_team/i.test(msg)) return false;
  const code =
    err !== null && typeof err === 'object' && 'code' in err
      ? (err as { code?: string }).code
      : undefined;
  if (code === '42P01') return true;
  return /does not exist/i.test(msg);
}
