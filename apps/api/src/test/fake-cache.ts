import type { CacheService } from '../common/cache/cache.service';

/**
 * No-op {@link CacheService} for unit/integration tests: every read misses, so
 * `getOrSet` always runs the factory against the real test DB. Lets services
 * that now depend on `CacheService` (e.g. `BranchTeamsService`) be constructed
 * in tests without a live Redis.
 */
export function createFakeCacheService(): CacheService {
  return {
    get: async () => null,
    set: async () => {},
    del: async () => {},
    delPattern: async () => {},
    getOrSet: async <T>(_key: string, _ttl: number, factory: () => Promise<T>) => factory(),
  } as unknown as CacheService;
}
