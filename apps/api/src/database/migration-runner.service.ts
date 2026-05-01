import { Injectable, Inject, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, runSqlMigrations } from '@yannis/shared';
import { DRIZZLE } from './database.tokens';

/**
 * Auto-migrate on startup.
 *
 * Delegates to `@yannis/shared` `runSqlMigrations()` — same logic as the deploy CLI.
 *
 * Why a custom runner (and not `drizzle-kit migrate`):
 *  - Hand-written SQL files (RLS, triggers, history-table syncs) are not in Drizzle's journal.
 */
@Injectable()
export class MigrationRunnerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationRunnerService.name);

  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async onApplicationBootstrap(): Promise<void> {
    await runSqlMigrations({
      db: this.db,
      migrationsSearchFrom: __dirname,
      logger: {
        log: (m: string) => this.logger.log(m),
        warn: (m: string) => this.logger.warn(m),
        error: (m: string) => this.logger.error(m),
      },
    });
  }
}
