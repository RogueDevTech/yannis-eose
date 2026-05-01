import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import type { RoleTemplatesService } from '../../permissions/role-templates.service';

let roleTemplatesServiceInstance: RoleTemplatesService | null = null;

export function setRoleTemplatesService(service: RoleTemplatesService) {
  roleTemplatesServiceInstance = service;
}

function svc(): RoleTemplatesService {
  if (!roleTemplatesServiceInstance) {
    throw new Error('RoleTemplatesService not initialized');
  }
  return roleTemplatesServiceInstance;
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
    .query(async ({ input, ctx }) => svc().listTemplates(ctx.user, input)),

  get: permissionProcedure('rbac.templates.manage')
    .input(z.object({ templateId: z.string().uuid() }))
    .query(async ({ input, ctx }) => svc().getTemplate(ctx.user, input.templateId)),

  create: permissionProcedure('rbac.templates.manage')
    .input(
      z.object({
        key: z.string().min(3).max(64),
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
        permissionCodes: z.array(z.string().min(1)).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => svc().createTemplate(ctx.user, input)),

  setPermissions: permissionProcedure('rbac.templates.manage')
    .input(
      z.object({
        templateId: z.string().uuid(),
        permissionCodes: z.array(z.string().min(1)).default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => svc().updateTemplatePermissions(ctx.user, input)),
});
