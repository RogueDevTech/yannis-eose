import { Module, Global } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { RedisHealthService } from './redis-health.service';
import { DRIZZLE, PG_CLIENT, REDIS } from './database.tokens';

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
        // Keep the pool small — managed Postgres tiers commonly cap at 22 connections, and
        // PG_MAX_CONNECTIONS in production has actually been hit (error 53300, "remaining
        // connection slots are reserved for roles with the SUPERUSER attribute"). At max=3
        // with idle_timeout=10, even four parallel processes (PM2/cluster, deploy overlap,
        // a stale orphan) stay inside ~12 active slots, leaving headroom for migrations,
        // backups, and admin psql sessions. Tune up only after a connection pooler
        // (PgBouncer / Aiven pooler) is in front; tune down further only if traffic is tiny.
        // connect_timeout 30s: remote/cold-start DBs often need more than 10s.
        return postgres(connectionString, {
          max: 3,
          idle_timeout: 10,
          connect_timeout: 30,
          ssl: { rejectUnauthorized: false },
        });
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
  ],
  exports: [DRIZZLE, PG_CLIENT, REDIS, RedisHealthService],
})
export class DatabaseModule {}
