import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { canViewAllBranches } from '../common/authz';
import { eq, sql, desc } from 'drizzle-orm';
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

    // Clear rate limit on successful login
    await this.redis.del(`${RATE_LIMIT_PREFIX}${clientIp}`);

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

    // SuperAdmin can switch to any branch; others must be a member
    if (user.role !== 'SUPER_ADMIN') {
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
   */
  private async checkRateLimit(ip: string): Promise<void> {
    const key = `${RATE_LIMIT_PREFIX}${ip}`;
    const attempts = await this.redis.get(key);

    if (attempts && parseInt(attempts, 10) >= this.maxLoginAttempts) {
      const ttl = await this.redis.ttl(key);
      throw new ForbiddenException(
        `Too many login attempts. Try again in ${Math.ceil(ttl / 60)} minute(s).`,
      );
    }
  }

  /**
   * Record a failed login attempt for rate limiting.
   */
  private async recordFailedAttempt(ip: string): Promise<void> {
    const key = `${RATE_LIMIT_PREFIX}${ip}`;
    const current = await this.redis.incr(key);

    // Set expiry on first attempt
    if (current === 1) {
      await this.redis.expire(key, this.rateLimitWindow);
    }
  }
}
