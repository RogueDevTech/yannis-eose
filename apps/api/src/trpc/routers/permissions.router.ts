import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { canonicalPermissionCode, legacyAliasesForCanonical } from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { SessionUser } from '../../common/decorators/current-user.decorator';
import { router, permissionProcedure, authedProcedure } from '../trpc';
import { resolveRoleTemplateBaselineCodes } from '../../permissions/role-template-baseline';
import { computeEffectivePermissionsLegacyUnion } from '../../permissions/permissions.service';

/** Staff UI for someone else's matrix — or self-service profile (`/admin/profile`). */
function actorMayViewUserPermissionMatrix(actor: SessionUser, targetUserId: string): boolean {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN') return true;
  if (actor.id === targetUserId) return true;
  const required = ['users.staff.view', 'users.staff.update', 'rbac.templates.manage'].map((c) =>
    canonicalPermissionCode(c),
  );
  const perms = new Set((actor.permissions ?? []).map((c) => canonicalPermissionCode(c)));
  return required.some((c) => perms.has(c));
}

let permissionsDbInstance: PostgresJsDatabase<typeof schema> | null = null;

export function setPermissionsDb(db: PostgresJsDatabase<typeof schema>) {
  permissionsDbInstance = db;
}

function db(): PostgresJsDatabase<typeof schema> {
  if (!permissionsDbInstance) {
    throw new Error('Permissions db not initialized. Call setPermissionsDb() from TrpcModule.');
  }
  return permissionsDbInstance;
}

/**
 * In-memory TTL cache for `listCatalog`. The catalog is read-only at runtime
 * (only `PermissionSeedService` writes to it on boot, and that's idempotent),
 * so caching for 60s is safe — at worst, a freshly-added permission code is
 * invisible to callers for one minute. Sub-millisecond hits replace the
 * 100-300ms DB roundtrip and prevent the connection pool exhaustion that
 * caused 504 timeouts on `/hr/users/:id` (8+ parallel loader requests × 3
 * DB queries each saturated the pool faster than connections drained).
 */
type CatalogShape = {
  permissions: Array<{
    code: string;
    resource: string;
    action: string;
    description: string | null;
    legacyAliases: string[];
  }>;
  grouped: Record<string, CatalogShape['permissions']>;
};

let catalogCache: { value: CatalogShape; expiresAt: number } | null = null;
const CATALOG_CACHE_TTL_MS = 60_000;

/** Exported so test harnesses + admin "sync now" flows can force a refresh. */
export function invalidatePermissionCatalogCache(): void {
  catalogCache = null;
}

export const permissionsRouter = router({
  listCodes: permissionProcedure('rbac.templates.manage').query(async () => {
    const rows = await db()
      .select({
        code: schema.permissions.code,
        resource: schema.permissions.resource,
        action: schema.permissions.action,
        description: schema.permissions.description,
      })
      .from(schema.permissions)
      .where(isNull(schema.permissions.validTo))
      .orderBy(asc(schema.permissions.code));
    return {
      permissions: rows.map((row) => ({ ...row, code: canonicalPermissionCode(row.code) })),
    };
  }),

  /**
   * Permission definitions (code + description) — any logged-in user may read this
   * to render "My permissions" on `/admin/profile` without holding `users.staff.view`.
   */
  listCatalog: authedProcedure.query(
    async () => {
      const now = Date.now();
      if (catalogCache && catalogCache.expiresAt > now) {
        return catalogCache.value;
      }

      const rows = await db()
        .select({
          code: schema.permissions.code,
          resource: schema.permissions.resource,
          action: schema.permissions.action,
          description: schema.permissions.description,
        })
        .from(schema.permissions)
        .where(isNull(schema.permissions.validTo))
        .orderBy(asc(schema.permissions.code));

      const normalizedRows = rows.map((row) => {
        const code = canonicalPermissionCode(row.code);
        return {
          ...row,
          code,
          legacyAliases: legacyAliasesForCanonical(code),
        };
      });
      const grouped = normalizedRows.reduce<Record<string, typeof normalizedRows>>((acc, row) => {
        const domain = row.code.split('.')[0] ?? 'other';
        acc[domain] ??= [];
        acc[domain].push(row);
        return acc;
      }, {});

      const value: CatalogShape = { permissions: normalizedRows, grouped };
      catalogCache = { value, expiresAt: now + CATALOG_CACHE_TTL_MS };
      return value;
    }),

  listTemplateBaselines: permissionProcedure(
    'users.staff.create',
    'users.staff.update',
    'users.staff.view',
    'rbac.templates.manage',
  ).query(
    async () => {
      const templates = await db()
        .select({
          id: schema.roleTemplates.id,
          key: schema.roleTemplates.key,
          name: schema.roleTemplates.name,
          kind: schema.roleTemplates.kind,
          mappedRole: schema.roleTemplates.mappedRole,
          locked: schema.roleTemplates.locked,
        })
        .from(schema.roleTemplates)
        .where(and(isNull(schema.roleTemplates.validTo), eq(schema.roleTemplates.status, 'ACTIVE')))
        .orderBy(asc(schema.roleTemplates.name));

      const rows = await db()
        .select({
          templateId: schema.roleTemplatePermissions.roleTemplateId,
          code: schema.permissions.code,
        })
        .from(schema.roleTemplatePermissions)
        .innerJoin(schema.permissions, eq(schema.roleTemplatePermissions.permissionId, schema.permissions.id))
        .where(
          and(isNull(schema.roleTemplatePermissions.validTo), isNull(schema.permissions.validTo)),
        );

      const byTemplateId = rows.reduce<Record<string, string[]>>((acc, row) => {
        const bucket = acc[row.templateId] ?? [];
        bucket.push(canonicalPermissionCode(row.code));
        acc[row.templateId] = bucket;
        return acc;
      }, {});

      return { templates, byTemplateId };
    },
  ),

  getUserMatrix: authedProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        /**
         * `stamp_preview` — Overview: sparse overrides + template baseline; `effectiveCodes` is the
         * RBAC union (template ∪ `role_permissions` ∪ stamped grants − revokes) for chip display.
         * `edit_matrix` — Settings PermissionMatrix editor payload (same shape).
         */
        intent: z.enum(['stamp_preview', 'edit_matrix']).default('edit_matrix'),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!actorMayViewUserPermissionMatrix(ctx.user, input.userId)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "You do not have access to this user's permission matrix.",
        });
      }
      const [user] = await db()
        .select({
          id: schema.users.id,
          role: schema.users.role,
          roleTemplateId: schema.users.roleTemplateId,
        })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId))
        .limit(1);

      if (!user) {
        return {
          role: null,
          roleTemplateId: null,
          userOverrides: {} as Record<string, boolean>,
          templateCodes: [] as string[],
          effectiveCodes: [] as string[],
        };
      }

      const overrideRows = await db()
        .select({
          code: schema.permissions.code,
          granted: schema.userPermissions.granted,
        })
        .from(schema.userPermissions)
        .innerJoin(schema.permissions, eq(schema.userPermissions.permissionId, schema.permissions.id))
        .where(and(eq(schema.userPermissions.userId, input.userId), isNull(schema.userPermissions.validTo)));

      // Shared: resolve template + sparse stamped deltas (`override ?? template default`).
      let templateId: string | null = user.roleTemplateId;
      if (!templateId && user.role) {
        const [fallback] = await db()
          .select({ id: schema.roleTemplates.id })
          .from(schema.roleTemplates)
          .where(
            and(
              eq(schema.roleTemplates.mappedRole, user.role),
              eq(schema.roleTemplates.kind, 'SYSTEM'),
              isNull(schema.roleTemplates.validTo),
            ),
          )
          .limit(1);
        templateId = fallback?.id ?? null;
      }
      const templateCodesCanon = await resolveRoleTemplateBaselineCodes(
        db(),
        templateId,
        user.role ?? '',
      );
      const templateSet = new Set(templateCodesCanon);

      /** Sparse deltas — explicit grants off-template + explicit revokes on-template. */
      const userOverrides: Record<string, boolean> = {};
      for (const row of overrideRows) {
        const code = canonicalPermissionCode(row.code);
        const inTpl = templateSet.has(code);
        if (row.granted) {
          if (!inTpl) userOverrides[code] = true;
        } else if (inTpl) {
          userOverrides[code] = false;
        }
      }

      const legacyUnion = await computeEffectivePermissionsLegacyUnion(db(), input.userId);
      const effectiveCodes = [...new Set([...legacyUnion].map((c) => canonicalPermissionCode(c)))].sort((a, b) =>
        a.localeCompare(b),
      );

      return {
        role: user.role,
        roleTemplateId: user.roleTemplateId,
        userOverrides,
        templateCodes: templateCodesCanon,
        effectiveCodes,
      };
    }),
});
