import { Module, Global } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { RedisHealthService } from './redis-health.service';
import { MigrationRunnerService } from './migration-runner.service';
import { PermissionSeedService } from './permission-seed.service';
import { MessageTemplateSeedService } from './message-template-seed.service';
import { DRIZZLE, PG_CLIENT, PG_CLIENT_RAW, REDIS } from './database.tokens';
import { shouldLogHttpRequests } from '../common/http-request-timing';
import { wrapPostgresClientForDbTiming } from './postgres-db-timing-proxy';

export { DRIZZLE, PG_CLIENT, PG_CLIENT_RAW, REDIS } from './database.tokens';

/** Module-level ref to the unwrapped postgres.js client.
 *  Set in PG_CLIENT factory, read by PG_CLIENT_RAW factory. */
let _rawPgClient: ReturnType<typeof postgres> | null = null;

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
        // Cloud SQL / Aiven / most managed Postgres require SSL.
        //
        // ── Pool sizing (`PG_MAX_CONNECTIONS`, default 30) ──────────────────
        // A single dashboard page-load can fan out 15–20 parallel HTTP requests
        // (layout + nested loaders), and each bundled procedure spawns 4–7
        // parallel queries inside `Promise.all`. With `max: 20` the pool was
        // saturating mid-burst — observed in prod logs as `branches.list` and
        // `auth/me` jumping from 1s → 6–9s as later queries queued waiting for
        // a free socket. 30 gives headroom without hitting Cloud SQL's default
        // 100-connection ceiling.
        //
        // **Multi-process deploys** (PM2 cluster, blue/green): set
        // `PG_MAX_CONNECTIONS=10` per process so `processes × 10` stays under
        // the DB's `max_connections` cap. Leave headroom for migrations,
        // backups, and admin `psql` sessions — never run a single instance
        // higher than ~30% of `max_connections`.
        //
        // ── `idle_timeout: 300` (was 10) ────────────────────────────────────
        // A dashboard user clicks → idles 30s → clicks again. With
        // `idle_timeout: 10s` every "click again" paid a fresh TCP+TLS
        // handshake (200–500ms to a remote DB) before the query even started.
        // 5 minutes keeps connections warm across a normal browsing rhythm
        // while still rotating sockets eventually so we don't hold them
        // forever.
        //
        // ── `max_lifetime: 1800` (30 min) ───────────────────────────────────
        // Defence in depth: rotate connections every 30 min so any stale-state
        // issues (server-side prepared statements drifting, mid-flight network
        // blips) self-heal without needing a server restart.
        //
        // ── `connect_timeout: 30` ───────────────────────────────────────────
        // Remote / cold-start DBs sometimes need more than the 10s default.
        //
        // ── `application_name` ──────────────────────────────────────────────
        // Surfaces in `pg_stat_activity` so DBAs can identify the app's
        // connections during incident response without grep-ing IPs.
        const poolMax = parseInt(process.env['PG_MAX_CONNECTIONS'] ?? '30', 10);
        const raw = postgres(connectionString, {
          max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 30,
          idle_timeout: 300,
          max_lifetime: 1800,
          connect_timeout: 30,
          ssl: { rejectUnauthorized: false },
          connection: { application_name: 'yannis-api' },
        });

        // Eager pool warmup. Fires `max` parallel `SELECT 1`s on the raw
        // client at module init so every slot pays its TCP+TLS handshake
        // BEFORE the first user request — not during it. Fire-and-forget so
        // the factory returns immediately; warmup typically finishes in
        // 200–800ms on a remote DB, well before any HTTP traffic arrives.
        // Failures are logged, not thrown — a failed warmup doesn't block
        // boot (the next real query will retry the connection naturally).
        const warmupStart = Date.now();
        Promise.all(
          Array.from({ length: Math.max(1, poolMax) }, () => raw`SELECT 1`),
        )
          .then(() => {
            // eslint-disable-next-line no-console
            console.log(
              `[PgPool] warmed ${poolMax} connections in ${Date.now() - warmupStart}ms`,
            );
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn(
              '[PgPool] warmup failed (non-fatal — first user requests will retry):',
              (err as { message?: string })?.message ?? err,
            );
          });

        // Stash before wrapping so PG_CLIENT_RAW can access it
        _rawPgClient = raw;
        return shouldLogHttpRequests() ? wrapPostgresClientForDbTiming(raw) : raw;
      },
    },
    {
      provide: PG_CLIENT_RAW,
      useFactory: () => {
        if (!_rawPgClient) throw new Error('PG_CLIENT_RAW: raw client not initialized');
        return _rawPgClient;
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
  exports: [DRIZZLE, PG_CLIENT, PG_CLIENT_RAW, REDIS, RedisHealthService],
})
export class DatabaseModule {}
