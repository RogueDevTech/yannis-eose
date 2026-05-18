import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { canonicalPermissionCode } from '@yannis/shared';

type DrizzleDb = PostgresJsDatabase<typeof schema>;

/**
 * Codes granted by a role template (`role_template_permissions`).
 * When that set is empty (seed drift, fresh DB, broken sync), falls back to legacy
 * `role_permissions` for the user's enum role — same matrix `seed-runner` uses for SYSTEM templates.
 */
export async function resolveRoleTemplateBaselineCodes(
  dbOrTx: DrizzleDb,
  roleTemplateId: string | null,
  role: string,
): Promise<string[]> {
  if (roleTemplateId) {
    const templatePermRows = await dbOrTx
      .select({ code: schema.permissions.code })
      .from(schema.roleTemplatePermissions)
      .innerJoin(schema.permissions, eq(schema.roleTemplatePermissions.permissionId, schema.permissions.id))
      .where(
        and(
          eq(schema.roleTemplatePermissions.roleTemplateId, roleTemplateId),
          isNull(schema.roleTemplatePermissions.validTo),
          isNull(schema.permissions.validTo),
        ),
      );

    const fromTemplate = templatePermRows.map((r) => canonicalPermissionCode(r.code));
    if (fromTemplate.length > 0) return fromTemplate;
  }

  if (role === 'SUPER_ADMIN') return [];

  const roleRows = await dbOrTx
    .select({ code: schema.permissions.code })
    .from(schema.rolePermissions)
    .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id))
    .where(and(eq(schema.rolePermissions.role, role as never), isNull(schema.permissions.validTo)));

  return roleRows.map((r) => canonicalPermissionCode(r.code));
}
