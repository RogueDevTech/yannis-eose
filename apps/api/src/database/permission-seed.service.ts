import { Injectable, Inject, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type postgres from 'postgres';
// Deep relative import — webpack uses classic node moduleResolution which
// doesn't honour the `exports` map subpaths in package.json. Same pattern as
// `migration-runner.service.ts`. The runner is also barrelled in
// `@yannis/shared` (its only runtime imports are pure data + a type-only
// import from postgres) but importing deeply keeps both consumers consistent.
import { applyPermissionCatalog } from '../../../../packages/shared/src/rbac/seed-runner';
import { PG_CLIENT } from './database.tokens';

/**
 * Auto-seed RBAC permissions on application bootstrap.
 *
 * Background: the standalone `pnpm db:seed-permissions` CLI is fragile in
 * deploy contexts (the operator's IP must be in Aiven's allowlist; people
 * forget to run it after a release that adds new permission codes). Running
 * the same logic on every API boot guarantees the catalog stays in sync with
 * source code — exactly like migrations.
 *
 * Idempotent. Failures log a warning but do NOT abort startup — a partial
 * sync is better than a refusal-to-boot, and the previous catalog still works
 * for any endpoints that already had grants. (Migrations DO abort on failure;
 * the schema must be correct. The seed is data-level and softer.)
 *
 * **Non-blocking by default.** The catalog sync runs in the background after
 * the listener opens — we kick it off from `onApplicationBootstrap` but do
 * NOT `await` it. A successful sync converges the catalog typically within a
 * few hundred ms (with the bulk-insert seed runner); a slow / hanging sync
 * doesn't keep the HTTP listener offline. Set `PERMISSION_SEED_BLOCKING=true`
 * to await the sync (e.g. for tests that need the catalog populated before
 * making requests).
 */
@Injectable()
export class PermissionSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSeedService.name);

  constructor(@Inject(PG_CLIENT) private readonly sql: ReturnType<typeof postgres>) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env['PERMISSION_SEED_AUTORUN'] === 'false') {
      this.logger.log('PERMISSION_SEED_AUTORUN=false — skipping RBAC catalog sync.');
      return;
    }

    const blocking = process.env['PERMISSION_SEED_BLOCKING'] === 'true';
    const work = this.runSync();
    if (blocking) {
      await work;
      return;
    }
    // Fire-and-forget. Errors are logged inside runSync() — no unhandled rejections.
    void work;
  }

  private async runSync(): Promise<void> {
    const startedAt = Date.now();
    try {
      this.logger.log('Syncing RBAC permission catalog (in background)…');
      const result = await applyPermissionCatalog(this.sql, {
        log: (m: string) => this.logger.log(m),
        warn: (m: string) => this.logger.warn(m),
        error: (m: string) => this.logger.error(m),
      });
      const ms = Date.now() - startedAt;
      this.logger.log(
        `RBAC catalog in sync in ${ms}ms (${result.permsTotal} permission codes; ${result.rolePermsInserted} role assignments added, ${result.rolePermsRevoked} revoked, ${result.usersRestamped} user snapshots restamped).`,
      );
    } catch (err) {
      // Soft fail — log + continue boot. Existing grants still work.
      this.logger.error(
        `RBAC catalog sync failed: ${err instanceof Error ? err.message : String(err)}. ` +
          'API will continue with the previous catalog. Set PERMISSION_SEED_AUTORUN=false to silence this warning if intentional.',
      );
    }
  }
}
