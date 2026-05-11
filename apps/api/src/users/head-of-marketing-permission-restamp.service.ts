import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { applyPermissionCatalog } from '../../../../packages/shared/src/rbac/seed-runner';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { CacheService } from '../common/cache/cache.service';
import { DRIZZLE, PG_CLIENT } from '../database/database.tokens';
import { UsersService } from './users.service';

const STALE_HOM_GRANTED_CODES = ['marketing.scope.global', 'products.read'] as const;

/**
 * One-time bootstrap fix for the HoM branch-scope rollout.
 *
 * Why this exists:
 * - old HoM snapshots may still carry grants that used to be template defaults
 * - the snapshot model doesn't record grant provenance, so those rows now look
 *   identical to deliberate per-user extras
 *
 * We explicitly drop the known-retired HoM baseline grants above, then rebuild
 * each HoM snapshot from the CURRENT template plus all other overrides.
 */
@Injectable()
export class HeadOfMarketingPermissionRestampService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HeadOfMarketingPermissionRestampService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly sql: ReturnType<typeof postgres>,
    private readonly usersService: UsersService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env['HEAD_OF_MARKETING_PERMISSION_RESTAMP_AUTORUN'] === 'false') {
      this.logger.log(
        'HEAD_OF_MARKETING_PERMISSION_RESTAMP_AUTORUN=false — skipping HoM permission restamp.',
      );
      return;
    }

    try {
      const markerResult = (await this.db.execute(
        sql`SELECT COUNT(*)::int AS n FROM _yannis_hom_branch_scope_applied`,
      )) as unknown;
      const rows = Array.isArray(markerResult)
        ? (markerResult as Array<{ n?: number }>)
        : ((markerResult as { rows?: Array<{ n?: number }> })?.rows ?? []);
      const count = Number(rows[0]?.n ?? 0);
      if (count > 0) {
        return;
      }
    } catch (err) {
      this.logger.warn(
        `HoM restamp marker check failed (run migrations?): ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    await this.runRestamp();
  }

  private async runRestamp(): Promise<void> {
    this.logger.log(
      'Running one-time Head of Marketing permission restamp (current template + known stale-grant cleanup)…',
    );

    try {
      await applyPermissionCatalog(this.sql, {
        log: (message: string) => this.logger.log(message),
        warn: (message: string) => this.logger.warn(message),
        error: (message: string) => this.logger.error(message),
      });
    } catch (err) {
      this.logger.error(
        `HoM restamp aborted: permission catalog sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const [bootstrapActorRow] = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.role, 'SUPER_ADMIN'))
      .limit(1);

    if (!bootstrapActorRow) {
      this.logger.warn('HoM restamp aborted: no SUPER_ADMIN bootstrap actor found.');
      return;
    }

    const bootstrapActor: SessionUser = {
      id: bootstrapActorRow.id,
      email: bootstrapActorRow.email,
      name: bootstrapActorRow.name,
      role: bootstrapActorRow.role,
      logisticsLocationId: null,
      currentBranchId: null,
      permissions: [],
    };

    await this.db
      .update(schema.users)
      .set({ scopeOrgWideHead: false })
      .where(eq(schema.users.role, 'HEAD_OF_MARKETING'));

    const homUsers = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, 'HEAD_OF_MARKETING'));

    let done = 0;
    for (const user of homUsers) {
      await this.usersService.restampPermissions(user.id, bootstrapActor, {
        dropGrantedCodes: STALE_HOM_GRANTED_CODES,
      });
      done++;
      if (done % 50 === 0) {
        this.logger.log(`HoM permission restamp progress: ${done}/${homUsers.length}`);
      }
    }

    if (this.cacheService) {
      await this.cacheService.delPattern('cache:permissions:userMatrix:*');
    }

    await this.db.execute(
      sql`INSERT INTO _yannis_hom_branch_scope_applied (singleton_key) VALUES (1) ON CONFLICT (singleton_key) DO NOTHING`,
    );

    this.logger.log(`HoM permission restamp complete (${done} users).`);
  }
}
