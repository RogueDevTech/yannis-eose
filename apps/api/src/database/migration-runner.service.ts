import { Injectable, Inject, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
// Deep relative import on purpose — the migrations runner pulls in `node:fs` /
// `node:path` and must NOT be re-exported from `@yannis/shared`'s public barrel
// (Vite chokes on the Node built-ins for the web bundle). Webpack already
// includes `packages/` in ts-loader so this resolves cleanly at build time.
import { runSqlMigrations } from '../../../../packages/shared/src/migrations/run-sql-migrations';
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
