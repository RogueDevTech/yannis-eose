import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Assigned permission template — drives default permission bundles. */
  roleTemplateId?: string | null;
  /**
   * Explicit scope flags for permission-first RBAC (see migration 0093).
   * These are mirrored on the frontend via `/auth/me`.
   */
  scopeGlobal?: boolean;
  scopeOrgWideHead?: boolean;
  scopeTeamSupervisor?: boolean;
  logisticsLocationId: string | null;
  permissions?: string[];
  /** Active branch for multi-branch context. NULL = cross-branch (SuperAdmin). */
  currentBranchId?: string | null;
  /**
   * The user's branch memberships, captured at login. Used by
   * `requireBranchScopeForGlobalAdminMutations` so a single-branch org-wide
   * head doesn't get blocked with "Branch context required" — we auto-fall
   * back to their sole branch when no explicit branchId is in the input.
   * Multi-branch holders get the existing strict gate.
   */
  branchIds?: string[];
  /** Saved appearance id; undefined/null = use org default (`client_ui_config`). */
  appTheme?: string | null;
  /** Saved font scale id; undefined/null = base. */
  fontScale?: string | null;
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
  /**
   * Staff HR onboarding packet status — set on `/auth/me` for non–admin-class users only.
   * Web uses this for the login onboarding nudge (suppress after `APPROVED`). Omitted for SUPER_ADMIN / ADMIN.
   */
  staffOnboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED' | 'APPROVED';
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
