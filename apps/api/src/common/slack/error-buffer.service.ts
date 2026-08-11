import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../database/database.module';
import { nigeriaCalendarDate } from '../utils/date-range';
import type { DailyReportErrorGroup } from './templates/daily-report.template';

const KEY_PREFIX = 'slack:error-digest';
const MAX_TRACKED_PATHS = 200;
// Two full Nigeria days — long enough for the 8pm cron to always read the
// day it's reporting on, short enough that stale digests self-expire.
const TTL_SECONDS = 60 * 60 * 48;

@Injectable()
export class SlackErrorBufferService {
  private readonly logger = new Logger(SlackErrorBufferService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private countKey(day: string): string {
    return `${KEY_PREFIX}:${day}:count`;
  }

  private messageKey(day: string): string {
    return `${KEY_PREFIX}:${day}:message`;
  }

  /**
   * Fire-and-forget: called from the synchronous tRPC onError hook. Never
   * awaited by the caller and never throws — a Redis blip must not affect
   * request handling or double-log.
   */
  record(path: string, message: string): void {
    void this.persist(path, message);
  }

  private async persist(path: string, message: string): Promise<void> {
    try {
      const day = nigeriaCalendarDate();
      const countKey = this.countKey(day);
      const messageKey = this.messageKey(day);

      const isNewPath = (await this.redis.hexists(countKey, path)) === 0;
      if (isNewPath && (await this.redis.hlen(countKey)) >= MAX_TRACKED_PATHS) {
        return;
      }

      await this.redis.hincrby(countKey, path, 1);
      await this.redis.hset(messageKey, path, message.slice(0, 500));
      await this.redis.expire(countKey, TTL_SECONDS);
      await this.redis.expire(messageKey, TTL_SECONDS);
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`error-digest persist failed: ${err.message}`);
    }
  }

  async snapshot(day: string = nigeriaCalendarDate()): Promise<{
    total: number;
    groups: DailyReportErrorGroup[];
  }> {
    try {
      const [counts, messages] = await Promise.all([
        this.redis.hgetall(this.countKey(day)),
        this.redis.hgetall(this.messageKey(day)),
      ]);
      const groups: DailyReportErrorGroup[] = Object.entries(counts)
        .map(([path, count]) => ({
          path,
          count: Number(count),
          lastMessage: messages[path] ?? '',
        }))
        .sort((a, b) => b.count - a.count);
      const total = groups.reduce((sum, g) => sum + g.count, 0);
      return { total, groups };
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`error-digest snapshot failed: ${err.message}`);
      return { total: 0, groups: [] };
    }
  }

  async reset(day: string = nigeriaCalendarDate()): Promise<void> {
    try {
      await this.redis.del(this.countKey(day), this.messageKey(day));
    } catch (error) {
      const err = error as Error;
      this.logger.warn(`error-digest reset failed: ${err.message}`);
    }
  }
}
