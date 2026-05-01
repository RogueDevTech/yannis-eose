import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, eq, ilike, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { canonicalPermissionCode, db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel, isSuperAdminOnly } from '../common/authz';

@Injectable()
export class RoleTemplatesService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  async listTemplates(actor: SessionUser, input?: { search?: string }) {
    // Align with tRPC `permissionProcedure`: session may carry legacy codes (`users.create`, etc.).
    const effective = new Set((actor.permissions ?? []).map((p) => canonicalPermissionCode(p)));
    const canSee =
      isSuperAdminOnly(actor) ||
      isAdminLevel(actor) ||
      effective.has('rbac.templates.manage') ||
      effective.has('users.staff.create') ||
      effective.has('users.staff.update') ||
      effective.has('users.staff.view');
    if (!canSee) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          'Missing permission to list role templates (staff view/create/update, rbac.templates.manage, or admin-level)',
      });
    }

    const search = input?.search?.trim();
    const rows = await this.db
      .select({
        id: schema.roleTemplates.id,
        key: schema.roleTemplates.key,
        name: schema.roleTemplates.name,
        description: schema.roleTemplates.description,
        kind: schema.roleTemplates.kind,
        status: schema.roleTemplates.status,
        locked: schema.roleTemplates.locked,
        mappedRole: schema.roleTemplates.mappedRole,
        updatedAt: schema.roleTemplates.updatedAt,
      })
      .from(schema.roleTemplates)
      .where(
        and(
          eq(schema.roleTemplates.status, 'ACTIVE'),
          search ? ilike(schema.roleTemplates.name, `%${search}%`) : undefined,
        ),
      )
      .orderBy(schema.roleTemplates.name);

    return { templates: rows };
  }

  async getTemplate(actor: SessionUser, templateId: string) {
    if (!isSuperAdminOnly(actor) && !(actor.permissions ?? []).includes('rbac.templates.manage')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing rbac.templates.manage' });
    }

    const [t] = await this.db
      .select()
      .from(schema.roleTemplates)
      .where(and(eq(schema.roleTemplates.id, templateId), isNull(schema.roleTemplates.validTo)))
      .limit(1);
    if (!t) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Role template not found' });
    }

    const permRows = await this.db
      .select({ code: schema.permissions.code })
      .from(schema.roleTemplatePermissions)
      .innerJoin(schema.permissions, eq(schema.roleTemplatePermissions.permissionId, schema.permissions.id))
      .where(
        and(
          eq(schema.roleTemplatePermissions.roleTemplateId, templateId),
          isNull(schema.roleTemplatePermissions.validTo),
        ),
      );

    return {
      template: t,
      permissionCodes: permRows.map((r) => r.code),
    };
  }

  async createTemplate(
    actor: SessionUser,
    input: { key: string; name: string; description?: string | null; permissionCodes: string[] },
  ) {
    if (!isSuperAdminOnly(actor) && !(actor.permissions ?? []).includes('rbac.templates.manage')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing rbac.templates.manage' });
    }

    const key = input.key.trim();
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(key)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid template key' });
    }

    return withActor(this.db, actor, async (tx) => {
      const [created] = await tx
        .insert(schema.roleTemplates)
        .values({
          key,
          name: input.name.trim(),
          description: input.description?.trim() ?? null,
          kind: 'CUSTOM',
          status: 'ACTIVE',
          locked: false,
        })
        .returning({ id: schema.roleTemplates.id });

      const templateId = created?.id;
      if (!templateId) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create template' });
      }

      if (input.permissionCodes.length > 0) {
        const perms = await tx
          .select({ id: schema.permissions.id, code: schema.permissions.code })
          .from(schema.permissions)
          .where(isNull(schema.permissions.validTo));

        const byCode = new Map(perms.map((p) => [p.code, p.id]));
        const inserts = [];
        for (const code of input.permissionCodes) {
          const pid = byCode.get(code);
          if (!pid) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown permission code: ${code}` });
          }
          inserts.push({ roleTemplateId: templateId, permissionId: pid });
        }
        if (inserts.length > 0) {
          await tx.insert(schema.roleTemplatePermissions).values(inserts);
        }
      }

      return { id: templateId };
    });
  }

  async updateTemplatePermissions(actor: SessionUser, input: { templateId: string; permissionCodes: string[] }) {
    const gatePerm = 'rbac.templates.manage';
    if (!isSuperAdminOnly(actor) && !(actor.permissions ?? []).includes(gatePerm)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Missing ${gatePerm}` });
    }

    const [tpl] = await this.db
      .select()
      .from(schema.roleTemplates)
      .where(and(eq(schema.roleTemplates.id, input.templateId), isNull(schema.roleTemplates.validTo)))
      .limit(1);
    if (!tpl) throw new TRPCError({ code: 'NOT_FOUND', message: 'Role template not found' });
    if (tpl.locked && !isSuperAdminOnly(actor)) {
      throw new ForbiddenException('This system template is locked. SuperAdmin may edit in emergencies.');
    }

    return withActor(this.db, actor, async (tx) => {
      await tx
        .delete(schema.roleTemplatePermissions)
        .where(eq(schema.roleTemplatePermissions.roleTemplateId, input.templateId));

      if (input.permissionCodes.length > 0) {
        const perms = await tx
          .select({ id: schema.permissions.id, code: schema.permissions.code })
          .from(schema.permissions)
          .where(isNull(schema.permissions.validTo));
        const byCode = new Map(perms.map((p) => [p.code, p.id]));
        const inserts = [];
        for (const code of input.permissionCodes) {
          const pid = byCode.get(code);
          if (!pid) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown permission code: ${code}` });
          }
          inserts.push({ roleTemplateId: input.templateId, permissionId: pid });
        }
        await tx.insert(schema.roleTemplatePermissions).values(inserts);
      }

      await tx
        .update(schema.roleTemplates)
        .set({ updatedAt: new Date() })
        .where(eq(schema.roleTemplates.id, input.templateId));

      return { success: true as const };
    });
  }
}
