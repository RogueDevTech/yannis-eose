import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  RESERVATION_RELEASE_SETTING_KEY,
  SYSTEM_ACTOR_ID,
  resolveReservationReleaseDays,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { SettingsService } from '../settings/settings.service';
import { InventoryService } from './inventory.service';

/** Most orders released per company per run; the next run picks up the rest. */
const BATCH_LIMIT = 500;

/**
 * Automatic reserved-stock release (owner rule 2026-11-12, migration 0362).
 *
 * Hourly. For each company, orders still with logistics (AGENT_ASSIGNED /
 * DISPATCHED / IN_TRANSIT) whose reservation is older than the company's
 * STOCK_RESERVATION_RELEASE_CONFIG days (default 30, 0 = never) get their
 * reserved stock released. The order keeps its status. Idempotent: released
 * orders are marked (`reservation_released_at`) and skipped afterwards.
 */
@Injectable()
export class ReservationReleaseService {
  private readonly logger = new Logger('ReservationRelease');
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly inventory: InventoryService,
  ) {}

  @Cron('0 35 * * * *') // every hour at :35
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const companies = (await this.db.execute(
        sql`SELECT id FROM branch_groups WHERE status = 'ACTIVE'`,
      )) as unknown as Array<{ id: string }>;
      for (const { id: groupId } of companies) {
        try {
          await this.releaseForCompany(groupId);
        } catch (err) {
          this.logger.error(`Release failed for company ${groupId}: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Release overdue reservations for one company. Returns how many orders were released. */
  async releaseForCompany(groupId: string): Promise<number> {
    const days = resolveReservationReleaseDays(await this.settings.get(RESERVATION_RELEASE_SETTING_KEY, groupId));
    if (days <= 0) return 0;

    const due = (await this.db.execute(sql`
      SELECT o.id
      FROM orders o
      JOIN branches b ON b.id = o.servicing_branch_id
      WHERE b.group_id = ${groupId}::uuid
        AND o.status IN ('AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT')
        AND o.reservation_released_at IS NULL
        AND o.logistics_location_id IS NOT NULL
        AND o.allocated_at < now() - make_interval(days => ${days}::int)
      ORDER BY o.allocated_at
      LIMIT ${BATCH_LIMIT}
    `)) as unknown as Array<{ id: string }>;

    let released = 0;
    for (const { id } of due) {
      try {
        const ok = await this.inventory.releaseHeldReservation(
          id,
          { id: SYSTEM_ACTOR_ID, name: 'System' },
          `Automatic: with logistics for more than ${days} days.`,
          { automatic: true },
        );
        if (ok) released += 1;
      } catch (err) {
        this.logger.warn(`Could not release reservation for order ${id}: ${(err as Error).message}`);
      }
    }
    if (released > 0) {
      this.logger.log(`Released reserved stock for ${released} order(s) in company ${groupId} (over ${days} days).`);
    }
    return released;
  }
}
