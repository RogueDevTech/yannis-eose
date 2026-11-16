/**
 * "Which CS branch does an order move to when it is assigned to this closer?"
 *
 * Assigning a cart or follow-up order moves its servicing branch to the
 * closer's branch. It used to take the closer's FIRST `user_branches` row,
 * whatever company that branch was in. Closers who sit in both Yannis and 2B21
 * (e.g. a Kenya closer in Yannis Remote and 2B21 Kenya Zarvon) then pulled
 * Yannis cart orders into 2B21 (Nov 2026 ticket: 74 Yannis East Africa cart
 * orders shown under 2B21 Cart Orders, numbered 2B21-).
 *
 * Rule, one definition for every assign path:
 *   1. The order's company = its marketing branch's company (servicing branch
 *      as fallback). An assign never moves an order out of that company.
 *   2. The closer already works the order's current servicing branch: keep it.
 *   3. Otherwise the closer's primary branch, if it is in the order's company.
 *   4. Otherwise the closer's first branch (by name) in the order's company.
 *   5. The closer has no branch in that company: the order stays where it is.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export interface CloserBranch {
  branchId: string;
  groupId: string | null;
  isPrimary: boolean;
  branchName: string;
}

export interface OrderBranches {
  branchId: string | null;
  servicingBranchId: string | null;
}

/** Pure rule (unit-tested). Returns the branch to set, or null = leave unchanged. */
export function pickCloserServicingBranch(
  order: OrderBranches,
  closerBranches: CloserBranch[],
  groupOfBranch: (branchId: string) => string | null,
): string | null {
  const orderGroup =
    (order.branchId ? groupOfBranch(order.branchId) : null) ??
    (order.servicingBranchId ? groupOfBranch(order.servicingBranchId) : null);
  if (!orderGroup) return null;

  const inCompany = closerBranches.filter((b) => b.groupId === orderGroup);
  if (inCompany.length === 0) return null;

  if (order.servicingBranchId && inCompany.some((b) => b.branchId === order.servicingBranchId)) {
    return order.servicingBranchId;
  }
  const primary = inCompany.find((b) => b.isPrimary);
  if (primary) return primary.branchId;
  return [...inCompany].sort((a, b) => a.branchName.localeCompare(b.branchName))[0]!.branchId;
}

/**
 * Loads what `pickCloserServicingBranch` needs for a batch of closers and
 * orders, in two queries. Returns a resolver to call per (order, closer).
 */
export async function loadCloserServicingBranchResolver(
  db: PostgresJsDatabase<any>,
  closerIds: string[],
  orders: OrderBranches[],
): Promise<(order: OrderBranches, closerId: string) => string | null> {
  const ids = [...new Set(closerIds)];
  const orderBranchIds = [
    ...new Set(orders.flatMap((o) => [o.branchId, o.servicingBranchId]).filter((b): b is string => !!b)),
  ];

  const [closerRows, orderBranchRows] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([] as Array<{ user_id: string; branch_id: string; group_id: string | null; is_primary: boolean; branch_name: string }>)
      : db.execute<{ user_id: string; branch_id: string; group_id: string | null; is_primary: boolean; branch_name: string }>(sql`
          SELECT ub.user_id, b.id AS branch_id, b.group_id, (u.primary_branch_id = b.id) AS is_primary, b.name AS branch_name
          FROM user_branches ub
          JOIN branches b ON b.id = ub.branch_id
          JOIN users u ON u.id = ub.user_id
          WHERE ub.user_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
            AND b.status = 'ACTIVE'
        `),
    orderBranchIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; group_id: string | null }>)
      : db.execute<{ id: string; group_id: string | null }>(sql`
          SELECT id, group_id FROM branches
          WHERE id IN (${sql.join(orderBranchIds.map((id) => sql`${id}::uuid`), sql`, `)})
        `),
  ]);

  const groupByBranch = new Map<string, string | null>();
  for (const r of orderBranchRows as unknown as Array<{ id: string; group_id: string | null }>) {
    groupByBranch.set(r.id, r.group_id);
  }
  const branchesByCloser = new Map<string, CloserBranch[]>();
  for (const r of closerRows as unknown as Array<{ user_id: string; branch_id: string; group_id: string | null; is_primary: boolean; branch_name: string }>) {
    const list = branchesByCloser.get(r.user_id) ?? [];
    list.push({ branchId: r.branch_id, groupId: r.group_id, isPrimary: !!r.is_primary, branchName: r.branch_name });
    branchesByCloser.set(r.user_id, list);
    groupByBranch.set(r.branch_id, r.group_id);
  }

  return (order, closerId) =>
    pickCloserServicingBranch(order, branchesByCloser.get(closerId) ?? [], (b) => groupByBranch.get(b) ?? null);
}
