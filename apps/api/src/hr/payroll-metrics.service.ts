import { Injectable, Inject } from '@nestjs/common';
import { and, count, eq, gte, inArray, lte, or, sql, sum } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { PayrollMetrics } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';

type TxLike = PostgresJsDatabase<typeof schema>;

export interface StaffMetricsInput {
  staffId: string;
  staffRole: string;
  periodStart: Date;
  periodEnd: Date;
  crmLinked?: boolean;
  reporteeIds?: string[];
}

@Injectable()
export class PayrollMetricsService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async getStaffMetrics(input: StaffMetricsInput, tx: TxLike = this.db): Promise<PayrollMetrics> {
    const attribution = or(
      eq(schema.orders.assignedCsId, input.staffId),
      eq(schema.orders.mediaBuyerId, input.staffId),
    );

    const [deliveredRows, totalOrdersRows, deliveredCohortRows, returnedRows] = await Promise.all([
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
    ]);

    const deliveredCount = Number(deliveredRows[0]?.count ?? 0);
    const totalOrders = Number(totalOrdersRows[0]?.count ?? 0);
    const deliveredCohortCount = Number(deliveredCohortRows[0]?.count ?? 0);
    const returnedCount = Number(returnedRows[0]?.count ?? 0);
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
      totalOrders,
      returnedCount,
      deliveredByProduct,
      drByProduct,
      missingData,
    };
  }

  async getStaffMetricsBulk(
    staff: Array<{ id: string; role: string; crmLinked?: boolean; reportsToUserId?: string | null }>,
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
          },
          tx,
        );
        result.set(s.id, metrics);
      }),
    );
    return result;
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

    const rows = await tx
      .select({
        productId: schema.orderItems.productId,
        delivered: count(),
        cohortDelivered: sql<number>`count(*) filter (where ${schema.orders.createdAt} >= ${periodStart} and ${schema.orders.createdAt} <= ${periodEnd})`,
        totalCreated: sql<number>`count(distinct ${schema.orders.id}) filter (where ${schema.orders.createdAt} >= ${periodStart} and ${schema.orders.createdAt} <= ${periodEnd})`,
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
