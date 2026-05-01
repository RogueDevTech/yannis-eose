import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { canonicalPermissionCode } from '@yannis/shared';
import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';

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

  listCatalog: permissionProcedure(
    'users.staff.create',
    'users.staff.update',
    'users.staff.view',
    'rbac.templates.manage',
  ).query(
    async () => {
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

      const normalizedRows = rows.map((row) => ({ ...row, code: canonicalPermissionCode(row.code) }));
      const grouped = normalizedRows.reduce<Record<string, typeof normalizedRows>>((acc, row) => {
        const domain = row.code.split('.')[0] ?? 'other';
        acc[domain] ??= [];
        acc[domain].push(row);
        return acc;
      }, {});

      return { permissions: normalizedRows, grouped };
    },
  ),

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

  getUserMatrix: permissionProcedure('users.staff.update', 'rbac.templates.manage')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input }) => {
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
        };
      }

      const templateId = user.roleTemplateId;
      const templateCodes =
        templateId
          ? await db()
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

      const overrideRows = await db()
        .select({
          code: schema.permissions.code,
          granted: schema.userPermissions.granted,
        })
        .from(schema.userPermissions)
        .innerJoin(schema.permissions, eq(schema.userPermissions.permissionId, schema.permissions.id))
        .where(and(eq(schema.userPermissions.userId, input.userId), isNull(schema.userPermissions.validTo)));

      const userOverrides = overrideRows.reduce<Record<string, boolean>>((acc, row) => {
        acc[canonicalPermissionCode(row.code)] = row.granted;
        return acc;
      }, {});

      return {
        role: user.role,
        roleTemplateId: user.roleTemplateId,
        userOverrides,
        templateCodes: templateCodes.map((x) => canonicalPermissionCode(x.code)),
      };
    }),
});
