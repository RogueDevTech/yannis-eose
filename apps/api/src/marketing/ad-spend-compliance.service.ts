import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, gte, lte, inArray } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';

/**
 * Cron: reminds Media Buyers who haven't logged today's ad spend
 * and notifies Heads of Marketing with a summary of missing submissions.
 *
 * Cadence (all WAT / UTC+1):
 *   - Every 10 minutes from 7 PM to midnight (evening sweep).
 *   - A fixed 8 PM reminder (same-day nudge before the day closes).
 *   - A fixed 9 AM reminder the following morning (last nudge before the
 *     24-hour block kicks in for the prior unfilled day).
 * Only notifies MBs who haven't logged spend yet; stops once they do.
 */
@Injectable()
export class AdSpendComplianceService {
  private readonly logger = new Logger('AdSpendCompliance');

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
  ) {}

  private async runReminders(source: string, targetDate?: string): Promise<void> {
    try {
      await this.sendAdSpendReminders(targetDate);
    } catch (err) {
      this.logger.error(
        `Ad spend compliance reminder (${source}) failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  // Every 10 minutes from 7 PM to midnight WAT (UTC+1 = 6 PM to 11 PM UTC).
  // Nest cron uses 6 fields: sec min hour dom mon dow.
  @Cron('0 */10 18-22 * * *')
  async handleEveningSweep(): Promise<void> {
    await this.runReminders('evening-sweep');
  }

  // Fixed 8 PM WAT reminder (20:00 WAT = 19:00 UTC).
  @Cron('0 0 19 * * *')
  async handleEightPmReminder(): Promise<void> {
    await this.runReminders('8pm');
  }

  // Fixed 9 AM WAT next-day reminder (09:00 WAT = 08:00 UTC).
  // Targets YESTERDAY: this is the last nudge before the prior unfilled day
  // crosses 24h and blocks the MB. Reminding about "today" at 9 AM would be
  // premature (today's spend isn't due yet).
  @Cron('0 0 8 * * *')
  async handleNineAmReminder(): Promise<void> {
    await this.runReminders('9am', this.yesterdayNigeria());
  }

  /** Yesterday's calendar date in Nigeria TZ, as YYYY-MM-DD. */
  private yesterdayNigeria(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  /**
   * @param targetDate Optional YYYY-MM-DD (Nigeria TZ) to check compliance for.
   *   Defaults to today. The 9 AM cron passes yesterday so the last nudge lands
   *   on the day about to cross the 24-hour block.
   */
  async sendAdSpendReminders(targetDate?: string): Promise<void> {
    // Target day in Nigeria time (defaults to today).
    const nigeriaFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const today = targetDate ?? nigeriaFormatter.format(new Date());

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

    // Copy differs for a same-day nudge vs a next-morning catch-up.
    const isBacklog = targetDate !== undefined;

    // Notify each unfilled MB
    for (const mb of unfilledMBs) {
      this.notifications.enqueueCreate({
        userId: mb.id,
        type: 'marketing:ad_spend_reminder',
        title: 'Log your ad spend',
        body: isBacklog
          ? `You still haven't recorded your ad spend for ${today}. Log it now to avoid being locked out.`
          : `You haven't recorded your ad spend for today (${today}). Please log it now.`,
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
