import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { CacheService } from '../common/cache/cache.service';
import { DRIZZLE } from '../database/database.module';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * Cached, user-scoped bundle of facts the API recomputes on every authenticated
 * request: role/template/scope flags, effective permissions, theme + font preferences,
 * and (for non-admin-class users) staff onboarding status.
 *
 * Used by both `/auth/me` and `TrpcMiddleware.resolveSession` to skip 4 Postgres
 * queries per request. Session-scoped fields (currentBranchId, branchIds, mirroredBy,
 * mirrorSessionId) are NEVER stored here — they live on the session blob and are
 * merged on top of the cached bundle by the consumer.
 *
 * Invalidation is explicit: every write path that mutates any field must call
 * `invalidate(userId)`. See CLAUDE.md "Pillar 1" optimization for the list.
 */
export interface UserBundle {
  /** From `users` table (authoritative). */
  role: string;
  roleTemplateId: string | null;
  scopeGlobal: boolean;
  scopeOrgWideHead: boolean;
  scopeTeamSupervisor: boolean;
  /** From `PermissionsService.getEffectivePermissions` (canonical + legacy aliases). */
  permissions: string[];
  /** From `users.app_theme`; null = follow org default. */
  appTheme: string | null;
  /** From `users.font_scale`; null = base. */
  fontScale: string | null;
  /**
   * Staff onboarding status — populated for non-admin-class users only.
   * `undefined` here means "skip this field on the response" (admin-class).
   */
  staffOnboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
  /**
   * Stamped at write time so consumers can cheaply detect admin-class without
   * recomputing — equivalent to `isAdminLevel` of the cached `role` value.
   */
  isAdminLevel: boolean;
}

const KEY_PREFIX = 'cache:auth:userBundle:';
const TTL_SECONDS = 60;
const ADMIN_LEVEL_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

@Injectable()
export class UserBundleCacheService {
  constructor(
    private readonly cache: CacheService,
    private readonly permissions: PermissionsService,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Cache-aside read. Computes the bundle on miss with the same DB queries
   * `/auth/me` previously ran inline.
   */
  async getOrLoad(userId: string): Promise<UserBundle> {
    const key = `${KEY_PREFIX}${userId}`;
    const cached = await this.cache.get<UserBundle>(key);
    if (cached) return cached;

    const bundle = await this.loadFromDb(userId);
    await this.cache.set(key, bundle, TTL_SECONDS);
    return bundle;
  }

  /**
   * Drop the cached bundle for a single user. Safe to call from any write path;
   * cache errors are swallowed by the underlying `CacheService`.
   */
  async invalidate(userId: string): Promise<void> {
    if (!userId) return;
    await this.cache.del(`${KEY_PREFIX}${userId}`);
  }

  /**
   * Drop the cached bundle for many users at once. Used by bulk operations
   * (e.g. `PermissionSnapshotBackfillService.runBackfill`).
   */
  async invalidateMany(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    await Promise.all(userIds.map((id) => this.invalidate(id)));
  }

  /**
   * Nuke every cached bundle. Use sparingly — typical use case is the manual
   * "clear cache" endpoint or an end-of-test teardown.
   */
  async invalidateAll(): Promise<void> {
    await this.cache.delPattern(`${KEY_PREFIX}*`);
  }

  private async loadFromDb(userId: string): Promise<UserBundle> {
    const [dbUser] = await this.db
      .select({
        role: schema.users.role,
        roleTemplateId: schema.users.roleTemplateId,
        scopeGlobal: schema.users.scopeGlobal,
        scopeOrgWideHead: schema.users.scopeOrgWideHead,
        scopeTeamSupervisor: schema.users.scopeTeamSupervisor,
        appTheme: schema.users.appTheme,
        fontScale: schema.users.fontScale,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const role = (dbUser?.role as string | undefined) ?? '';
    const roleTemplateId = dbUser?.roleTemplateId ?? null;
    const scopeGlobal = dbUser?.scopeGlobal ?? false;
    const scopeOrgWideHead = dbUser?.scopeOrgWideHead ?? false;
    const scopeTeamSupervisor = dbUser?.scopeTeamSupervisor ?? false;
    const appTheme = dbUser?.appTheme ?? null;
    const fontScale = dbUser?.fontScale ?? null;
    const isAdminLevel = ADMIN_LEVEL_ROLES.has(role);

    const permsSet = await this.permissions.getEffectivePermissions(userId);
    const permissions = Array.from(permsSet);

    let staffOnboardingStatus: UserBundle['staffOnboardingStatus'];
    if (!isAdminLevel) {
      const [onbRow] = await this.db
        .select({ status: schema.staffOnboarding.status })
        .from(schema.staffOnboarding)
        .where(eq(schema.staffOnboarding.userId, userId))
        .limit(1);
      staffOnboardingStatus = onbRow?.status ?? 'NOT_STARTED';
    }

    const bundle: UserBundle = {
      role,
      roleTemplateId,
      scopeGlobal,
      scopeOrgWideHead,
      scopeTeamSupervisor,
      permissions,
      appTheme,
      fontScale,
      isAdminLevel,
      ...(staffOnboardingStatus !== undefined ? { staffOnboardingStatus } : {}),
    };

    return bundle;
  }
}
