import { Module, Global } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { RedisHealthService } from './redis-health.service';
import { MigrationRunnerService } from './migration-runner.service';
import { PermissionSeedService } from './permission-seed.service';
import { MessageTemplateSeedService } from './message-template-seed.service';
import { DRIZZLE, PG_CLIENT, REDIS } from './database.tokens';
import { shouldLogHttpRequests } from '../common/http-request-timing';
import { wrapPostgresClientForDbTiming } from './postgres-db-timing-proxy';

export { DRIZZLE, PG_CLIENT, REDIS } from './database.tokens';

@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      useFactory: () => {
        let connectionString = process.env['DATABASE_URL'];
        if (!connectionString) {
          throw new Error('DATABASE_URL environment variable is required');
        }
        // Strip Aiven UI params (statusColor, tLSMode, etc.) — Postgres rejects them
        const aivenParams = [
          'statusColor',
          'env',
          'name',
          'tLSMode',
          'usePrivateKey',
          'safeModeLevel',
          'advancedSafeModeLevel',
          'driverVersion',
          'lazyload',
        ];
        try {
          const url = new URL(connectionString.replace(/^postgresql:/, 'https:'));
          aivenParams.forEach((p) => url.searchParams.delete(p));
          connectionString = url.toString().replace(/^https:/, 'postgresql:');
        } catch {
          // If URL parse fails, use as-is
        }
        // Aiven and most cloud Postgres require SSL.
        //
        // Pool sizing: env-driven (`PG_MAX_CONNECTIONS`), default 10 — fine
        // for a single dev process AND comfortably inside Aiven's 22-slot cap
        // for a single production replica. **In multi-process production
        // deploys (PM2 cluster, blue/green) set `PG_MAX_CONNECTIONS=3` so
        // N processes × 3 stays under the 22 cap with headroom for migrations,
        // backups, and admin psql sessions.** Previous default of 3 was
        // tuned for 4 parallel processes (12 active slots) but starved
        // single-process dev where a single page load fires 8+ parallel
        // tRPC calls × 3 DB queries each — the queue overflowed the 4.7s
        // loader timeout (504 errors on `permissions.listCatalog`).
        //
        // connect_timeout 30s: remote/cold-start DBs often need more than 10s.
        //
        // 2026-05 bump: 10 → 20. The `max: 10` ceiling was queuing requests during
        // normal multi-user load (one person clicking around + the materialized-view
        // refresh cron + a background notification fan-out is enough to fill 10 slots
        // and start serializing). Cloud SQL handles 50–100 connections per instance
        // comfortably, so 20 is conservative. Override via PG_MAX_CONNECTIONS if
        // you need more (or less) at deploy time.
        const poolMax = parseInt(process.env['PG_MAX_CONNECTIONS'] ?? '20', 10);
        const raw = postgres(connectionString, {
          max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 20,
          idle_timeout: 10,
          connect_timeout: 30,
          ssl: { rejectUnauthorized: false },
        });
        return shouldLogHttpRequests() ? wrapPostgresClientForDbTiming(raw) : raw;
      },
    },
    {
      provide: DRIZZLE,
      useFactory: (pgClient: ReturnType<typeof postgres>) => {
        return drizzle(pgClient, { schema });
      },
      inject: [PG_CLIENT],
    },
    {
      provide: REDIS,
      useFactory: () => {
        const envRedisUrl = process.env['REDIS_URL'];
        const redisUrl =
          envRedisUrl ?? (process.env['NODE_ENV'] === 'development' ? 'redis://127.0.0.1:6379' : undefined);
        if (!redisUrl) {
          throw new Error('REDIS_URL environment variable is required');
        }
        return new Redis(redisUrl);
      },
    },
    RedisHealthService,
    // Auto-runs pending SQL migrations on application bootstrap. Failure to
    // migrate aborts startup, which fails the docker health check, which
    // fails the deploy. See migration-runner.service.ts for the contract.
    MigrationRunnerService,
    // Auto-syncs the RBAC permission catalog (codes, role grants, SYSTEM
    // templates) on bootstrap. Soft-fails: a stale catalog still serves the
    // old grants. Skip with PERMISSION_SEED_AUTORUN=false. See
    // permission-seed.service.ts.
    PermissionSeedService,
    // Auto-seeds the 5 default CS message templates (SMS / WhatsApp / WhatsApp
    // Group) on bootstrap. Idempotent — keys off `name` + `branch_id IS NULL`.
    // Skip with MESSAGE_TEMPLATE_SEED_AUTORUN=false. See message-template-seed.service.ts.
    MessageTemplateSeedService,
  ],
  exports: [DRIZZLE, PG_CLIENT, REDIS, RedisHealthService],
})
export class DatabaseModule {}
