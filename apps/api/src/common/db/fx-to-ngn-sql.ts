/**
 * Per-row "1 unit of this currency = N naira" rate, as a SQL expression, for
 * summing money across countries in ₦ (reporting lens only: operational money,
 * batches and payouts are never converted).
 *
 * SQL twin of `buildFxRateLookup` in `marketing/revenue-fx.ts` (the CEO /
 * marketing "Delivered revenue" tiles), so finance and marketing totals agree:
 *   - a company whose base currency is not NGN → NULL (its rates point at
 *     another base, not ₦);
 *   - the company's own row for the code: default → 1, else `fx_rate_to_base`
 *     when > 0, else NULL;
 *   - no row at all → 1 for NGN (legacy orders), NULL otherwise.
 *
 * NULL means "cannot convert": `amount * NULL` is NULL and SUM() skips it, so
 * an unrated currency is LEFT OUT, never counted 1:1 (K1,200 ≠ ₦1,200).
 * Callers report the skipped currencies separately.
 *
 * Uses the CURRENT rate (owner-approved, no rate history), same as revenue-fx.
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * @param currencyExpr  the row's currency code (NULL = NGN).
 * @param groupIdExpr   the row's company id (branch_groups.id).
 */
export function fxToNgnRateSql(currencyExpr: SQL, groupIdExpr: SQL): SQL {
  const code = sql`upper(coalesce(${currencyExpr}, 'NGN'))`;
  return sql`(CASE
    WHEN EXISTS (
      SELECT 1 FROM currencies fxb
      WHERE fxb.group_id IS NOT DISTINCT FROM ${groupIdExpr}
        AND fxb.is_default AND upper(fxb.code) <> 'NGN'
    ) THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM currencies fxr
      WHERE fxr.group_id IS NOT DISTINCT FROM ${groupIdExpr} AND upper(fxr.code) = ${code}
    ) THEN (
      SELECT CASE WHEN fxr.is_default THEN 1::numeric
                  WHEN fxr.fx_rate_to_base > 0 THEN fxr.fx_rate_to_base END
      FROM currencies fxr
      WHERE fxr.group_id IS NOT DISTINCT FROM ${groupIdExpr} AND upper(fxr.code) = ${code}
      ORDER BY fxr.is_default DESC
      LIMIT 1
    )
    WHEN ${code} = 'NGN' THEN 1::numeric
    ELSE NULL
  END)`;
}
