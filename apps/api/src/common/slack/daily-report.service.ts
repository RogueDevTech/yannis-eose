import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, gte, lte, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../../database/database.module';
import { nigeriaToday, nigeriaDayStart, nigeriaDayEnd } from '../utils/date-range';
import { SlackService } from './slack.service';
import { SlackErrorBufferService } from './error-buffer.service';
import { YANNIS_EOSE_CHANNEL } from './slack-channels';
import { dailyReportTemplate } from './templates/daily-report.template';

@Injectable()
export class SlackDailyReportService {
  private readonly logger = new Logger(SlackDailyReportService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly slack: SlackService,
    private readonly errorBuffer: SlackErrorBufferService,
  ) {}

  @Cron('0 0 20 * * *', { timeZone: 'Africa/Lagos' })
  async sendDailyReport(): Promise<void> {
    const reportDate = nigeriaToday();
    try {
      const report = await this.buildReport(reportDate);
      const alert = dailyReportTemplate(report);
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

  private async buildReport(today: string) {
    const dayStart = nigeriaDayStart(today);
    const dayEnd = nigeriaDayEnd(today);
    const createdToday = and(
      gte(schema.orders.createdAt, dayStart),
      lte(schema.orders.createdAt, dayEnd),
      isNull(schema.orders.deletedAt),
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

    const [usersRow] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(
        and(
          gte(schema.users.createdAt, dayStart),
          lte(schema.users.createdAt, dayEnd),
        ),
      );

    const { dbHealthy, dbLatencyMs } = await this.checkDbHealth();
    const errors = await this.errorBuffer.snapshot(today);

    return {
      reportDate: today,
      ordersCreated,
      ordersByStatus: statusRows.map((r) => ({ status: r.status, count: Number(r.count) })),
      newUsers: Number(usersRow?.count ?? 0),
      errorTotal: errors.total,
      errorGroups: errors.groups,
      dbHealthy,
      dbLatencyMs,
    };
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
