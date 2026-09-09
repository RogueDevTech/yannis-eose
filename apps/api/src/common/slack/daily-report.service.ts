import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, gte, lte, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../../database/database.module';
import { nigeriaToday, nigeriaDayStart, nigeriaDayEnd } from '../utils/date-range';
import { SlackService } from './slack.service';
import { SlackErrorBufferService } from './error-buffer.service';
import { YANNIS_EOSE_CHANNEL } from './slack-channels';
import { dailyReportTemplate } from './templates/daily-report.template';
import type { DailyReportCompany } from './templates/daily-report.template';

/**
 * A company (branch_groups row) plus the branches that belong to it. Branches
 * with a NULL group_id are collected into a synthetic "Unassigned" company so
 * no order silently drops out of the day's reporting.
 */
interface ReportCompany {
  /** branch_groups.id, or null for the synthetic "Unassigned" bucket. */
  groupId: string | null;
  name: string;
  branchIds: string[];
}

const UNASSIGNED_COMPANY_NAME = 'Unassigned';
const FALLBACK_CURRENCY_CODE = 'NGN';

@Injectable()
export class SlackDailyReportService {
  private readonly logger = new Logger(SlackDailyReportService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly slack: SlackService,
    private readonly errorBuffer: SlackErrorBufferService,
  ) {}

  @Cron('0 59 23 * * *', { timeZone: 'Africa/Lagos' })
  async sendDailyReport(): Promise<void> {
    const reportDate = nigeriaToday();
    try {
      const companies = await this.resolveCompanies();
      const currencyByGroupId = await this.resolveCompanyCurrencies();

      const sections: DailyReportCompany[] = [];
      for (const company of companies) {
        try {
          sections.push(
            await this.buildCompanySection(reportDate, company, currencyByGroupId),
          );
        } catch (error) {
          // One company failing must not cost us the rest of the report.
          const err = error as Error;
          this.logger.error(
            `daily report section failed for company ${company.name}: ${err.message}`,
            err.stack,
          );
        }
      }

      const { dbHealthy, dbLatencyMs } = await this.checkDbHealth();
      const errors = await this.errorBuffer.snapshot(reportDate);

      const alert = dailyReportTemplate({
        reportDate,
        companies: sections,
        errorTotal: errors.total,
        errorGroups: errors.groups,
        dbHealthy,
        dbLatencyMs,
      });
      await this.slack.sendMessage(
        YANNIS_EOSE_CHANNEL,
        alert.message,
        alert.blocks,
        alert.attachments,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`daily report failed: ${err.message}`, err.stack);
    } finally {
      await this.errorBuffer.reset(reportDate);
    }
  }

  /**
   * Companies with at least one branch, plus the "Unassigned" bucket for
   * branches that have no company yet. A company with no branches is skipped:
   * every metric here is branch-derived, so it could only ever report zeroes.
   */
  private async resolveCompanies(): Promise<ReportCompany[]> {
    const rows = await this.db
      .select({
        branchId: schema.branches.id,
        groupId: schema.branches.groupId,
        groupName: schema.branchGroups.name,
      })
      .from(schema.branches)
      .leftJoin(schema.branchGroups, eq(schema.branches.groupId, schema.branchGroups.id));

    const byCompany = new Map<string, ReportCompany>();
    for (const row of rows) {
      const key = row.groupId ?? UNASSIGNED_COMPANY_NAME;
      const existing = byCompany.get(key);
      if (existing) {
        existing.branchIds.push(row.branchId);
        continue;
      }
      byCompany.set(key, {
        groupId: row.groupId ?? null,
        name: row.groupId ? (row.groupName ?? UNASSIGNED_COMPANY_NAME) : UNASSIGNED_COMPANY_NAME,
        branchIds: [row.branchId],
      });
    }

    return [...byCompany.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Each company's base currency (currencies.is_default for the group), so money
   * renders with that company's symbol rather than a hardcoded naira sign.
   * Companies without a configured default fall back to NGN, the base country.
   */
  private async resolveCompanyCurrencies(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ groupId: schema.currencies.groupId, code: schema.currencies.code })
      .from(schema.currencies)
      .where(and(eq(schema.currencies.isDefault, true), eq(schema.currencies.active, true)));

    const byGroupId = new Map<string, string>();
    for (const row of rows) {
      if (row.groupId) byGroupId.set(row.groupId, row.code);
    }
    return byGroupId;
  }

  private async buildCompanySection(
    today: string,
    company: ReportCompany,
    currencyByGroupId: Map<string, string>,
  ): Promise<DailyReportCompany> {
    const dayStart = nigeriaDayStart(today);
    const dayEnd = nigeriaDayEnd(today);
    const { branchIds } = company;

    // Orders count against the company that owns either side of the split:
    // branch_id is marketing attribution, servicing_branch_id is fulfilment.
    // A daily volume report should show an order to the company that ran the
    // campaign as well as the one that serviced it.
    const orderInCompany = or(
      inArray(schema.orders.branchId, branchIds),
      inArray(schema.orders.servicingBranchId, branchIds),
    ) as SQL;

    const createdToday = and(
      gte(schema.orders.createdAt, dayStart),
      lte(schema.orders.createdAt, dayEnd),
      isNull(schema.orders.deletedAt),
      orderInCompany,
    );

    const statusRows = await this.db
      .select({
        status: schema.orders.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.orders)
      .where(createdToday)
      .groupBy(schema.orders.status);

    const ordersCreated = statusRows.reduce((sum, r) => sum + Number(r.count), 0);

    // Company membership for users: the junction table plus primary_branch_id,
    // mirroring MarketingService.getBranchUserIds — some users carry a primary
    // branch without a user_branches row.
    const companyUserIds = await this.getCompanyUserIds(branchIds);

    const [usersRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(
        and(
          gte(schema.users.createdAt, dayStart),
          lte(schema.users.createdAt, dayEnd),
          companyUserIds.length > 0
            ? inArray(schema.users.id, companyUserIds)
            : sql`false`,
        ),
      );

    // Ad spend today: AD_SPEND rows only (the sole category that feeds CPA/ROAS),
    // PENDING + APPROVED, matching the marketing service's spend conventions.
    // Company scope follows the same convention as MarketingService.listAdSpend:
    // campaign-linked rows via the company's campaigns, campaign-less rows via
    // the logging media buyer's branch membership.
    const companyCampaignIds = await this.getCompanyCampaignIds(branchIds);
    const spendInCompany = this.buildSpendScope(companyCampaignIds, companyUserIds);

    const [spendRow] = await this.db
      .select({ total: sql<string>`coalesce(sum(${schema.adSpendLogs.spendAmount}), 0)::text` })
      .from(schema.adSpendLogs)
      .where(
        and(
          gte(schema.adSpendLogs.spendDate, dayStart),
          lte(schema.adSpendLogs.spendDate, dayEnd),
          eq(schema.adSpendLogs.category, 'AD_SPEND'),
          inArray(schema.adSpendLogs.status, ['PENDING', 'APPROVED']),
          spendInCompany,
        ),
      );
    const adSpendToday = Number(spendRow?.total ?? '0');

    // Orders delivered today (by delivered_at) — the acquisition CPA denominator.
    const [deliveredRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(
        and(
          gte(schema.orders.deliveredAt, dayStart),
          lte(schema.orders.deliveredAt, dayEnd),
          isNull(schema.orders.deletedAt),
          orderInCompany,
        ),
      );
    const ordersDelivered = Number(deliveredRow?.count ?? 0);

    // Blended CPA. Headline = spend / orders created today (mirrors the orders-created
    // number above); delivered = spend / orders delivered today. null when no orders.
    const cpaCreated = ordersCreated > 0 ? adSpendToday / ordersCreated : null;
    const cpaDelivered = ordersDelivered > 0 ? adSpendToday / ordersDelivered : null;

    return {
      companyName: company.name,
      currencyCode: company.groupId
        ? (currencyByGroupId.get(company.groupId) ?? FALLBACK_CURRENCY_CODE)
        : FALLBACK_CURRENCY_CODE,
      ordersCreated,
      ordersByStatus: statusRows.map((r) => ({ status: r.status, count: Number(r.count) })),
      newUsers: Number(usersRow?.count ?? 0),
      adSpendToday,
      ordersDelivered,
      cpaCreated,
      cpaDelivered,
    };
  }

  /**
   * Spend scope for one company. Campaign-linked rows belong to the company that
   * owns the campaign; campaign-less rows (simple expenses) belong to the company
   * of the media buyer who logged them, so they never leak across companies.
   */
  private buildSpendScope(campaignIds: string[], userIds: string[]): SQL {
    const campaignScope = campaignIds.length > 0
      ? inArray(schema.adSpendLogs.campaignId, campaignIds)
      : null;
    const nullCampaignScope = userIds.length > 0
      ? and(
          isNull(schema.adSpendLogs.campaignId),
          inArray(schema.adSpendLogs.mediaBuyerId, userIds),
        )
      : null;

    if (campaignScope && nullCampaignScope) return or(campaignScope, nullCampaignScope) as SQL;
    if (campaignScope) return campaignScope;
    if (nullCampaignScope) return nullCampaignScope;
    // No campaigns and no members: this company can own no spend row.
    return sql`false`;
  }

  private async getCompanyUserIds(branchIds: string[]): Promise<string[]> {
    const [junctionRows, primaryRows] = await Promise.all([
      this.db
        .select({ userId: schema.userBranches.userId })
        .from(schema.userBranches)
        .where(inArray(schema.userBranches.branchId, branchIds)),
      this.db
        .select({ userId: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.primaryBranchId, branchIds)),
    ]);
    const ids = new Set(junctionRows.map((r) => r.userId));
    for (const r of primaryRows) ids.add(r.userId);
    return [...ids];
  }

  private async getCompanyCampaignIds(branchIds: string[]): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.branchId, branchIds));
    return rows.map((row) => row.id);
  }

  private async checkDbHealth(): Promise<{ dbHealthy: boolean; dbLatencyMs: number | null }> {
    const start = Date.now();
    try {
      await this.db.execute(sql`select 1`);
      return { dbHealthy: true, dbLatencyMs: Date.now() - start };
    } catch {
      return { dbHealthy: false, dbLatencyMs: null };
    }
  }
}
