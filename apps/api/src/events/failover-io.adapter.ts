import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { ServerOptions } from 'socket.io';
import Redis, { type RedisOptions } from 'ioredis';
import { RedisHealthService } from '../database/redis-health.service';

/** ioredis options compatible with @socket.io/redis-adapter (Bull-style: no max retry cap per op). */
const SOCKET_IO_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
};

function waitRedisReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const cleanup = () => {
      client.off('ready', onReady);
      client.off('error', onError);
    };
    client.once('ready', onReady);
    client.once('error', onError);
  });
}

export class FailoverIoAdapter extends IoAdapter {
  private readonly logger = new Logger(FailoverIoAdapter.name);
  private readonly redisUrl: string | null;
  private readonly failoverEnabled: boolean;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  /** Prevents concurrent attachClustered (e.g. isHealthy + onStateChange both firing). */
  private clusterAttachInFlight = false;
  private mode: 'local' | 'clustered' = 'local';
  // In-memory adapter ctor captured at bootstrap (see socket.io `adapter.constructor`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private defaultAdapterCtor: any;

  constructor(
    app: INestApplicationContext,
    private readonly redisHealth: RedisHealthService,
  ) {
    super(app);
    this.redisUrl = process.env['REDIS_URL'] ?? null;
    this.failoverEnabled = (process.env['REDIS_FAILOVER_ENABLED'] ?? 'true') === 'true';
  }

  private createPubSubPair(): void {
    if (!this.redisUrl) return;
    this.disposePubSubPair();
    this.pubClient = new Redis(this.redisUrl, SOCKET_IO_REDIS_OPTIONS);
    // Official @socket.io/redis-adapter pattern: duplicate() opens a second TCP connection
    // with the same options. Two unrelated `new Redis(url)` instances can race with
    // createAdapter() before either is `ready`, which surfaces as subscriber-mode errors.
    this.subClient = this.pubClient.duplicate();
    this.pubClient.on('error', (err) => this.logger.error(`socket_pub_redis_error ${err.message}`));
    this.subClient.on('error', (err) => this.logger.error(`socket_sub_redis_error ${err.message}`));
  }

  private disposePubSubPair(): void {
    try {
      this.subClient?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      this.pubClient?.disconnect();
    } catch {
      /* ignore */
    }
    this.subClient = null;
    this.pubClient = null;
  }

  private async attachClustered(io: Server): Promise<void> {
    if (this.clusterAttachInFlight || this.mode === 'clustered' || !this.redisUrl) return;
    this.clusterAttachInFlight = true;
    try {
      if (!this.pubClient || !this.subClient) {
        this.createPubSubPair();
      }
      if (!this.pubClient || !this.subClient) return;

      try {
        await Promise.all([waitRedisReady(this.pubClient), waitRedisReady(this.subClient)]);
      } catch (err) {
        this.logger.error(
          `socket_cluster_redis_not_ready ${err instanceof Error ? err.message : String(err)}`,
        );
        this.disposePubSubPair();
        return;
      }

      io.adapter(createAdapter(this.pubClient, this.subClient));
      this.mode = 'clustered';
      this.logger.warn('socket_adapter_mode=clustered');
    } finally {
      this.clusterAttachInFlight = false;
    }
  }

  private detachClustered(io: Server): void {
    if (this.mode !== 'clustered') return;
    io.adapter(this.defaultAdapterCtor);
    this.mode = 'local';
    this.logger.warn('socket_adapter_mode=local reason=redis_unhealthy');
    // Drop Redis clients so we never reuse a connection left in SUBSCRIBE mode by the old adapter.
    this.disposePubSubPair();
  }

  override createIOServer(port: number, options?: ServerOptions): any {
    const io = super.createIOServer(port, options) as Server;

    this.defaultAdapterCtor = io.of('/').adapter.constructor;
    io.adapter(this.defaultAdapterCtor);
    this.mode = 'local';
    this.logger.warn('socket_adapter_mode=local reason=bootstrap');

    if (!this.failoverEnabled || !this.redisUrl) return io;

    this.createPubSubPair();

    this.redisHealth.onStateChange((state) => {
      if (state === 'healthy' && this.mode !== 'clustered') {
        void this.attachClustered(io).catch((err) =>
          this.logger.error(
            `socket_cluster_attach_failed ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      } else if (state !== 'healthy' && this.mode !== 'local') {
        this.detachClustered(io);
        if (this.redisUrl) {
          this.createPubSubPair();
        }
      }
    });

    if (this.redisHealth.isHealthy()) {
      void this.attachClustered(io).catch((err) =>
        this.logger.error(
          `socket_cluster_attach_failed ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    return io;
  }
}
