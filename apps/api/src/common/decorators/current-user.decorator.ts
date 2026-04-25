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
  /** Saved font scale id; undefined/null = base. */
  fontScale?: string | null;
  /**
   * True when this user currently wears the "Finance hat" — grants Finance Officer powers
   * on top of their primary role. Exactly one user in the org has this at any time.
   */
  isFinanceOfficer?: boolean;
  /**
   * Set when the session is in Mirror Mode — the API treats requests as the target user
   * (RLS, branch, role, permissions all switch) but ALL mutations are blocked at the
   * tRPC root middleware. The original admin who started the mirror is recorded here so
   * the UI can show who is mirroring and the audit trail stays correct.
   */
  mirroredBy?: {
    id: string;
    name: string;
    role: string;
  } | null;
  /** mirror_sessions row id — used by stopMirror to close out the active row. */
  mirrorSessionId?: string | null;
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
