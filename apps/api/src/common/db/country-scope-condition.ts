/**
 * Shared SQL condition builder for country-scoped queries (multi-country).
 *
 * The country analogue of `branchScopeCondition`. Country is a HARD data-scope:
 * a user only sees rows whose `currency_code` is in their effective set. This
 * STACKS with branch scope — a query pushes BOTH conditions, so a user is
 * limited by their branches AND their countries.
 *
 * The NGN-fallback and view_all semantics live in `trpc/context.ts`, which
 * resolves `effectiveCurrencyCodes`:
 *   - null       → view_all / MEDIA_BUYER → no country filter (see all)
 *   - ['NGN']    → unassigned non-view_all → base country only (rollout-safe)
 *   - [codes...] → assigned user → exactly those currencies
 * This helper just turns that set into a WHERE condition.
 *
 * Usage:
 * ```ts
 * const cond = countryScopeCondition(schema.orders.currencyCode, ctx.effectiveCurrencyCodes);
 * if (cond) conditions.push(cond);
 * ```
 */
import { eq, inArray, isNull, or, type SQL, type Column } from 'drizzle-orm';

/**
 * Build a country-scope SQL condition from a resolved currency-code set.
 *
 * @param column               the currency_code column to filter (orders,
 *                             shipments, stock_batches, logistics_providers…).
 * @param effectiveCurrencyCodes  null = no filter (global / view_all); a
 *                             non-empty array = restrict to those codes.
 * @returns SQL condition to push into WHERE, or `null` when no filter applies.
 */
export function countryScopeCondition(
  column: Column,
  effectiveCurrencyCodes: string[] | null | undefined,
): SQL | null {
  // Global / view_all / MEDIA_BUYER → no country filter.
  if (effectiveCurrencyCodes == null) return null;

  // Empty array should never reach here (context resolves unassigned → ['NGN']),
  // but guard defensively: treat as "no country filter" rather than match-nothing,
  // because country is a fallback-safe scope, not a hard company boundary.
  if (effectiveCurrencyCodes.length === 0) return null;

  // Include rows with NULL currency_code so any legacy/unstamped row (should not
  // exist post-backfill, but defensive) does not silently vanish from a scoped
  // user's view.
  const inCurrency =
    effectiveCurrencyCodes.length === 1
      ? eq(column, effectiveCurrencyCodes[0]!)
      : inArray(column, effectiveCurrencyCodes);

  return or(inCurrency, isNull(column))!;
}
