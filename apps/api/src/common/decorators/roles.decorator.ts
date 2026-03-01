import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@yannis/shared';

export const ROLES_KEY = 'roles';

/**
 * Route-level RBAC decorator.
 * Usage: @Roles('SUPER_ADMIN', 'FINANCE_OFFICER')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
