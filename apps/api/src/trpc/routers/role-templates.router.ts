import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import type { RoleTemplatesService } from '../../permissions/role-templates.service';
import { CacheService } from '../../common/cache/cache.service';

let roleTemplatesServiceInstance: RoleTemplatesService | null = null;
let roleTemplatesCacheService: CacheService | null = null;

export function setRoleTemplatesService(service: RoleTemplatesService) {
  roleTemplatesServiceInstance = service;
}

export function setRoleTemplatesCacheService(service: CacheService) {
  roleTemplatesCacheService = service;
}

const ROLE_TEMPLATES_LIST_TTL_SECONDS = 60 * 15;
const ROLE_TEMPLATES_GET_TTL_SECONDS = 60 * 15;

async function invalidateRoleTemplatesListCache(): Promise<void> {
  if (!roleTemplatesCacheService) return;
  await roleTemplatesCacheService.delPattern('cache:roleTemplates:list:*').catch(() => {
    /* fail-open */
  });
  await roleTemplatesCacheService.delPattern('cache:roleTemplates:get:*').catch(() => {
    /* fail-open */
  });
  // Permission baselines depend on templates + template_permissions joins.
  await roleTemplatesCacheService.delPattern('cache:permissions:templateBaselines:*').catch(() => {
    /* fail-open */
  });
  // Any template change may affect effective permission unions in matrix views.
  await roleTemplatesCacheService.delPattern('cache:permissions:userMatrix:*').catch(() => {
    /* fail-open */
  });
}

function svc(): RoleTemplatesService {
  if (!roleTemplatesServiceInstance) {
    throw new Error('RoleTemplatesService not initialized');
  }
  return roleTemplatesServiceInstance;
}

/** Exported for cross-router lookups (e.g. `userDetailPageBundle`). */
export function getRoleTemplatesService(): RoleTemplatesService {
  return svc();
}

export const roleTemplatesRouter = router({
  /** Read-only catalog for staff create/edit — aligned with `RoleTemplatesService.listTemplates` gate. */
  list: permissionProcedure(
    'rbac.templates.manage',
    'users.staff.create',
    'users.staff.update',
    'users.staff.view',
  )
    .input(z.object({ search: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      if (!roleTemplatesCacheService) {
        return svc().listTemplates(ctx.user, input);
      }
      const key =
        'cache:roleTemplates:list:' +
        CacheService.hashInput({
          viewerId: ctx.user.id,
          viewerRole: ctx.user.role,
          search: input?.search ?? null,
        });
      return roleTemplatesCacheService.getOrSet(key, ROLE_TEMPLATES_LIST_TTL_SECONDS, () =>
        svc().listTemplates(ctx.user, input),
      );
    }),

  get: permissionProcedure('rbac.templates.manage')
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (!roleTemplatesCacheService) return svc().getTemplate(ctx.user, input.templateId);
      const key =
        'cache:roleTemplates:get:' +
        CacheService.hashInput({
          viewerId: ctx.user.id,
          viewerRole: ctx.user.role,
          templateId: input.templateId,
        });
      return roleTemplatesCacheService.getOrSet(key, ROLE_TEMPLATES_GET_TTL_SECONDS, () =>
        svc().getTemplate(ctx.user, input.templateId),
      );
    }),

  create: permissionProcedure('rbac.templates.manage')
    .input(
      z.object({
        key: z.string().min(3).max(64),
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
        permissionCodes: z.array(z.string().min(1)).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const res = await svc().createTemplate(ctx.user, input);
      await invalidateRoleTemplatesListCache();
      return res;
    }),

  setPermissions: permissionProcedure('rbac.templates.manage')
    .input(
      z.object({
        templateId: z.string().uuid(),
        permissionCodes: z.array(z.string().min(1)).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const res = await svc().updateTemplatePermissions(ctx.user, input);
      await invalidateRoleTemplatesListCache();
      return res;
    }),
});
