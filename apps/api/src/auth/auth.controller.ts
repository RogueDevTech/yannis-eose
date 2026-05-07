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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly userBundleCache: UserBundleCacheService,
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

    const { token, user, ttlSeconds } = await this.authService.login(
      body.email,
      body.password,
      clientIp,
      body.rememberMe === true,
    );

    res.cookie('yannis_session', token, sessionCookieOpts(ttlSeconds * 1000));

    return {
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
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
  async stopMirror(@Req() req: Request, @CurrentUser() current: SessionUser) {
    const sessionToken = this.extractSessionToken(req);
    if (!sessionToken) {
      throw new ForbiddenException('No active session.');
    }
    const restored = await this.authService.stopMirror(sessionToken, current);
    return {
      message: 'Exited mirror mode.',
      user: restored,
    };
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
  async me(@CurrentUser() user: SessionUser) {
    const bundle = await this.userBundleCache.getOrLoad(user.id);

    const merged: SessionUser = {
      ...user,
      role: bundle.role || user.role,
      roleTemplateId: bundle.roleTemplateId,
      scopeGlobal: bundle.scopeGlobal,
      scopeOrgWideHead: bundle.scopeOrgWideHead,
      scopeTeamSupervisor: bundle.scopeTeamSupervisor,
      permissions: bundle.permissions,
      appTheme: bundle.appTheme,
      fontScale: bundle.fontScale,
      ...(bundle.staffOnboardingStatus !== undefined
        ? { staffOnboardingStatus: bundle.staffOnboardingStatus }
        : {}),
    };

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
