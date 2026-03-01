import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import type { SessionUser } from '../common/decorators/current-user.decorator';

const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';
const RATE_LIMIT_PREFIX = 'login_rate:';
const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly sessionTtl: number;
  private readonly maxLoginAttempts: number;
  private readonly rateLimitWindow: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
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
