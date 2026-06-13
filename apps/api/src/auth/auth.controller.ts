import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UserBundleCacheService } from './user-bundle-cache.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { encodePermissionsToBitmask } from '@yannis/shared';
import {
  BUNDLE_COOKIE_NAME,
  BUNDLE_TTL_SECONDS,
  resolveBundleSecret,
  signSessionBundle,
  type SessionBundleInput,
} from './session-bundle-cookie';

/**
 * Parent domain for split web/API hosts (e.g. `.example.com`).
 * Only applied in production: if set while visiting `localhost`, browsers reject the cookie
 * (Domain mismatch) — Remix forwards Set-Cookie but the session never sticks → instant logout.
 */
function resolvedSessionCookieDomain(): string | undefined {
  if (process.env['NODE_ENV'] !== 'production') return undefined;
  return process.env['SESSION_COOKIE_DOMAIN']?.trim() || undefined;
}

/** When web (e.g. yannis.*) and API (e.g. api-yannis.*) differ, set e.g. `.roguedevtech.com` so Socket.io receives `Cookie`. */
function sessionCookieOpts(maxAgeMs: number): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'strict' | 'lax';
  maxAge: number;
  path: string;
  domain?: string;
} {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const domain = resolvedSessionCookieDomain();
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: maxAgeMs,
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

function sessionClearCookieOpts(): { path: string; domain?: string; secure?: boolean; sameSite?: 'strict' | 'lax' } {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const domain = resolvedSessionCookieDomain();
  return {
    path: '/',
    ...(domain ? { domain } : {}),
    ...(isProduction ? { secure: true, sameSite: 'strict' as const } : {}),
  };
}

/**
 * Build a {@link SessionBundleInput} from a fully-merged `SessionUser`. The
 * Remix server treats this as the canonical loader-side user representation,
 * so missing optional fields are normalised to `null` / empty arrays here.
 */
function bundleInputFromSessionUser(user: SessionUser): SessionBundleInput {
  // Permissions are encoded as a 16-byte bitmask (`p`, ~22 chars base64url)
  // so the cookie stays small regardless of how many codes the user holds —
  // including admin-class with all 118. The Remix server decodes via
  // `decodePermissionsFromBitmask()` from `@yannis/shared`. See
  // `permission-bitmask.ts` for the index stability rules.
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roleTemplateId: user.roleTemplateId ?? null,
    scopeGlobal: user.scopeGlobal === true,
    scopeOrgWideHead: user.scopeOrgWideHead === true,
    scopeTeamSupervisor: user.scopeTeamSupervisor === true,
    logisticsLocationId: user.logisticsLocationId ?? null,
    p: encodePermissionsToBitmask(user.permissions ?? []),
    currentBranchId: user.currentBranchId ?? null,
    selectedBranchIds: user.selectedBranchIds ?? null,
    activeGroupId: user.activeGroupId ?? null,
    branchIds: user.branchIds ?? [],
    appTheme: user.appTheme ?? null,
    fontScale: user.fontScale ?? null,
    mirroredBy: user.mirroredBy ?? null,
    mirrorSessionId: user.mirrorSessionId ?? null,
    ...(user.staffOnboardingStatus !== undefined
      ? { staffOnboardingStatus: user.staffOnboardingStatus }
      : {}),
    ...(user.isMarketingTeamSupervisorOnActiveBranch === true
      ? { isMarketingTeamSupervisorOnActiveBranch: true }
      : {}),
    ...(user.isCsTeamSupervisorOnActiveBranch === true
      ? { isCsTeamSupervisorOnActiveBranch: true }
      : {}),
    ...(user.isTeamSupervisor === true ? { isTeamSupervisor: true } : {}),
  };
}

/**
 * Sign + set the bundle cookie. Cookie max-age is the same as the session
 * (so the cookie persists across short network blips); the bundle's payload
 * carries its own short-lived `exp` so loaders refresh data within ~60s.
 *
 * Wrapped in try/catch so a missing `SESSION_BUNDLE_SECRET` / `SESSION_SECRET`
 * (or any other signing failure) NEVER breaks the request it's attached to —
 * the bundle is purely an optimization. If signing fails the loader simply
 * falls back to `/auth/me` on every request (the pre-bundle behaviour).
 *
 * Logs at WARN level so missing env vars are visible in deploy logs without
 * spamming on every request after the first warning.
 */
let bundleCookieFailureLogged = false;
function setBundleCookie(res: Response, user: SessionUser, sessionTtlSeconds: number): void {
  try {
    const value = signSessionBundle(bundleInputFromSessionUser(user), resolveBundleSecret());
    const isProduction = process.env['NODE_ENV'] === 'production';
    const domain = resolvedSessionCookieDomain();
    res.cookie(BUNDLE_COOKIE_NAME, value, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      // The HTTP cookie outlives the bundle's freshness window — see the file
      // header in `session-bundle-cookie.ts` for the rationale.
      maxAge: Math.max(sessionTtlSeconds, BUNDLE_TTL_SECONDS) * 1000,
      path: '/',
      ...(domain ? { domain } : {}),
    });
  } catch (err) {
    // Most common cause: SESSION_BUNDLE_SECRET / SESSION_SECRET not set on the
    // deployed API. Swallowing means login still succeeds with just the session
    // cookie; the perf optimisation is silently degraded.
    if (!bundleCookieFailureLogged) {
      bundleCookieFailureLogged = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[auth] setBundleCookie failed; login will still succeed but bundle-cookie ` +
          `optimisation is degraded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function clearBundleCookie(res: Response): void {
  try {
    res.clearCookie(BUNDLE_COOKIE_NAME, sessionClearCookieOpts());
  } catch {
    // Cookie clearing is best-effort. If it fails, the cookie's own short
    // expiry (BUNDLE_TTL_SECONDS) will let it die naturally.
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly userBundleCache: UserBundleCacheService,
    private readonly branchTeams: BranchTeamsService,
  ) {}

  /**
   * Check if the system has been set up (any SuperAdmin exists).
   * Public — used by the frontend to show setup vs login page.
   */
  @Public()
  @Get('setup-status')
  @HttpCode(HttpStatus.OK)
  async setupStatus() {
    const isComplete = await this.usersService.isSetupComplete();
    return { setupComplete: isComplete };
  }

  /**
   * One-time SuperAdmin setup.
   * Only works when no users exist in the database.
   * Creates the first SuperAdmin account.
   */
  @Public()
  @Post('setup')
  @HttpCode(HttpStatus.CREATED)
  async setup(
    @Body() body: { name: string; email: string; password: string },
  ) {
    const user = await this.usersService.setupSuperAdmin({
      name: body.name,
      email: body.email,
      password: body.password,
    });

    return {
      message: 'SuperAdmin created successfully. You can now log in.',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  /**
   * Request a password reset email.
   * Always returns success to prevent email enumeration.
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() body: { email: string; resetBaseUrl: string },
  ) {
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      return { message: 'If an account with that email exists, a reset link has been sent.' };
    }

    await this.authService.forgotPassword(email, body.resetBaseUrl);

    return { message: 'If an account with that email exists, a reset link has been sent.' };
  }

  /**
   * Reset password using a valid token from the reset email.
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: { token: string; newPassword: string },
  ) {
    if (!body.token || !body.newPassword) {
      return { error: 'Token and new password are required' };
    }

    if (body.newPassword.length < 8) {
      return { error: 'Password must be at least 8 characters' };
    }

    await this.authService.resetPasswordWithToken(body.token, body.newPassword);

    return { message: 'Password has been reset successfully. You can now sign in.' };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: { email: string; password: string; rememberMe?: boolean },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';

    const { token, user: loginSession, ttlSeconds } = await this.authService.login(
      body.email,
      body.password,
      clientIp,
      body.rememberMe === true,
    );

    res.cookie('yannis_session', token, sessionCookieOpts(ttlSeconds * 1000));

    // Issue an initial bundle so the Remix server can skip its first
    // `/auth/me` round-trip after login. Permissions/scope/theme are pulled
    // via the same cache the `/auth/me` handler uses.
    const bundle = await this.userBundleCache.getOrLoad(loginSession.id);
    let sessionUser: SessionUser = {
      ...loginSession,
      role: bundle.role || loginSession.role,
      roleTemplateId: bundle.roleTemplateId,
      scopeGlobal: bundle.scopeGlobal,
      scopeOrgWideHead: bundle.scopeOrgWideHead,
      scopeTeamSupervisor: bundle.scopeTeamSupervisor,
      permissions: bundle.permissions,
      appTheme: bundle.appTheme ?? loginSession.appTheme,
      fontScale: bundle.fontScale ?? loginSession.fontScale,
      ...(bundle.staffOnboardingStatus !== undefined
        ? { staffOnboardingStatus: bundle.staffOnboardingStatus }
        : {}),
    };
    sessionUser = await this.branchTeams.attachTeamSupervisorSessionFlags(sessionUser);
    setBundleCookie(res, sessionUser, ttlSeconds);

    return {
      message: 'Login successful',
      user: {
        id: loginSession.id,
        email: loginSession.email,
        name: loginSession.name,
        role: loginSession.role,
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionToken = this.extractSessionToken(req);

    if (sessionToken) {
      await this.authService.logout(sessionToken);
    }

    res.clearCookie('yannis_session', sessionClearCookieOpts());
    // Bundle is a CACHE on top of the session — clearing the session alone
    // would leave a stale bundle that decodes to "still logged in" for up to
    // BUNDLE_TTL_SECONDS. Nuke both so loaders see the user as logged out
    // immediately and redirect to /auth.
    clearBundleCookie(res);
    return { message: 'Logged out successfully' };
  }

  /**
   * Kill all sessions for a specific user — forces immediate logout across all devices.
   * SUPER_ADMIN may target anyone. ADMIN may only target non-admin-level users
   * (cannot lock out another Admin or the SuperAdmin).
   */
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete('sessions/:userId')
  @HttpCode(HttpStatus.OK)
  async killUserSessions(
    @Param('userId') userId: string,
    @CurrentUser() actor: SessionUser,
  ) {
    if (actor.role === 'ADMIN') {
      const targetUser = await this.usersService.getById(userId).catch(() => null);
      if (targetUser && (targetUser.role === 'SUPER_ADMIN' || targetUser.role === 'ADMIN')) {
        throw new ForbiddenException(
          'Admins cannot kill sessions of another Admin or the SuperAdmin. Only the SuperAdmin can.',
        );
      }
    }
    const killed = await this.authService.killUserSessions(userId);
    return {
      message: `Terminated ${killed} session(s) for user ${userId}`,
      killedBy: actor.id,
      sessionsKilled: killed,
    };
  }

  /**
   * Mirror Mode — start viewing the app as another user. Read-only: every mutation
   * is blocked at the tRPC root middleware while `mirroredBy` is set on the session.
   *
   * Permission gate (canMirror) is enforced server-side in AuthService — clients
   * cannot bypass by hitting this endpoint directly.
   */
  @Post('mirror/start')
  @HttpCode(HttpStatus.OK)
  async startMirror(
    @Body() body: { targetUserId: string },
    @Req() req: Request,
    @CurrentUser() actor: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionToken = this.extractSessionToken(req);
    if (!sessionToken) {
      throw new ForbiddenException('No active session.');
    }
    if (!body?.targetUserId) {
      throw new ForbiddenException('targetUserId is required.');
    }
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      null;
    const userAgent = (req.headers['user-agent'] as string) ?? null;

    const session = await this.authService.startMirror(sessionToken, actor, body.targetUserId, {
      ipAddress,
      userAgent,
    });

    // The session's effective identity has changed — re-issue the bundle so
    // the Remix server reflects the target user (role, permissions, scope,
    // mirroredBy) on the very next loader. Without this, the original admin
    // would keep using their cached bundle for up to BUNDLE_TTL_SECONDS.
    const mirroredUser = await this.branchTeams.attachTeamSupervisorSessionFlags(
      session as unknown as SessionUser,
    );
    setBundleCookie(res, mirroredUser, BUNDLE_TTL_SECONDS * 60);

    return {
      message: 'Mirror mode started.',
      user: session,
    };
  }

  /**
   * Exit Mirror Mode — restores the original admin session.
   */
  @Post('mirror/stop')
  @HttpCode(HttpStatus.OK)
  async stopMirror(
    @Req() req: Request,
    @CurrentUser() current: SessionUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionToken = this.extractSessionToken(req);
    if (!sessionToken) {
      throw new ForbiddenException('No active session.');
    }
    const restored = await this.authService.stopMirror(sessionToken, current);

    // Bundle restored to the original admin identity — see startMirror note.
    const restoredUser = await this.branchTeams.attachTeamSupervisorSessionFlags(
      restored as unknown as SessionUser,
    );
    setBundleCookie(res, restoredUser, BUNDLE_TTL_SECONDS * 60);

    return {
      message: 'Exited mirror mode.',
      user: restored,
    };
  }

  /**
   * Switch the active branch on the current session AND re-issue the bundle
   * cookie so Remix loaders pick up the new currentBranchId on the very next
   * render. Without re-issuing, the signed bundle cookie keeps the old
   * currentBranchId for up to BUNDLE_TTL_SECONDS — branch switches appear
   * to do nothing for ~60s. Especially visible during mirror mode, where
   * startMirror just baked in the target's branch.
   *
   * `branchId = null` clears branch context ("All Branches"); only allowed
   * for users that can view all branches (admin, org-wide heads, and other
   * non-branch-assigned company-wide roles).
   */
  @Post('switch-branch')
  @HttpCode(HttpStatus.OK)
  async switchBranch(
    @Body() body: { branchId: string | null; selectedBranchIds?: string[] | null },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionToken = this.extractSessionToken(req);
    if (!sessionToken) {
      throw new ForbiddenException('No active session.');
    }

    const updated = await this.authService.switchBranch(
      sessionToken,
      body?.branchId ?? null,
      body?.selectedBranchIds ?? null,
    );

    const merged = await this.branchTeams.attachTeamSupervisorSessionFlags(updated);
    setBundleCookie(res, merged, BUNDLE_TTL_SECONDS * 60);

    return { currentBranchId: merged.currentBranchId, user: merged };
  }

  /**
   * Returns the current authenticated user's session data.
   * Includes permissions for non-SuperAdmin users (SuperAdmin bypasses all checks).
   *
   * Heavy DB-derived fields (role/template/scope, permissions, theme/font preference,
   * onboarding status) are read from `UserBundleCacheService` (Redis, 60s TTL) so this
   * endpoint runs at most one cache GET per call. Session-scoped fields
   * (currentBranchId, branchIds, mirroredBy, mirrorSessionId, logisticsLocationId,
   * email, name, id) come from `@CurrentUser()` and are merged on top.
   *
   * Cache invalidation is explicit: every mutation that changes any cached field
   * must call `userBundleCache.invalidate(userId)` — see the Pillar 1 invalidation
   * hooks in users.service.ts and onboarding.service.ts.
   */
  @Post('me')
  @HttpCode(HttpStatus.OK)
  async me(
    @CurrentUser() user: SessionUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bundle = await this.userBundleCache.getOrLoad(user.id);

    let merged: SessionUser = {
      ...user,
      role: bundle.role || user.role,
      roleTemplateId: bundle.roleTemplateId,
      scopeGlobal: bundle.scopeGlobal,
      scopeOrgWideHead: bundle.scopeOrgWideHead,
      scopeTeamSupervisor: bundle.scopeTeamSupervisor,
      permissions: bundle.permissions,
      appTheme: bundle.appTheme,
      fontScale: bundle.fontScale,
      isTeamSupervisor: bundle.isTeamSupervisor,
      ...(bundle.staffOnboardingStatus !== undefined
        ? { staffOnboardingStatus: bundle.staffOnboardingStatus }
        : {}),
    };

    merged = await this.branchTeams.attachTeamSupervisorSessionFlags(merged);

    // Backfill activeGroupId + selectedBranchIds for stale sessions.
    // Case 1: no activeGroupId at all — resolve from memberships or branch_groups.
    if (!merged.activeGroupId) {
      let groupId: string | null = null;
      if (merged.branchIds?.length) {
        groupId = await this.authService.resolveGroupFromBranches(merged.branchIds);
      }
      // Global users with no memberships: pick first active group
      if (!groupId && (merged.scopeGlobal || merged.role === 'SUPER_ADMIN' || merged.role === 'ADMIN')) {
        groupId = await this.authService.getFirstActiveGroupId();
      }
      if (groupId) {
        merged.activeGroupId = groupId;
        const groupBranchIds = await this.authService.getGroupBranchIds(groupId);
        if (groupBranchIds.length > 0) merged.selectedBranchIds = groupBranchIds;
        const sessionToken = this.extractSessionToken(req);
        if (sessionToken) {
          void this.authService.patchSessionGroupScope(sessionToken, groupId, merged.selectedBranchIds ?? null).catch(() => {});
        }
      }
    }
    // Case 2: activeGroupId is set but selectedBranchIds is missing (stale session).
    if (merged.activeGroupId && (!merged.selectedBranchIds || merged.selectedBranchIds.length === 0)) {
      const groupBranchIds = await this.authService.getGroupBranchIds(merged.activeGroupId);
      if (groupBranchIds.length > 0) {
        merged.selectedBranchIds = groupBranchIds;
        const sessionToken = this.extractSessionToken(req);
        if (sessionToken) {
          void this.authService.patchSessionGroupScope(sessionToken, merged.activeGroupId, groupBranchIds).catch(() => {});
        }
      }
    }

    // Re-issue the lazy bundle cookie so subsequent Remix loaders can decode
    // locally without another `/auth/me` round-trip until BUNDLE_TTL_SECONDS.
    // Match the bundle's HTTP TTL to the session lifetime — exact value isn't
    // critical because the JWT `exp` field controls actual freshness.
    setBundleCookie(res, merged, BUNDLE_TTL_SECONDS * 60);

    return { user: merged };
  }

  private extractSessionToken(request: Request): string | undefined {
    const cookies = request.headers.cookie;
    if (!cookies) return undefined;

    const match = cookies.split(';').find((c) => c.trim().startsWith('yannis_session='));
    if (!match) return undefined;

    return match.split('=')[1]?.trim();
  }
}
