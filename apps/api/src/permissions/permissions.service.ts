import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { UserRole } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';

/** Roles that HR cannot assign directly — require SuperAdmin approval */
export const SENSITIVE_ROLES = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'] as const;

/** Permissions that HR cannot grant directly — require SuperAdmin approval */
export const SENSITIVE_PERMISSIONS = [
  'finance.costView',
  'finance.approve',
  'finance.disburse',
  'users.create',
  'users.update',
  'users.deactivate',
  'audit.read',
  'settings.write',
  'hr.approveAdjustment',
  'finance.initMaterializedViews',
  'ceo.overview',
] as const;

@Injectable()
export class PermissionsService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Get effective permissions for a user.
   * SUPER_ADMIN and ADMIN bypass all checks at the procedure level — this returns empty set
   * for them since we never need to check. For other roles: role_permissions ∪ user grants − user revokes.
   */
  async getEffectivePermissions(userId: string, role: string): Promise<Set<string>> {
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      return new Set();
    }

    const [userRow] = await this.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!userRow) return new Set();

    const userRole = userRow.role as string;

    const rolePermRows = await this.db
      .select({ code: schema.permissions.code })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
      .where(eq(schema.rolePermissions.role, userRole as UserRole));

    const userPermRows = await this.db
      .select({
        code: schema.permissions.code,
        granted: schema.userPermissions.granted,
      })
      .from(schema.userPermissions)
      .innerJoin(schema.permissions, eq(schema.userPermissions.permissionId, schema.permissions.id))
      .where(eq(schema.userPermissions.userId, userId));

    const rolePerms = new Set(rolePermRows.map((r) => r.code));
    const grants = new Set(userPermRows.filter((r) => r.granted).map((r) => r.code));
    const revokes = new Set(userPermRows.filter((r) => !r.granted).map((r) => r.code));

    const effective = new Set([...rolePerms, ...grants]);
    for (const r of revokes) {
      effective.delete(r);
    }
    return effective;
  }

  /**
   * Check if user has a permission. SUPER_ADMIN and ADMIN always return true.
   */
  async hasPermission(userId: string, role: string, permissionCode: string): Promise<boolean> {
    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
    const perms = await this.getEffectivePermissions(userId, role);
    return perms.has(permissionCode);
  }

  /** Check if a role is sensitive (requires SuperAdmin approval when HR assigns) */
  isSensitiveRole(role: string): boolean {
    return (SENSITIVE_ROLES as readonly string[]).includes(role);
  }

  /** Check if a permission code is sensitive (requires SuperAdmin approval when HR grants) */
  isSensitivePermission(code: string): boolean {
    return (SENSITIVE_PERMISSIONS as readonly string[]).includes(code);
  }

  /** Check if HR can assign this role/permission directly without approval */
  canHRAssignDirectly(value: string, type: 'role' | 'permission'): boolean {
    if (type === 'role') return !this.isSensitiveRole(value);
    return !this.isSensitivePermission(value);
  }
}
