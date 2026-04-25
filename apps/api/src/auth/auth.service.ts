import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { canMirror, canViewAllBranches } from '../common/authz';
import { and, eq, isNull, sql, desc } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { SessionStoreService } from './session-store.service';

const RATE_LIMIT_PREFIX = 'login_rate:';
const RESET_TOKEN_PREFIX = 'pwd_reset:';
const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL = 1800; // 30 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessionTtl: number;
  private readonly maxLoginAttempts: number;
  private readonly rateLimitWindow: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
    private readonly sessionStore: SessionStoreService,
  ) {
    this.sessionTtl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10); // 24 hours
    this.maxLoginAttempts = 5;
    this.rateLimitWindow = 900; // 15 minutes in seconds
  }

  /**
   * Authenticate a user and create a session.
   * Returns the session token to be set as an HTTP-only cookie.
   */
  async login(
    email: string,
    password: string,
    clientIp: string,
  ): Promise<{ token: string; user: SessionUser }> {
    // Rate limit check
    await this.checkRateLimit(clientIp);

    // Find user by email
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!user) {
      await this.recordFailedAttempt(clientIp);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Only PENDING (invited, never logged in) and ACTIVE can log in
    if (user.status === 'DEACTIVATED') {
      throw new ForbiddenException('Account is deactivated. Contact admin to be re-invited.');
    }
    if (user.status !== 'ACTIVE' && user.status !== 'PENDING') {
      throw new ForbiddenException('Account is deactivated');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await this.recordFailedAttempt(clientIp);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Clear rate limit on successful login. Best-effort — if Redis is unreachable the rate-limit
    // entry will simply expire on its own; we must not 500 the login over it.
    try {
      await this.redis.del(`${RATE_LIMIT_PREFIX}${clientIp}`);
    } catch (err) {
      this.logger.warn(`rate_limit_clear_failed ip=${clientIp} reason=${(err as Error).message}`);
    }

    // Option B: first login — move PENDING → ACTIVE
    if (user.status === 'PENDING') {
      await this.db
        .update(schema.users)
        .set({ status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(schema.users.id, user.id));
    }

    // Generate session token
    const token = randomBytes(32).toString('hex');

    // Resolve primary branch for multi-branch context.
    // Non-global users MUST have at least one user_branches row — no membership = login denied.
    let currentBranchId: string | null = null;
    if (!canViewAllBranches(user)) {
      const memberships = await this.db
        .select({ branchId: schema.userBranches.branchId, isPrimary: schema.userBranches.isPrimary })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.userId, user.id))
        .orderBy(desc(schema.userBranches.isPrimary)) // isPrimary=true sorts first
        .limit(10);

      if (memberships.length === 0) {
        throw new UnauthorizedException(
          'Your account has not been assigned to a branch. Contact your administrator.',
        );
      }

      currentBranchId = memberships[0]!.branchId as string;
    }

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      logisticsLocationId: user.logisticsLocationId,
      currentBranchId,
      appTheme: user.appTheme ?? null,
      fontScale: user.fontScale ?? null,
      isFinanceOfficer: user.isFinanceOfficer === true,
    };

    // Persist session in DB, then cache in Redis when available.
    await this.sessionStore.createSession(token, sessionUser, this.sessionTtl);

    return { token, user: sessionUser };
  }

  /**
   * Destroy a specific session — instant revocation.
   */
  async logout(sessionToken: string): Promise<void> {
    await this.sessionStore.deleteSession(sessionToken);
  }

  /**
   * SuperAdmin: Kill ALL sessions for a specific user.
   * Instant deactivation — all their active sessions become invalid.
   */
  async killUserSessions(targetUserId: string): Promise<number> {
    return this.sessionStore.deleteAllUserSessions(targetUserId);
  }

  /**
   * Mirror Mode — replace the actor's session with the target user so the entire
   * app renders as that user (RLS, branch, role, permissions, sidebar). Mutations
   * are blocked at the tRPC root middleware while a `mirroredBy` field is set.
   *
   * Permission gating lives in `canMirror()` — see authz.ts. A new mirror_sessions
   * audit row is opened (and closed on `stopMirror`) so we always know who saw
   * what through whose account.
   */
  async startMirror(
    sessionToken: string,
    actor: SessionUser,
    targetUserId: string,
    requestMeta: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<SessionUser> {
    if (actor.mirroredBy) {
      throw new ForbiddenException('Already in mirror mode — exit current mirror first.');
    }

    const targetRows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId))
      .limit(1);
    const target = targetRows[0];
    if (!target) {
      throw new BadRequestException('Target user not found.');
    }
    if (target.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot mirror an inactive user.');
    }

    if (
      !canMirror(
        { id: actor.id, role: actor.role, currentBranchId: actor.currentBranchId, mirroredBy: actor.mirroredBy },
        { id: target.id, role: target.role, primaryBranchId: target.primaryBranchId },
      )
    ) {
      throw new ForbiddenException('You are not allowed to mirror this user.');
    }

    // Resolve the target user's branch context the same way login does.
    let currentBranchId: string | null = null;
    if (!canViewAllBranches({ role: target.role })) {
      const memberships = await this.db
        .select({ branchId: schema.userBranches.branchId, isPrimary: schema.userBranches.isPrimary })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.userId, target.id))
        .orderBy(desc(schema.userBranches.isPrimary))
        .limit(10);
      currentBranchId = memberships[0]?.branchId ?? target.primaryBranchId ?? null;
      if (!currentBranchId) {
        throw new BadRequestException('Target user has no branch — cannot mirror.');
      }
    }

    const insertedRows = await this.db
      .insert(schema.mirrorSessions)
      .values({
        actorId: actor.id,
        targetId: target.id,
        ipAddress: requestMeta.ipAddress ?? null,
        userAgent: requestMeta.userAgent ?? null,
      })
      .returning({ id: schema.mirrorSessions.id });
    const mirrorSessionId = insertedRows[0]?.id;
    if (!mirrorSessionId) {
      throw new BadRequestException('Failed to record mirror session.');
    }

    const mirroredSession: SessionUser = {
      id: target.id,
      email: target.email,
      name: target.name,
      role: target.role,
      logisticsLocationId: target.logisticsLocationId,
      currentBranchId,
      // Surface the target's appearance so the admin sees the app exactly as the
      // user would. The green border makes Mirror Mode obvious; the theme is part
      // of the read-only "live walkthrough".
      appTheme: target.appTheme ?? null,
      fontScale: target.fontScale ?? null,
      isFinanceOfficer: target.isFinanceOfficer === true,
      mirroredBy: { id: actor.id, name: actor.name, role: actor.role },
      mirrorSessionId,
    };

    await this.sessionStore.updateSession(sessionToken, mirroredSession, this.sessionTtl);
    this.logger.log(`mirror_started actor=${actor.id} target=${target.id} session=${mirrorSessionId}`);
    return mirroredSession;
  }

  /**
   * Exit Mirror Mode — restores the original actor session and stamps `ended_at`
   * on the active mirror_sessions row.
   */
  async stopMirror(sessionToken: string, currentSession: SessionUser): Promise<SessionUser> {
    if (!currentSession.mirroredBy) {
      throw new BadRequestException('Not currently mirroring.');
    }

    const originalActorId = currentSession.mirroredBy.id;
    const mirrorSessionId = currentSession.mirrorSessionId ?? null;

    // Close the audit row. Match by id when we have it; fall back to the most
    // recent open row for this actor+target so a stale session still closes.
    if (mirrorSessionId) {
      await this.db
        .update(schema.mirrorSessions)
        .set({ endedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.mirrorSessions.id, mirrorSessionId),
            isNull(schema.mirrorSessions.endedAt),
          ),
        );
    } else {
      await this.db
        .update(schema.mirrorSessions)
        .set({ endedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.mirrorSessions.actorId, originalActorId),
            eq(schema.mirrorSessions.targetId, currentSession.id),
            isNull(schema.mirrorSessions.endedAt),
          ),
        );
    }

    // Re-hydrate the original user fresh from DB.
    const actorRows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, originalActorId))
      .limit(1);
    const actor = actorRows[0];
    if (!actor) {
      throw new BadRequestException('Original actor no longer exists; please log in again.');
    }

    let currentBranchId: string | null = null;
    if (!canViewAllBranches({ role: actor.role })) {
      const memberships = await this.db
        .select({ branchId: schema.userBranches.branchId, isPrimary: schema.userBranches.isPrimary })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.userId, actor.id))
        .orderBy(desc(schema.userBranches.isPrimary))
        .limit(10);
      currentBranchId = memberships[0]?.branchId ?? actor.primaryBranchId ?? null;
    }

    const restored: SessionUser = {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      logisticsLocationId: actor.logisticsLocationId,
      currentBranchId,
      appTheme: currentSession.appTheme ?? null,
      fontScale: currentSession.fontScale ?? null,
      isFinanceOfficer: actor.isFinanceOfficer === true,
      mirroredBy: null,
      mirrorSessionId: null,
    };

    await this.sessionStore.updateSession(sessionToken, restored, this.sessionTtl);
    this.logger.log(`mirror_stopped actor=${actor.id} target=${currentSession.id}`);
    return restored;
  }

  /**
   * Hash a password for storage (used during user creation).
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  /**
   * Request a password reset. Generates a token, stores it in Redis,
   * and sends the reset link via email.
   * Always returns success to prevent email enumeration attacks.
   */
  async forgotPassword(email: string, resetBaseUrl: string): Promise<void> {
    const [user] = await this.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!user || (user.status !== 'ACTIVE' && user.status !== 'PENDING')) {
      // Don't reveal if user exists — silently return
      this.logger.warn(`Password reset requested for unknown/inactive email: ${email}`);
      return;
    }

    // Generate a cryptographically secure token
    const token = randomBytes(32).toString('hex');

    // Store token → userId mapping in Redis with 30-minute TTL
    await this.redis.setex(`${RESET_TOKEN_PREFIX}${token}`, RESET_TOKEN_TTL, user.id);

    // Build reset link
    const resetUrl = `${resetBaseUrl}?token=${token}`;

    // Send email (best-effort, non-blocking)
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 0;">
        <div style="background: #1565C0; padding: 24px 32px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #fff; margin: 0; font-size: 22px;">Password Reset</h1>
        </div>
        <div style="background: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
            Hi <strong>${user.name}</strong>,
          </p>
          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
            We received a request to reset your password. Click the button below to set a new password. This link expires in 30 minutes.
          </p>
          <a href="${resetUrl}" style="display: block; text-align: center; background: #1565C0; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            Reset Password
          </a>
          <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 24px 0 0; text-align: center;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      </div>
    `;

    const text = `Hi ${user.name},\n\nWe received a request to reset your password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 30 minutes.\n\nIf you didn't request this, you can safely ignore this email.`;

    await this.notifications.sendEmail({
      to: user.email,
      subject: 'Yannis EOSE — Password Reset',
      html,
      text,
    });

    this.logger.log(`Password reset token generated for user ${user.id}`);
  }

  /**
   * Reset password using a valid token.
   * Validates the token, updates the password, and invalidates all existing sessions.
   */
  async resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
    // Look up the token in Redis
    const userId = await this.redis.get(`${RESET_TOKEN_PREFIX}${token}`);
    if (!userId) {
      throw new BadRequestException('Invalid or expired reset link. Please request a new one.');
    }

    // Verify user exists and is active
    const [user] = await this.db
      .select({ id: schema.users.id, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user || (user.status !== 'ACTIVE' && user.status !== 'PENDING')) {
      throw new BadRequestException('Account not found or deactivated.');
    }

    // Hash the new password
    const passwordHash = await this.hashPassword(newPassword);

    // Update password in database (with actor injection for audit trail)
    await this.db.execute(
      sql`SELECT set_config('yannis.current_user_id', ${userId}, true)`,
    );
    await this.db
      .update(schema.users)
      .set({ passwordHash })
      .where(eq(schema.users.id, userId));

    // Invalidate the reset token (single-use)
    await this.redis.del(`${RESET_TOKEN_PREFIX}${token}`);

    // Kill all existing sessions for security
    await this.killUserSessions(userId);

    this.logger.log(`Password reset completed for user ${userId}`);
  }

  /**
   * Switch the active branch in the current session.
   * User must be a member of the target branch (or SuperAdmin).
   * Updates Redis session — takes effect on next request.
   */
  async switchBranch(sessionToken: string, branchId: string): Promise<{ currentBranchId: string }> {
    const sessionData = await this.sessionStore.getSession(sessionToken);
    if (!sessionData) {
      throw new UnauthorizedException('Session not found');
    }

    const user: SessionUser = sessionData;

    // SUPER_ADMIN and ADMIN can switch to any branch; others must be a member
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      const membership = await this.db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(
          eq(schema.userBranches.userId, user.id),
        )
        .limit(100);
      const isMember = membership.some((m) => m.branchId === branchId);
      if (!isMember) {
        throw new ForbiddenException('You are not a member of this branch');
      }
    }

    const updated: SessionUser = { ...user, currentBranchId: branchId };
    await this.sessionStore.updateSession(sessionToken, updated, this.sessionTtl);

    return { currentBranchId: branchId };
  }

  /**
   * Check if an IP has exceeded the login attempt rate limit.
   * Rate limiting is best-effort: if Redis is unreachable we log + skip the check rather than
   * 500 the login. Otherwise a transient Redis hiccup turns into "Internal server error" for
   * every signed-out user trying to log in.
   */
  private async checkRateLimit(ip: string): Promise<void> {
    const key = `${RATE_LIMIT_PREFIX}${ip}`;
    let attempts: string | null;
    try {
      attempts = await this.redis.get(key);
    } catch (err) {
      this.logger.warn(`rate_limit_check_skipped ip=${ip} reason=${(err as Error).message}`);
      return;
    }

    if (attempts && parseInt(attempts, 10) >= this.maxLoginAttempts) {
      let ttl = this.rateLimitWindow;
      try {
        ttl = await this.redis.ttl(key);
      } catch (err) {
        this.logger.warn(`rate_limit_ttl_unavailable ip=${ip} reason=${(err as Error).message}`);
      }
      throw new ForbiddenException(
        `Too many login attempts. Try again in ${Math.ceil(ttl / 60)} minute(s).`,
      );
    }
  }

  /**
   * Record a failed login attempt for rate limiting.
   * Best-effort — Redis errors must not turn a wrong-password attempt into a 500.
   */
  private async recordFailedAttempt(ip: string): Promise<void> {
    const key = `${RATE_LIMIT_PREFIX}${ip}`;
    try {
      const current = await this.redis.incr(key);
      if (current === 1) {
        await this.redis.expire(key, this.rateLimitWindow);
      }
    } catch (err) {
      this.logger.warn(`rate_limit_record_skipped ip=${ip} reason=${(err as Error).message}`);
    }
  }
}
