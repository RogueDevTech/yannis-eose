import { Injectable, Inject } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { UserRole } from '@yannis/shared';
import { canonicalPermissionCode, legacyAliasesForCanonical } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';

/** Roles that HR cannot assign directly — require SuperAdmin approval */
export const SENSITIVE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'] as const;

/** Permissions that HR cannot grant directly — require SuperAdmin approval */
export const SENSITIVE_PERMISSIONS = [
  'finance.costs.view',
  'finance.approvals.manage',
  'finance.disbursements.manage',
  'users.staff.create',
  'users.staff.update',
  'users.staff.deactivate',
  'audit.logs.view',
  'settings.system.manage',
  'hr.adjustments.approve',
  'finance.materialized_views.initialize',
  'dashboard.ceo.view',
  'rbac.templates.manage',
  'mirror.any.manage',
  'notifications.broadcast.manage',
  'branches.scope.global',
  'branches.admin.manage',
] as const;

/**
 * RBAC doc effective set: template ∪ legacy `role_permissions` ∪ stamped grants − revokes.
 * Used for admin UI previews and backfills; callable from routers without DI.
 */
export async function computeEffectivePermissionsLegacyUnion(
  dbOrTx: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<Set<string>> {
  const [userRow] = await dbOrTx
    .select({
      role: schema.users.role,
      roleTemplateId: schema.users.roleTemplateId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!userRow) return new Set();
  if ((userRow.role as string) === 'SUPER_ADMIN') {
    const all = await dbOrTx.select({ code: schema.permissions.code }).from(schema.permissions);
    const effective = new Set<string>();
    for (const row of all) {
      const canonical = canonicalPermissionCode(row.code);
      effective.add(canonical);
      for (const legacy of legacyAliasesForCanonical(canonical)) effective.add(legacy);
    }
    return effective;
  }

  const userRole = userRow.role as string;

  let templateId = userRow.roleTemplateId;
  if (!templateId && userRole) {
    const [fallback] = await dbOrTx
      .select({ id: schema.roleTemplates.id })
      .from(schema.roleTemplates)
      .where(
        and(
          eq(schema.roleTemplates.mappedRole, userRole as UserRole),
          eq(schema.roleTemplates.kind, 'SYSTEM'),
          isNull(schema.roleTemplates.validTo),
        ),
      )
      .limit(1);
    templateId = fallback?.id ?? null;
  }

  const templatePermRows = templateId
    ? await dbOrTx
        .select({ code: schema.permissions.code })
        .from(schema.roleTemplatePermissions)
        .innerJoin(schema.permissions, eq(schema.roleTemplatePermissions.permissionId, schema.permissions.id))
        .where(
          and(
            eq(schema.roleTemplatePermissions.roleTemplateId, templateId),
            isNull(schema.roleTemplatePermissions.validTo),
            isNull(schema.permissions.validTo),
          ),
        )
    : [];

  const legacyRolePermRows = await dbOrTx
    .select({ code: schema.permissions.code })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
    .where(
      and(
        eq(schema.rolePermissions.role, userRole as UserRole),
        isNull(schema.permissions.validTo),
      ),
    );

  const userPermRows = await dbOrTx
    .select({
      code: schema.permissions.code,
      granted: schema.userPermissions.granted,
    })
    .from(schema.userPermissions)
    .innerJoin(schema.permissions, eq(schema.userPermissions.permissionId, schema.permissions.id))
    .where(and(eq(schema.userPermissions.userId, userId), isNull(schema.userPermissions.validTo)));

  const rolePerms = new Set([
    ...templatePermRows.map((r) => canonicalPermissionCode(r.code)),
    ...legacyRolePermRows.map((r) => canonicalPermissionCode(r.code)),
  ]);
  const grants = new Set(
    userPermRows.filter((r) => r.granted).map((r) => canonicalPermissionCode(r.code)),
  );
  const revokes = new Set(
    userPermRows.filter((r) => !r.granted).map((r) => canonicalPermissionCode(r.code)),
  );

  const effective = new Set([...rolePerms, ...grants]);
  for (const r of revokes) {
    effective.delete(r);
  }
  for (const canonical of [...effective]) {
    for (const legacy of legacyAliasesForCanonical(canonical)) effective.add(legacy);
  }
  return effective;
}

@Injectable()
export class PermissionsService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Get effective permissions for a user (runtime source of truth).
   * - SUPER_ADMIN: full catalog (+ legacy aliases)
   * - Everyone else: **stamped** `user_permissions` grants − revokes (+ legacy aliases).
   *   Templates and `role_permissions` are used only at create/update to pre-fill and stamp rows.
   */
  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    const [userRow] = await this.db
      .select({
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!userRow) return new Set();
    if ((userRow.role as string) === 'SUPER_ADMIN') {
      const all = await this.db.select({ code: schema.permissions.code }).from(schema.permissions);
      const effective = new Set<string>();
      for (const row of all) {
        const canonical = canonicalPermissionCode(row.code);
        effective.add(canonical);
        for (const legacy of legacyAliasesForCanonical(canonical)) effective.add(legacy);
      }
      return effective;
    }

    const userPermRows = await this.db
      .select({
        code: schema.permissions.code,
        granted: schema.userPermissions.granted,
      })
      .from(schema.userPermissions)
      .innerJoin(schema.permissions, eq(schema.userPermissions.permissionId, schema.permissions.id))
      .where(and(eq(schema.userPermissions.userId, userId), isNull(schema.userPermissions.validTo)));

    const grants = new Set(
      userPermRows.filter((r) => r.granted).map((r) => canonicalPermissionCode(r.code)),
    );
    const revokes = new Set(
      userPermRows.filter((r) => !r.granted).map((r) => canonicalPermissionCode(r.code)),
    );

    const effective = new Set(grants);
    for (const r of revokes) {
      effective.delete(r);
    }
    for (const canonical of [...effective]) {
      for (const legacy of legacyAliasesForCanonical(canonical)) effective.add(legacy);
    }
    return effective;
  }

  /**
   * One-time backfill: legacy union used before the permission snapshot cutover
   * (template ∪ role_permissions ∪ user rows − revokes).
   */
  async getEffectivePermissionsLegacyUnion(userId: string): Promise<Set<string>> {
    return computeEffectivePermissionsLegacyUnion(this.db, userId);
  }

  /**
   * Check if user has a permission. SUPER_ADMIN always returns true.
   */
  async hasPermission(userId: string, role: string, permissionCode: string): Promise<boolean> {
    if (role === 'SUPER_ADMIN') return true;
    const perms = await this.getEffectivePermissions(userId);
    return perms.has(canonicalPermissionCode(permissionCode));
  }

  /** Check if a role is sensitive (requires SuperAdmin approval when HR assigns) */
  isSensitiveRole(role: string): boolean {
    return (SENSITIVE_ROLES as readonly string[]).includes(role);
  }

  /** Check if a permission code is sensitive (requires SuperAdmin approval when HR grants) */
  isSensitivePermission(code: string): boolean {
    return (SENSITIVE_PERMISSIONS as readonly string[]).includes(canonicalPermissionCode(code));
  }

  /** Check if HR can assign this role/permission directly without approval */
  canHRAssignDirectly(value: string, type: 'role' | 'permission'): boolean {
    if (type === 'role') return !this.isSensitiveRole(value);
    return !this.isSensitivePermission(value);
  }
}
