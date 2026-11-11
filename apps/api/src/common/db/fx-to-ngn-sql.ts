/**
 * "1 unit of this currency = N naira" as an inline SQL expression, for summing
 * money across countries in ₦ (reporting lens only: operational money,
 * batches and payouts are never converted).
 *
 * Rates come from `buildFxRateLookup` in `marketing/revenue-fx.ts` (the CEO /
 * marketing "Delivered revenue" tiles), so finance and marketing totals agree:
 *   - a company whose base currency is not NGN → NULL (its rates point at
 *     another base, not ₦);
 *   - the company's own row for the code: default → 1, else `fx_rate_to_base`
 *     when > 0, else NULL;
 *   - no row at all → 1 for NGN (legacy orders), NULL otherwise.
 *
 * NULL means "cannot convert": `amount * NULL` is NULL and SUM() skips it, so
 * an unrated currency is LEFT OUT, never counted 1:1 (K1,200 ≠ ₦1,200).
 *
 * PERFORMANCE: rates and the branch → company map are loaded ONCE per call
 * (two tiny queries) and written into a plain CASE expression. A per-row
 * subquery version took 6.6 s for 50k orders on the CEO P&L; this is a pure
 * in-row expression. Uses the CURRENT rate (owner-approved, no rate history).
 */
import { isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { buildFxRateLookup, type FxRateLookup } from '../../marketing/revenue-fx';

export type FxToNgn = {
  /** Rate for a row whose company id is known (e.g. `products.group_id`). */
  byGroup: (currencyExpr: SQL, groupIdExpr: SQL) => SQL;
  /** Rate for a row that carries a branch id (e.g. `orders.servicing_branch_id`). */
  byBranch: (currencyExpr: SQL, branchIdExpr: SQL) => SQL;
};

type CurrencyRow = { groupId: string | null; code: string; isDefault: boolean; fxRateToBase: string | number | null };

/** Pure builder (no DB): exported for tests. */
export function buildFxToNgn(
  currencies: CurrencyRow[],
  branches: Array<{ id: string; groupId: string | null }>,
): FxToNgn {
  const rateOf: FxRateLookup = buildFxRateLookup(currencies);
  const groupIds = [...new Set([...currencies.map((c) => c.groupId), ...branches.map((b) => b.groupId)])];
  const codesByGroup = new Map<string | null, Set<string>>();
  for (const g of groupIds) codesByGroup.set(g, new Set(['NGN']));
  for (const c of currencies) codesByGroup.get(c.groupId)?.add(c.code.toUpperCase());

  // `CASE upper(coalesce(code,'NGN')) WHEN 'GHS' THEN 125 … ELSE NULL END` for one company.
  const codeCase = (code: SQL, groupId: string | null): SQL => {
    const arms: SQL[] = [];
    for (const c of codesByGroup.get(groupId) ?? new Set(['NGN'])) {
      const rate = rateOf(groupId, c);
      if (rate != null) arms.push(sql`WHEN ${c} THEN ${String(rate)}::numeric`);
    }
    if (arms.length === 0) return sql`NULL::numeric`;
    return sql`(CASE ${code} ${sql.join(arms, sql` `)} ELSE NULL::numeric END)`;
  };
  const codeOf = (currencyExpr: SQL) => sql`upper(coalesce(${currencyExpr}, 'NGN'))`;

  return {
    byGroup(currencyExpr, groupIdExpr) {
      const code = codeOf(currencyExpr);
      const arms = groupIds
        .filter((g): g is string => g != null)
        .map((g) => sql`WHEN ${g}::uuid THEN ${codeCase(code, g)}`);
      if (arms.length === 0) return codeCase(code, null);
      return sql`(CASE ${groupIdExpr} ${sql.join(arms, sql` `)} ELSE ${codeCase(code, null)} END)`;
    },
    byBranch(currencyExpr, branchIdExpr) {
      const code = codeOf(currencyExpr);
      const branchesByGroup = new Map<string | null, string[]>();
      for (const b of branches) {
        const list = branchesByGroup.get(b.groupId) ?? [];
        list.push(b.id);
        branchesByGroup.set(b.groupId, list);
      }
      const arms: SQL[] = [];
      for (const [g, ids] of branchesByGroup) {
        if (g == null || ids.length === 0) continue;
        arms.push(sql`WHEN ${branchIdExpr} IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) THEN ${codeCase(code, g)}`);
      }
      if (arms.length === 0) return codeCase(code, null);
      return sql`(CASE ${sql.join(arms, sql` `)} ELSE ${codeCase(code, null)} END)`;
    },
  };
}

/** Load current rates + branch → company map and build the expressions. */
export async function loadFxToNgn(db: PostgresJsDatabase<typeof schema>): Promise<FxToNgn> {
  const [currencies, branches] = await Promise.all([
    db
      .select({
        groupId: schema.currencies.groupId,
        code: schema.currencies.code,
        isDefault: schema.currencies.isDefault,
        fxRateToBase: schema.currencies.fxRateToBase,
      })
      .from(schema.currencies)
      .where(isNull(schema.currencies.validTo)),
    db.select({ id: schema.branches.id, groupId: schema.branches.groupId }).from(schema.branches),
  ]);
  return buildFxToNgn(currencies, branches);
}
