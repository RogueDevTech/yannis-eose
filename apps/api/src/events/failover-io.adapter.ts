import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import Redis from 'ioredis';
import { RedisHealthService } from '../database/redis-health.service';

export class FailoverIoAdapter extends IoAdapter {
  private readonly logger = new Logger(FailoverIoAdapter.name);
  private readonly redisUrl: string | null;
  private readonly failoverEnabled: boolean;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private mode: 'local' | 'clustered' = 'local';
  private defaultAdapterCtor: any;

  constructor(
    app: INestApplicationContext,
    private readonly redisHealth: RedisHealthService,
  ) {
    super(app);
    this.redisUrl = process.env['REDIS_URL'] ?? null;
    this.failoverEnabled = (process.env['REDIS_FAILOVER_ENABLED'] ?? 'true') === 'true';
  }

  override createIOServer(port: number, options?: ServerOptions): any {
    const io = super.createIOServer(port, options);

    // Always boot in local mode first; upgrade to clustered when Redis is healthy.
    this.defaultAdapterCtor = io.of('/').adapter.constructor;
    io.adapter(this.defaultAdapterCtor);
    this.mode = 'local';
    this.logger.warn('socket_adapter_mode=local reason=bootstrap');

    if (!this.failoverEnabled || !this.redisUrl) return io;

    this.pubClient = new Redis(this.redisUrl);
    this.subClient = this.pubClient.duplicate();

    this.redisHealth.onStateChange((state) => {
      if (state === 'healthy' && this.mode !== 'clustered') {
        io.adapter(createAdapter(this.pubClient!, this.subClient!));
        this.mode = 'clustered';
        this.logger.warn('socket_adapter_mode=clustered');
      } else if (state !== 'healthy' && this.mode !== 'local') {
        io.adapter(this.defaultAdapterCtor);
        this.mode = 'local';
        this.logger.warn(`socket_adapter_mode=local reason=redis_${state}`);
      }
    });

    return io;
  }
}
