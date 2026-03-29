import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  logisticsLocationId: string | null;
  permissions?: string[];
  /** Active branch for multi-branch context. NULL = cross-branch (SuperAdmin). */
  currentBranchId?: string | null;
  /** Saved appearance id; undefined/null = use org default (`client_ui_config`). */
  appTheme?: string | null;
}

/**
 * Extracts the authenticated user from the request object.
 * Usage: @CurrentUser() user: SessionUser
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as Request & { user: SessionUser }).user;
  },
);
