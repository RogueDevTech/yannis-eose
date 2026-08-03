import { Injectable, Inject } from '@nestjs/common';
import { and, count, eq, gte, inArray, lt, lte, or, sql, sum } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { PayrollMetrics } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';

type TxLike = PostgresJsDatabase<typeof schema>;

/**
 * Which order pipelines feed the delivered-order metrics for a staff member.
 *   FUNNEL            — orders-table funnel (default; original behaviour).
 *   RECOVERY_COMBINED — recovery pipelines: orders WHERE is_delivered_follow_up
 *                       = true (graduated follow-ups + CS-created delivered
 *                       follow-up) PLUS cart_orders. Deliberately excludes the
 *                       follow_up_orders table — its delivered rows graduate into
 *                       orders as is_delivered_follow_up = true, so summing both
 *                       would double-count (and double-pay). Cart deliveries
 *                       graduate as order_source='online' (NOT flagged), so there
 *                       is no overlap with the orders slice.
 */
export type DeliveredMetricSource = 'FUNNEL' | 'RECOVERY_COMBINED';

export interface StaffMetricsInput {
  staffId: string;
  staffRole: string;
  periodStart: Date;
  periodEnd: Date;
  crmLinked?: boolean;
  reporteeIds?: string[];
  /** Pipeline source for delivered-order metrics. Defaults to FUNNEL. */
  deliveredMetricSource?: DeliveredMetricSource;
}

/**
 * The pay-relevant subset of order-count metrics. These four are the ONLY
 * order-derived inputs `computePayrollFormula` reads (deliveredCount,
 * returnedCount, and individualDr = deliveredCohortCount / totalOrders).
 * The batched preview computes only these; display-only fields are omitted.
 */
export interface PayBatchedMetric {
  deliveredCount: number;
  totalOrders: number;
  deliveredCohortCount: number;
  returnedCount: number;
}

/** Minimal order shape for the pure OR-attribution aggregation reference. */
export interface OrderMetricRow {
  id: string;
  status: string;
  assignedCsId: string | null;
  mediaBuyerId: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

/**
 * PURE reference for what `getStaffMetricsBatched`'s SQL computes — the exact
 * OR-attribution semantics: an order is credited to a staff when
 * `assignedCsId = staff OR mediaBuyerId = staff`, and an order where BOTH
 * columns name the SAME staff is credited ONCE (dedup by order id). Used by the
 * batched preview's correctness unit test; the production path runs the same
 * logic as one grouped SQL query (`COUNT(DISTINCT o.id)` over unnested columns).
 */
export function aggregatePayMetrics(
  orders: OrderMetricRow[],
  staffIds: string[],
  periodStart: Date,
  periodEnd: Date,
): Map<string, PayBatchedMetric> {
  const ids = new Set(staffIds.filter(Boolean));
  const out = new Map<string, PayBatchedMetric>();
  for (const id of ids) out.set(id, { deliveredCount: 0, totalOrders: 0, deliveredCohortCount: 0, returnedCount: 0 });

  const inWindow = (d: Date | null) => d != null && d >= periodStart && d <= periodEnd;
  const isDelivered = (s: string) => s === 'DELIVERED' || s === 'REMITTED';

  for (const o of orders) {
    // Dedup by order id: the set of staff this order is attributed to (OR of the
    // two columns) — a staff appearing in both columns is present once.
    const attributed = new Set<string>();
    if (o.assignedCsId && ids.has(o.assignedCsId)) attributed.add(o.assignedCsId);
    if (o.mediaBuyerId && ids.has(o.mediaBuyerId)) attributed.add(o.mediaBuyerId);
    if (attributed.size === 0) continue;

    for (const staffId of attributed) {
      const m = out.get(staffId)!;
      if (isDelivered(o.status) && inWindow(o.deliveredAt)) m.deliveredCount += 1;
      if (o.status !== 'DELETED' && inWindow(o.createdAt)) m.totalOrders += 1;
      if (isDelivered(o.status) && inWindow(o.createdAt)) m.deliveredCohortCount += 1;
      if (o.status === 'RETURNED' && inWindow(o.deliveredAt)) m.returnedCount += 1;
    }
  }
  return out;
}

/** A row from one of the recovery source tables, for the pure reference below. */
export interface RecoveryMetricRow extends OrderMetricRow {
  /** Only meaningful for `orders`-table rows; ignored for cart_orders. */
  isDeliveredFollowUp?: boolean;
}

/**
 * PURE reference for `getRecoveryCombinedStaffMetrics`. Encodes the dedup rule
 * that avoids double-paying graduated follow-ups:
 *   - `orders` rows count ONLY when is_delivered_follow_up = true (this slice
 *     already contains graduated follow_up_orders + CS-created delivered
 *     follow-ups).
 *   - `cartOrders` rows all count (their graduated copy is order_source='online',
 *     NOT flagged, so there is no overlap with the orders slice).
 *   - `followUpOrders` rows are DELIBERATELY NOT summed — their delivered rows are
 *     already represented in the orders slice as is_delivered_follow_up = true.
 * Window + attribution semantics per row are identical to `aggregatePayMetrics`.
 */
export function aggregateRecoveryCombinedMetrics(
  input: {
    orders: RecoveryMetricRow[];
    cartOrders: RecoveryMetricRow[];
    /** Accepted for signature symmetry with the live tables; intentionally ignored. */
    followUpOrders?: RecoveryMetricRow[];
  },
  staffId: string,
  periodStart: Date,
  periodEnd: Date,
): PayBatchedMetric {
  const inWindow = (d: Date | null) => d != null && d >= periodStart && d <= periodEnd;
  const isDelivered = (s: string) => s === 'DELIVERED' || s === 'REMITTED';
  const attributed = (o: RecoveryMetricRow) =>
    o.assignedCsId === staffId || o.mediaBuyerId === staffId;

  const out: PayBatchedMetric = { deliveredCount: 0, totalOrders: 0, deliveredCohortCount: 0, returnedCount: 0 };

  const fold = (rows: RecoveryMetricRow[], requireDeliveredFollowUp: boolean) => {
    for (const o of rows) {
      if (requireDeliveredFollowUp && o.isDeliveredFollowUp !== true) continue;
      if (!attributed(o)) continue;
      if (isDelivered(o.status) && inWindow(o.deliveredAt)) out.deliveredCount += 1;
      if (o.status !== 'DELETED' && inWindow(o.createdAt)) out.totalOrders += 1;
      if (isDelivered(o.status) && inWindow(o.createdAt)) out.deliveredCohortCount += 1;
      if (o.status === 'RETURNED' && inWindow(o.deliveredAt)) out.returnedCount += 1;
    }
  };

  fold(input.orders, true); // orders: delivered-follow-up slice only
  fold(input.cartOrders, false); // cart orders: whole table
  // followUpOrders intentionally excluded (already counted in the orders slice).

  return out;
}

@Injectable()
export class PayrollMetricsService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async getStaffMetrics(input: StaffMetricsInput, tx: TxLike = this.db): Promise<PayrollMetrics> {
    if (input.deliveredMetricSource === 'RECOVERY_COMBINED') {
      return this.getRecoveryCombinedStaffMetrics(input, tx);
    }

    const attribution = or(
      eq(schema.orders.assignedCsId, input.staffId),
      eq(schema.orders.mediaBuyerId, input.staffId),
    );

    const [deliveredRows, totalOrdersRows, deliveredCohortRows, returnedRows, carryOverRows] = await Promise.all([
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.deliveredAt, input.periodStart),
            lte(schema.orders.deliveredAt, input.periodEnd),
            attribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            sql`${schema.orders.status} <> 'DELETED'`,
            gte(schema.orders.createdAt, input.periodStart),
            lte(schema.orders.createdAt, input.periodEnd),
            attribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.createdAt, input.periodStart),
            lte(schema.orders.createdAt, input.periodEnd),
            attribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.status, 'RETURNED'),
            gte(schema.orders.deliveredAt, input.periodStart),
            lte(schema.orders.deliveredAt, input.periodEnd),
            attribution,
          ),
        ),
      // Carry-over delivered: DELIVERED/REMITTED this period (by delivered_at)
      // whose order was GENERATED in a PRIOR period (created_at < periodStart).
      // DISPLAY-ONLY — this is the "of which carried over" slice of deliveredCount.
      // It is NOT fed into pay math, individualDr, or missingData. Commission
      // already pays the full deliveredCount (by delivered_at); this just breaks
      // out how much of it originated before the period.
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.deliveredAt, input.periodStart),
            lte(schema.orders.deliveredAt, input.periodEnd),
            lt(schema.orders.createdAt, input.periodStart),
            attribution,
          ),
        ),
    ]);

    const deliveredCount = Number(deliveredRows[0]?.count ?? 0);
    const totalOrders = Number(totalOrdersRows[0]?.count ?? 0);
    const deliveredCohortCount = Number(deliveredCohortRows[0]?.count ?? 0);
    const returnedCount = Number(returnedRows[0]?.count ?? 0);
    const deliveredCarryOverCount = Number(carryOverRows[0]?.count ?? 0);
    const individualDr = totalOrders > 0 ? (deliveredCohortCount / totalOrders) * 100 : 0;

    let teamDr: number | undefined;
    if (input.reporteeIds?.length) {
      teamDr = await this.computeTeamDr(tx, input.reporteeIds, input.periodStart, input.periodEnd);
    }

    let cpa: number | null = null;
    if (input.staffRole === 'MEDIA_BUYER' || input.staffRole === 'HEAD_OF_MARKETING') {
      cpa = await this.computeCpa(tx, input.staffId, input.periodStart, input.periodEnd, totalOrders);
    }

    const { deliveredByProduct, drByProduct } = await this.computePerProductMetrics(
      tx,
      input.staffId,
      input.periodStart,
      input.periodEnd,
    );

    const missingData =
      input.staffRole !== 'HR_MANAGER' &&
      totalOrders === 0 &&
      deliveredCount === 0 &&
      !['FINANCE_OFFICER', 'BRANCH_ADMIN', 'STOCK_MANAGER'].includes(input.staffRole);

    return {
      individualDr,
      teamDr,
      cpa,
      deliveredCount,
      deliveredCohortCount,
      // Display-only breakdown of deliveredCount: how many delivered this period
      // were generated in a prior period. Not used in any pay/rate calculation.
      deliveredCarryOverCount,
      totalOrders,
      returnedCount,
      deliveredByProduct,
      drByProduct,
      missingData,
    };
  }

  /**
   * Delivered-order metrics for a RECOVERY_COMBINED staff member (e.g. a
   * "Customer Support – Follow-up on Delivered Orders" closer). Counts across the
   * recovery pipelines instead of the funnel:
   *   - orders WHERE is_delivered_follow_up = true  (graduated follow-ups +
   *     CS-created delivered-follow-up orders)
   *   - cart_orders                                 (recovered carts)
   * The follow_up_orders table is intentionally NOT summed — its delivered rows
   * graduate into orders as is_delivered_follow_up = true and are already counted
   * in the orders slice; summing both would double-count (and double-pay).
   *
   * The four count metrics use the SAME window semantics as the funnel path:
   *   - deliveredCount        : status DELIVERED/REMITTED, delivered_at in period
   *   - totalOrders           : status <> DELETED, created_at in period
   *   - deliveredCohortCount  : status DELIVERED/REMITTED, created_at in period
   *   - returnedCount         : status RETURNED, delivered_at in period
   * Attribution is OR(assigned_cs_id = staff, media_buyer_id = staff) per table.
   * CPA / per-product breakdowns are funnel-only and stay empty here.
   */
  private async getRecoveryCombinedStaffMetrics(
    input: StaffMetricsInput,
    tx: TxLike,
  ): Promise<PayrollMetrics> {
    const { staffId, periodStart, periodEnd } = input;

    // orders slice: only the delivered-follow-up population, attributed to staff.
    const ordAttribution = or(
      eq(schema.orders.assignedCsId, staffId),
      eq(schema.orders.mediaBuyerId, staffId),
    );
    const ordDeliveredFollowUp = eq(schema.orders.isDeliveredFollowUp, true);

    // cart_orders slice: whole table (no delivered-follow-up flag exists here),
    // attributed to staff.
    const cartAttribution = or(
      eq(schema.cartOrders.assignedCsId, staffId),
      eq(schema.cartOrders.mediaBuyerId, staffId),
    );

    const [
      ordDelivered,
      ordTotal,
      ordCohort,
      ordReturned,
      ordCarryOver,
      cartDelivered,
      cartTotal,
      cartCohort,
      cartReturned,
      cartCarryOver,
    ] = await Promise.all([
      // ── orders (is_delivered_follow_up = true) ──
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            ordDeliveredFollowUp,
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.deliveredAt, periodStart),
            lte(schema.orders.deliveredAt, periodEnd),
            ordAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            ordDeliveredFollowUp,
            sql`${schema.orders.status} <> 'DELETED'`,
            gte(schema.orders.createdAt, periodStart),
            lte(schema.orders.createdAt, periodEnd),
            ordAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            ordDeliveredFollowUp,
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.createdAt, periodStart),
            lte(schema.orders.createdAt, periodEnd),
            ordAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            ordDeliveredFollowUp,
            eq(schema.orders.status, 'RETURNED'),
            gte(schema.orders.deliveredAt, periodStart),
            lte(schema.orders.deliveredAt, periodEnd),
            ordAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            ordDeliveredFollowUp,
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.deliveredAt, periodStart),
            lte(schema.orders.deliveredAt, periodEnd),
            lt(schema.orders.createdAt, periodStart),
            ordAttribution,
          ),
        ),
      // ── cart_orders ──
      tx
        .select({ count: count() })
        .from(schema.cartOrders)
        .where(
          and(
            inArray(schema.cartOrders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.cartOrders.deliveredAt, periodStart),
            lte(schema.cartOrders.deliveredAt, periodEnd),
            cartAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.cartOrders)
        .where(
          and(
            sql`${schema.cartOrders.status} <> 'DELETED'`,
            gte(schema.cartOrders.createdAt, periodStart),
            lte(schema.cartOrders.createdAt, periodEnd),
            cartAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.cartOrders)
        .where(
          and(
            inArray(schema.cartOrders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.cartOrders.createdAt, periodStart),
            lte(schema.cartOrders.createdAt, periodEnd),
            cartAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.cartOrders)
        .where(
          and(
            eq(schema.cartOrders.status, 'RETURNED'),
            gte(schema.cartOrders.deliveredAt, periodStart),
            lte(schema.cartOrders.deliveredAt, periodEnd),
            cartAttribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.cartOrders)
        .where(
          and(
            inArray(schema.cartOrders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.cartOrders.deliveredAt, periodStart),
            lte(schema.cartOrders.deliveredAt, periodEnd),
            lt(schema.cartOrders.createdAt, periodStart),
            cartAttribution,
          ),
        ),
    ]);

    const deliveredCount =
      Number(ordDelivered[0]?.count ?? 0) + Number(cartDelivered[0]?.count ?? 0);
    const totalOrders = Number(ordTotal[0]?.count ?? 0) + Number(cartTotal[0]?.count ?? 0);
    const deliveredCohortCount =
      Number(ordCohort[0]?.count ?? 0) + Number(cartCohort[0]?.count ?? 0);
    const returnedCount =
      Number(ordReturned[0]?.count ?? 0) + Number(cartReturned[0]?.count ?? 0);
    const deliveredCarryOverCount =
      Number(ordCarryOver[0]?.count ?? 0) + Number(cartCarryOver[0]?.count ?? 0);
    const individualDr = totalOrders > 0 ? (deliveredCohortCount / totalOrders) * 100 : 0;

    let teamDr: number | undefined;
    if (input.reporteeIds?.length) {
      teamDr = await this.computeTeamDr(tx, input.reporteeIds, periodStart, periodEnd);
    }

    const missingData =
      input.staffRole !== 'HR_MANAGER' &&
      totalOrders === 0 &&
      deliveredCount === 0 &&
      !['FINANCE_OFFICER', 'BRANCH_ADMIN', 'STOCK_MANAGER'].includes(input.staffRole);

    return {
      individualDr,
      teamDr,
      // CPA + per-product breakdowns are funnel-only concepts; not applicable to
      // recovery closers.
      cpa: null,
      deliveredCount,
      deliveredCohortCount,
      deliveredCarryOverCount,
      totalOrders,
      returnedCount,
      deliveredByProduct: {},
      drByProduct: {},
      missingData,
    };
  }

  async getStaffMetricsBulk(
    staff: Array<{
      id: string;
      role: string;
      crmLinked?: boolean;
      reportsToUserId?: string | null;
      /** When set, resolves this member's delivered-metric source from the pay role. */
      payRoleId?: string | null;
    }>,
    periodStart: Date,
    periodEnd: Date,
    tx: TxLike = this.db,
  ): Promise<Map<string, PayrollMetrics>> {
    const reporteeMap = new Map<string, string[]>();
    for (const s of staff) {
      if (s.reportsToUserId) {
        const list = reporteeMap.get(s.reportsToUserId) ?? [];
        list.push(s.id);
        reporteeMap.set(s.reportsToUserId, list);
      }
    }

    // Resolve which pay roles are RECOVERY_COMBINED in one query so the per-staff
    // metric uses the right pipeline (recovery closers count cart + delivered-
    // follow-up deliveries, not the funnel).
    const payRoleIds = [...new Set(staff.map((s) => s.payRoleId).filter(Boolean))] as string[];
    const recoveryPayRoleIds = new Set<string>();
    if (payRoleIds.length) {
      const rows = await tx
        .select({
          id: schema.payrollPayRoles.id,
          deliveredMetricSource: schema.payrollPayRoles.deliveredMetricSource,
        })
        .from(schema.payrollPayRoles)
        .where(inArray(schema.payrollPayRoles.id, payRoleIds));
      for (const r of rows) {
        if (r.deliveredMetricSource === 'RECOVERY_COMBINED') recoveryPayRoleIds.add(r.id);
      }
    }

    const result = new Map<string, PayrollMetrics>();
    await Promise.all(
      staff.map(async (s) => {
        const metrics = await this.getStaffMetrics(
          {
            staffId: s.id,
            staffRole: s.role,
            periodStart,
            periodEnd,
            crmLinked: true,
            reporteeIds: reporteeMap.get(s.id),
            deliveredMetricSource:
              s.payRoleId && recoveryPayRoleIds.has(s.payRoleId) ? 'RECOVERY_COMBINED' : 'FUNNEL',
          },
          tx,
        );
        result.set(s.id, metrics);
      }),
    );
    return result;
  }

  /**
   * The ONLY order-count metrics that feed the pay total (via
   * computePayrollFormula → metricValue): deliveredCount, returnedCount, and
   * individualDr = deliveredCohortCount / totalOrders. Everything else
   * getStaffMetrics returns (deliveredCarryOverCount, deliveredByProduct,
   * drByProduct) is DISPLAY-ONLY and never changes baseSalary/bonus/penalty/PAYE,
   * so the batched preview path deliberately skips it.
   */
  static readonly PAY_METRIC_ZERO: PayBatchedMetric = {
    deliveredCount: 0,
    totalOrders: 0,
    deliveredCohortCount: 0,
    returnedCount: 0,
  };

  /**
   * One-query batched twin of the 4 pay-relevant count queries in
   * `getStaffMetrics`, for many staff at once. Returns a Map keyed by staffId.
   *
   * OR-ATTRIBUTION WITHOUT DOUBLE-COUNT: the per-member query counts an order
   * ONCE if `assigned_cs_id = staff OR media_buyer_id = staff`. Here we unnest
   * each order's two attribution columns via `LATERAL (VALUES ...)`, filter to
   * the requested staffIds, group by that staff id, and use
   * `COUNT(DISTINCT o.id)` so an order where BOTH columns point at the SAME
   * staff is still counted once — EXACTLY matching the OR semantics. (Two
   * separate grouped-then-summed queries would double-count that case.)
   */
  async getStaffMetricsBatched(
    staffIds: string[],
    periodStart: Date,
    periodEnd: Date,
    tx: TxLike = this.db,
  ): Promise<Map<string, PayBatchedMetric>> {
    const result = new Map<string, PayBatchedMetric>();
    const ids = [...new Set(staffIds.filter(Boolean))];
    if (ids.length === 0) return result;

    // Seed zeros so every requested staffId has an entry (staff with no orders
    // must still resolve to the same zeroed metrics the per-member path returns).
    for (const id of ids) result.set(id, { ...PayrollMetricsService.PAY_METRIC_ZERO });

    // ISO strings + ::timestamptz: raw Date binds inside sql`` FILTER break
    // postgres-js ("Received an instance of Date"). Mirrors computePerProductMetrics.
    const startIso = periodStart.toISOString();
    const endIso = periodEnd.toISOString();
    const idList = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );

    const rows = await tx.execute(sql`
      SELECT
        v.staff_id AS staff_id,
        count(distinct o.id) filter (
          where o.status in ('DELIVERED','REMITTED')
            and o.delivered_at >= ${startIso}::timestamptz
            and o.delivered_at <= ${endIso}::timestamptz
        ) AS delivered_count,
        count(distinct o.id) filter (
          where o.status <> 'DELETED'
            and o.created_at >= ${startIso}::timestamptz
            and o.created_at <= ${endIso}::timestamptz
        ) AS total_orders,
        count(distinct o.id) filter (
          where o.status in ('DELIVERED','REMITTED')
            and o.created_at >= ${startIso}::timestamptz
            and o.created_at <= ${endIso}::timestamptz
        ) AS delivered_cohort_count,
        count(distinct o.id) filter (
          where o.status = 'RETURNED'
            and o.delivered_at >= ${startIso}::timestamptz
            and o.delivered_at <= ${endIso}::timestamptz
        ) AS returned_count
      FROM ${schema.orders} o
      CROSS JOIN LATERAL (VALUES (o.assigned_cs_id), (o.media_buyer_id)) AS v(staff_id)
      WHERE v.staff_id IN (${idList})
      GROUP BY v.staff_id
    `);

    // postgres-js returns rows on `.rows` (execute) — normalise both shapes
    // (matches the Array.isArray(result) ? result : result.rows pattern used elsewhere).
    const raw = Array.isArray(rows)
      ? (rows as unknown[])
      : ((rows as unknown as { rows?: unknown[] })?.rows ?? []);
    for (const r of raw as Array<Record<string, unknown>>) {
      const staffId = String(r['staff_id']);
      if (!result.has(staffId)) continue;
      result.set(staffId, {
        deliveredCount: Number(r['delivered_count'] ?? 0),
        totalOrders: Number(r['total_orders'] ?? 0),
        deliveredCohortCount: Number(r['delivered_cohort_count'] ?? 0),
        returnedCount: Number(r['returned_count'] ?? 0),
      });
    }

    return result;
  }

  /**
   * Batched team-DR: for each Head with a non-empty reportee set, compute the
   * team delivery rate. Heads are few, so one pair of count queries per Head is
   * acceptable; they run in parallel across the pool. Returns Map<headId, dr%>.
   */
  async computeTeamDrBatched(
    tx: TxLike,
    reporteesByHead: Map<string, string[]>,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    await Promise.all(
      [...reporteesByHead.entries()].map(async ([headId, reporteeIds]) => {
        if (!reporteeIds.length) {
          out.set(headId, 0);
          return;
        }
        out.set(headId, await this.computeTeamDr(tx, reporteeIds, periodStart, periodEnd));
      }),
    );
    return out;
  }

  /**
   * Batched CPA for a set of media buyers. One grouped ad-spend query instead of
   * one per staff. `totalOrdersByStaff` supplies the divisor from the batched
   * order metrics. Mirrors `computeCpa` exactly (null when no orders or no spend).
   */
  async computeCpaBatched(
    tx: TxLike,
    staffIds: string[],
    periodStart: Date,
    periodEnd: Date,
    totalOrdersByStaff: Map<string, number>,
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    const ids = [...new Set(staffIds.filter(Boolean))];
    for (const id of ids) out.set(id, null);
    if (ids.length === 0) return out;

    const spendRows = await tx
      .select({
        mediaBuyerId: schema.adSpendLogs.mediaBuyerId,
        total: sum(schema.adSpendLogs.spendAmount),
      })
      .from(schema.adSpendLogs)
      .where(
        and(
          inArray(schema.adSpendLogs.mediaBuyerId, ids),
          eq(schema.adSpendLogs.status, 'APPROVED'),
          eq(schema.adSpendLogs.category, 'AD_SPEND'),
          gte(schema.adSpendLogs.spendDate, periodStart),
          lte(schema.adSpendLogs.spendDate, periodEnd),
        ),
      )
      .groupBy(schema.adSpendLogs.mediaBuyerId);

    const spendById = new Map(spendRows.map((r) => [r.mediaBuyerId as string, Number(r.total ?? 0)]));
    for (const id of ids) {
      const totalOrders = totalOrdersByStaff.get(id) ?? 0;
      const spend = spendById.get(id) ?? 0;
      out.set(id, totalOrders > 0 && spend > 0 ? spend / totalOrders : null);
    }
    return out;
  }

  private async computeTeamDr(
    tx: TxLike,
    reporteeIds: string[],
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    if (reporteeIds.length === 0) return 0;

    const attribution = or(
      inArray(schema.orders.assignedCsId, reporteeIds),
      inArray(schema.orders.mediaBuyerId, reporteeIds),
    );

    const [cohortRows, totalRows] = await Promise.all([
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.createdAt, periodStart),
            lte(schema.orders.createdAt, periodEnd),
            attribution,
          ),
        ),
      tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            sql`${schema.orders.status} <> 'DELETED'`,
            gte(schema.orders.createdAt, periodStart),
            lte(schema.orders.createdAt, periodEnd),
            attribution,
          ),
        ),
    ]);

    const cohort = Number(cohortRows[0]?.count ?? 0);
    const total = Number(totalRows[0]?.count ?? 0);
    return total > 0 ? (cohort / total) * 100 : 0;
  }

  private async computeCpa(
    tx: TxLike,
    staffId: string,
    periodStart: Date,
    periodEnd: Date,
    totalOrders: number,
  ): Promise<number | null> {
    if (totalOrders <= 0) return null;

    const spendRows = await tx
      .select({ total: sum(schema.adSpendLogs.spendAmount) })
      .from(schema.adSpendLogs)
      .where(
        and(
          eq(schema.adSpendLogs.mediaBuyerId, staffId),
          eq(schema.adSpendLogs.status, 'APPROVED'),
          eq(schema.adSpendLogs.category, 'AD_SPEND'),
          gte(schema.adSpendLogs.spendDate, periodStart),
          lte(schema.adSpendLogs.spendDate, periodEnd),
        ),
      );

    const spend = Number(spendRows[0]?.total ?? 0);
    if (spend <= 0) return null;
    return spend / totalOrders;
  }

  private async computePerProductMetrics(
    tx: TxLike,
    staffId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ deliveredByProduct: Record<string, number>; drByProduct: Record<string, number> }> {
    const attribution = or(
      eq(schema.orders.assignedCsId, staffId),
      eq(schema.orders.mediaBuyerId, staffId),
    );

    // ISO string + ::timestamptz: raw Date binds inside sql`` FILTER break postgres-js
    // ("Received an instance of Date") and zero out Earnings outlook for every staff.
    const startIso = periodStart.toISOString();
    const endIso = periodEnd.toISOString();

    const rows = await tx
      .select({
        productId: schema.orderItems.productId,
        delivered: count(),
        cohortDelivered: sql<number>`count(*) filter (where ${schema.orders.createdAt} >= ${startIso}::timestamptz and ${schema.orders.createdAt} <= ${endIso}::timestamptz)`,
        totalCreated: sql<number>`count(distinct ${schema.orders.id}) filter (where ${schema.orders.createdAt} >= ${startIso}::timestamptz and ${schema.orders.createdAt} <= ${endIso}::timestamptz)`,
      })
      .from(schema.orders)
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .where(
        and(
          inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
          gte(schema.orders.deliveredAt, periodStart),
          lte(schema.orders.deliveredAt, periodEnd),
          attribution,
        ),
      )
      .groupBy(schema.orderItems.productId);

    const deliveredByProduct: Record<string, number> = {};
    const drByProduct: Record<string, number> = {};

    for (const row of rows) {
      if (!row.productId) continue;
      deliveredByProduct[row.productId] = Number(row.delivered ?? 0);
      const total = Number(row.totalCreated ?? 0);
      const cohort = Number(row.cohortDelivered ?? 0);
      drByProduct[row.productId] = total > 0 ? (cohort / total) * 100 : 0;
    }

    return { deliveredByProduct, drByProduct };
  }
}
