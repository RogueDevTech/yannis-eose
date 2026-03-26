import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from './database.module';

export type RedisHealthState = 'healthy' | 'degraded' | 'recovering';
type RedisHealthListener = (state: RedisHealthState) => void;

@Injectable()
export class RedisHealthService implements OnModuleInit {
  private readonly logger = new Logger(RedisHealthService.name);
  private state: RedisHealthState = 'recovering';
  private readonly listeners = new Set<RedisHealthListener>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit(): void {
    this.setState(this.redis.status === 'ready' ? 'healthy' : 'recovering');

    this.redis.on('ready', () => this.setState('healthy'));
    this.redis.on('connect', () => {
      if (this.state !== 'healthy') this.setState('recovering');
    });
    this.redis.on('reconnecting', () => this.setState('recovering'));
    this.redis.on('close', () => this.setState('degraded'));
    this.redis.on('end', () => this.setState('degraded'));
    this.redis.on('error', () => {
      if (this.state !== 'healthy') this.setState('degraded');
    });
  }

  getState(): RedisHealthState {
    return this.state;
  }

  isHealthy(): boolean {
    return this.state === 'healthy';
  }

  onStateChange(listener: RedisHealthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(next: RedisHealthState): void {
    if (this.state === next) return;
    this.state = next;
    this.logger.warn(`redis_state=${next}`);
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
