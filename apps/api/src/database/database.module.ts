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
        const connectionString = process.env['DATABASE_URL'];
        if (!connectionString) {
          throw new Error('DATABASE_URL environment variable is required');
        }
        return postgres(connectionString, { max: 10 });
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
