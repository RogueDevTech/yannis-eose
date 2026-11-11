/**
 * "Does this CS closer work in one of these countries?" as a SQL condition.
 *
 * Used to narrow closer pickers (Assign / Reassign / filters) to the country
 * picked in the top-bar switcher (`ctx.effectiveCurrencyCodes`), so a Ghana
 * cart order is never offered to a Kenyan closer.
 *
 * Same rule as the session (trpc/context) and `closerCountryAccessWarning`:
 *   - `countries.view_all` grant → works every country;
 *   - a `user_countries` row for the code in one of the closer's companies;
 *   - NO grant at all in that company → base country (NGN) only.
 *
 * The company is the closer's own branch membership (`user_branches` →
 * `branches.group_id`), narrowed to `effectiveBranchIds` when given, because
 * country grants are per company.
 */
import { sql, type SQL, type Column } from 'drizzle-orm';

const BASE_CURRENCY_CODE = 'NGN';

/**
 * @param userIdColumn            the users.id column of the closer row.
 * @param effectiveCurrencyCodes  null/empty = no country filter (returns null).
 * @param effectiveBranchIds      company branch scope; null = any company.
 */
export function closerInCountriesCondition(
  userIdColumn: Column,
  effectiveCurrencyCodes: string[] | null | undefined,
  effectiveBranchIds?: string[] | null,
): SQL | null {
  if (effectiveCurrencyCodes == null || effectiveCurrencyCodes.length === 0) return null;

  const codes = [...new Set(effectiveCurrencyCodes.map((c) => c.toUpperCase()))];
  const codeList = sql.join(codes.map((c) => sql`${c}`), sql`, `);
  const branchFilter =
    effectiveBranchIds && effectiveBranchIds.length > 0
      ? sql`AND ub.branch_id IN (${sql.join(effectiveBranchIds.map((id) => sql`${id}::uuid`), sql`, `)})`
      : sql``;
  const closerGroups = sql`(
    SELECT b.group_id FROM user_branches ub
    JOIN branches b ON b.id = ub.branch_id
    WHERE ub.user_id = ${userIdColumn} ${branchFilter}
  )`;

  const baseFallback = codes.includes(BASE_CURRENCY_CODE)
    ? sql`OR NOT EXISTS (
        SELECT 1 FROM user_countries uc2
        WHERE uc2.user_id = ${userIdColumn} AND uc2.group_id IN ${closerGroups}
      )`
    : sql``;

  return sql`(
    EXISTS (
      SELECT 1 FROM user_permissions up
      JOIN permissions p ON p.id = up.permission_id
      WHERE up.user_id = ${userIdColumn} AND up.granted AND p.code = 'countries.view_all'
    )
    OR EXISTS (
      SELECT 1 FROM user_countries uc
      WHERE uc.user_id = ${userIdColumn}
        AND uc.group_id IN ${closerGroups}
        AND upper(uc.currency_code) IN (${codeList})
    )
    ${baseFallback}
  )`;
}
