import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@yannis/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { SessionUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator — allow any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user: SessionUser }).user;

    if (!user) {
      throw new ForbiddenException('No user context found');
    }

    if (!requiredRoles.includes(user.role as UserRole)) {
      throw new ForbiddenException(
        `Role '${user.role}' does not have access to this resource`,
      );
    }

    return true;
  }
}
