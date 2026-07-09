import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';

/**
 * Hourly cron: reminds Media Buyers who haven't logged today's ad spend
 * and notifies Heads of Marketing with a summary of missing submissions.
 *
 * Runs every 10 minutes from 7 PM to midnight WAT.
 * Only notifies MBs who haven't logged spend yet; stops once they do.
 */
@Injectable()
export class AdSpendComplianceService {
  private readonly logger = new Logger('AdSpendCompliance');

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
  ) {}

  // Every 10 minutes from 7 PM to midnight WAT (UTC+1 = 6 PM to 11 PM UTC)
  @Cron('*/10 * 18-22 * * *')
  async handleHourlyReminder(): Promise<void> {
    try {
      await this.sendAdSpendReminders();
    } catch (err) {
      this.logger.error(
        `Ad spend compliance reminder failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  async sendAdSpendReminders(): Promise<void> {
    // Today in Nigeria time
    const nigeriaFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const today = nigeriaFormatter.format(new Date());

    // Get all active MBs
    const activeMBs = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'MEDIA_BUYER'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    if (activeMBs.length === 0) return;

    const mbIds = activeMBs.map((m) => m.id);

    // Find MBs who HAVE logged at least one entry today
    const filledRows = await this.db
      .selectDistinct({ mediaBuyerId: schema.adSpendLogs.mediaBuyerId })
      .from(schema.adSpendLogs)
      .where(
        and(
          inArray(schema.adSpendLogs.mediaBuyerId, mbIds),
          gte(schema.adSpendLogs.spendDate, nigeriaDayStart(today)),
          lte(schema.adSpendLogs.spendDate, nigeriaDayEnd(today)),
        ),
      );

    const filledSet = new Set(filledRows.map((r) => r.mediaBuyerId));
    const unfilledMBs = activeMBs.filter((m) => !filledSet.has(m.id));

    if (unfilledMBs.length === 0) {
      this.logger.log(`Ad spend compliance: all ${activeMBs.length} MBs have logged spend for ${today}`);
      return;
    }

    this.logger.log(
      `Ad spend compliance: ${unfilledMBs.length}/${activeMBs.length} MBs have not logged spend for ${today}. Sending reminders.`,
    );

    // Notify each unfilled MB
    for (const mb of unfilledMBs) {
      this.notifications.enqueueCreate({
        userId: mb.id,
        type: 'marketing:ad_spend_reminder',
        title: 'Log your ad spend',
        body: `You haven't recorded your ad spend for today (${today}). Please log it now.`,
        data: { date: today },
      });
    }

    // Notify HoMs with summary
    const unfilledNames = unfilledMBs
      .slice(0, 5)
      .map((m) => m.name)
      .join(', ');
    const moreCount = unfilledMBs.length > 5 ? ` and ${unfilledMBs.length - 5} more` : '';

    this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
      type: 'marketing:ad_spend_compliance_summary',
      title: `${unfilledMBs.length} MBs missing ad spend`,
      body: `${unfilledNames}${moreCount} haven't logged ad spend for ${today}.`,
      data: { date: today, unfilledCount: String(unfilledMBs.length) },
    });
  }
}
