import { Module, Global } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import Redis from 'ioredis';
import { db as schema } from '@yannis/shared';

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_CLIENT = Symbol('PG_CLIENT');
export const REDIS = Symbol('REDIS');

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
        // Aiven and most cloud Postgres require SSL
        // Keep pool small — managed Postgres (Neon, Supabase, Aiven) often limits to 10–20 connections
        return postgres(connectionString, {
          max: 5,
          idle_timeout: 20,
          connect_timeout: 10,
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
        const redisUrl = process.env['REDIS_URL'];
        if (!redisUrl) {
          throw new Error('REDIS_URL environment variable is required');
        }
        return new Redis(redisUrl);
      },
    },
  ],
  exports: [DRIZZLE, PG_CLIENT, REDIS],
})
export class DatabaseModule {}
