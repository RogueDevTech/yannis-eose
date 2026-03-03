import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';
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

    if (user.status !== 'ACTIVE') {
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

    // Generate session token
    const token = randomBytes(32).toString('hex');

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      logisticsLocationId: user.logisticsLocationId,
    };

    // Store session in Redis with TTL
    await this.redis.setex(
      `${SESSION_PREFIX}${token}`,
      this.sessionTtl,
      JSON.stringify(sessionUser),
    );

    // Track token in user's session set (for session kill)
    await this.redis.sadd(`${USER_SESSIONS_PREFIX}${user.id}`, token);

    return { token, user: sessionUser };
  }

  /**
   * Destroy a specific session — instant revocation.
   */
  async logout(sessionToken: string): Promise<void> {
    const sessionData = await this.redis.get(`${SESSION_PREFIX}${sessionToken}`);
    if (sessionData) {
      const user: SessionUser = JSON.parse(sessionData);
      await this.redis.srem(`${USER_SESSIONS_PREFIX}${user.id}`, sessionToken);
    }
    await this.redis.del(`${SESSION_PREFIX}${sessionToken}`);
  }

  /**
   * SuperAdmin: Kill ALL sessions for a specific user.
   * Instant deactivation — all their active sessions become invalid.
   */
  async killUserSessions(targetUserId: string): Promise<number> {
    const tokens = await this.redis.smembers(`${USER_SESSIONS_PREFIX}${targetUserId}`);
    if (tokens.length === 0) return 0;

    // Delete all session keys
    const sessionKeys = tokens.map((t) => `${SESSION_PREFIX}${t}`);
    await this.redis.del(...sessionKeys);

    // Clear the user's session set
    await this.redis.del(`${USER_SESSIONS_PREFIX}${targetUserId}`);

    return tokens.length;
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

    if (!user || user.status !== 'ACTIVE') {
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

    if (!user || user.status !== 'ACTIVE') {
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
