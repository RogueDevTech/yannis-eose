import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { canMirror, canViewAllBranches, isAdminLevel } from '../common/authz';
import { and, eq, inArray, isNull, sql, desc, asc } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { SessionStoreService } from './session-store.service';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { PermissionsService } from '../permissions/permissions.service';
import { withActor } from '../common/db/with-actor';

/**
 * Pick session branch: prefer `users.primary_branch_id` when it matches a membership,
 * else first row (ordered `is_primary` DESC, `branch_id` ASC — stable fallback when no primary flag).
 */
function resolveSessionBranchIdFromMemberships(
  memberships: Array<{ branchId: string; isPrimary: boolean }>,
  primaryBranchId: string | null | undefined,
): string | null {
  if (memberships.length === 0) return null;
  if (primaryBranchId) {
    const hit = memberships.find((m) => m.branchId === primaryBranchId);
    if (hit) return hit.branchId as string;
  }
  return memberships[0]!.branchId as string;
}

const RATE_LIMIT_PREFIX = 'login_rate:';
const RESET_TOKEN_PREFIX = 'pwd_reset:';
const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL = 1800; // 30 minutes

/**
 * CEO directive: every session expires at 23:59 local time on the calendar day the
 * user signed in. Africa/Lagos is UTC+1 with no DST, so we compute end-of-day in
 * Lagos and convert back to UTC seconds-from-now. Override the offset hours via
 * `SESSION_DAILY_EXPIRY_TZ_OFFSET_HOURS` if the tenant relocates.
 *
 * Floor of 60s so a login at 23:59:30 still creates a usable session (it just
 * rolls over very soon after).
 */
function secondsUntilEndOfLocalDay(): number {
  const offsetHours = parseFloat(process.env['SESSION_DAILY_EXPIRY_TZ_OFFSET_HOURS'] ?? '1');
  const offsetMs = offsetHours * 3_600_000;
  const nowMs = Date.now();
  const localMs = nowMs + offsetMs;
  const localNow = new Date(localMs);
  const localEod = new Date(
    Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
  const eodUtcMs = localEod.getTime() - offsetMs;
  return Math.max(60, Math.ceil((eodUtcMs - nowMs) / 1000));
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessionTtl: number;
  /**
   * Extended session TTL used when the user opts into "Remember me" at sign-in.
   * Defaults to 30 days; override with SESSION_TTL_REMEMBER_SECONDS.
   */
  private readonly sessionTtlRemember: number;
  private readonly maxLoginAttempts: number;
  private readonly rateLimitWindow: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
    private readonly sessionStore: SessionStoreService,
    private readonly branchTeams: BranchTeamsService,
    private readonly permissions: PermissionsService,
  ) {
    this.sessionTtl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10); // 24 hours
    this.sessionTtlRemember = parseInt(
      process.env['SESSION_TTL_REMEMBER_SECONDS'] ?? '2592000', // 30 days
      10,
    );
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
    rememberMe = false,
  ): Promise<{ token: string; user: SessionUser; ttlSeconds: number }> {
    // Rate limit check
    await this.checkRateLimit(clientIp);

    // Find user by email
    const [user] = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        status: schema.users.status,
        passwordHash: schema.users.passwordHash,
        logisticsLocationId: schema.users.logisticsLocationId,
        appTheme: schema.users.appTheme,
        fontScale: schema.users.fontScale,
        roleTemplateId: schema.users.roleTemplateId,
        scopeGlobal: schema.users.scopeGlobal,
        scopeOrgWideHead: schema.users.scopeOrgWideHead,
        scopeTeamSupervisor: schema.users.scopeTeamSupervisor,
        primaryBranchId: schema.users.primaryBranchId,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);

    if (!user) {
      await this.recordFailedAttempt(clientIp);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Only PENDING (invited, never logged in) and ACTIVE can log in
    if (user.status === 'DEACTIVATED') {
      throw new ForbiddenException('Account is deactivated. Contact an administrator to be reactivated.');
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

    // Generate session token
    const token = randomBytes(32).toString('hex');

    // Resolve primary branch for multi-branch context.
    // Non-global users MUST have at least one user_branches row — no membership = login denied.
    //
    // CEO directive (2026-05-09): every user — including admin-class and org-wide
    // department heads — lands on their PRIMARY branch by default. They still have
    // org-wide visibility (`canViewAllBranches` unchanged) and can flip the branch
    // switcher to "All branches" or any other branch any time. Previously admin-class
    // + org-wide heads landed at `currentBranchId = null` (All branches), which forced
    // a "Pick a branch" prompt on every branch-scoped mutation; landing on the primary
    // matches the CEO's mental model and skips the prompt for the common case.
    //
    // Membership order: primary flag first, then stable branch UUID — so when no row is
    // marked primary, we still land on a deterministic "first" branch. Prefer
    // `users.primary_branch_id` when it matches a membership (covers drift vs `is_primary`).
    // SuperAdmin / Admin without any branch assignment fall through to `null` (All branches).
    let currentBranchId: string | null = null;
    const memberships = await this.db
      .select({ branchId: schema.userBranches.branchId, isPrimary: schema.userBranches.isPrimary })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, user.id))
      .orderBy(desc(schema.userBranches.isPrimary), asc(schema.userBranches.branchId));

    if (!canViewAllBranches(user)) {
      if (memberships.length === 0) {
        throw new UnauthorizedException(
          'Your account has not been assigned to a branch. Contact your administrator.',
        );
      }
      // Media Buyers with a single branch default to that branch so supervisor
      // features and branch-scoped pages work immediately. Multi-branch MBs
      // default to "All Branches" and can narrow via the header switcher.
      if (user.role === 'MEDIA_BUYER') {
        currentBranchId = memberships.length === 1
          ? memberships[0]!.branchId as string
          : null;
      } else {
        currentBranchId = resolveSessionBranchIdFromMemberships(memberships, user.primaryBranchId);
      }
    }
    // Global users (admin-class, org-wide heads) default to null = "All Branches".
    // They can narrow via the header switcher.

    // Resolve effective permissions at sign-in time so the very first request after the
    // login redirect (e.g. `requirePermission(...)` on `/admin/logistics/...`) sees the
    // user's role-template grants. Without this the session lands in Redis with
    // `permissions: undefined` and any caller that reads the session BEFORE `/auth/me`
    // refreshes (or that doesn't refresh at all) thinks the user has zero permissions.
    // The trpc middleware + /auth/me both refresh on every call, so this is mostly a
    // belt-and-braces guarantee — but it also fixes "first login lands on Permission
    // required" for newly-invited users.
    const initialPermissions = await this.permissions.getEffectivePermissions(user.id);

    // Resolve activeGroupId from the branch the user lands on.
    // Multi-group users MUST always land in a specific group — never "all groups".
    // Cross-group data mixing is data corruption.
    let activeGroupId: string | null = null;
    let selectedBranchIds: string[] | null = null;
    if (currentBranchId) {
      const [branchRow] = await this.db
        .select({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(eq(schema.branches.id, currentBranchId))
        .limit(1);
      activeGroupId = branchRow?.groupId ?? null;
    } else if (memberships.length > 0) {
      const memberBranchIds = memberships.map((m) => m.branchId as string);
      const groupRows = await this.db
        .selectDistinct({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(inArray(schema.branches.id, memberBranchIds));
      const validGroups = groupRows.filter((g) => g.groupId != null);
      if (validGroups.length > 0) {
        activeGroupId = validGroups[0]!.groupId;
      }
    }
    // Global users (SuperAdmin/Admin) with no memberships: resolve from branch_groups directly
    if (!activeGroupId && canViewAllBranches(user)) {
      const [firstGroup] = await this.db
        .select({ id: schema.branchGroups.id })
        .from(schema.branchGroups)
        .where(eq(schema.branchGroups.status, 'ACTIVE'))
        .orderBy(asc(schema.branchGroups.createdAt))
        .limit(1);
      if (firstGroup) activeGroupId = firstGroup.id;
    }
    // Resolve the group's branch IDs so effectiveBranchIds is correctly scoped on login.
    // Only truly global users (SuperAdmin/Admin/scopeGlobal) see all branches in the group.
    // Everyone else — including HoM/HoCS/HoL — only sees their assigned branches.
    if (activeGroupId) {
      const groupBranches = await this.db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(eq(schema.branches.groupId, activeGroupId));
      const allGroupIds = groupBranches.map((b) => b.id);
      const memberBranchIds = memberships.map((m) => m.branchId as string);
      if (isAdminLevel(user) || user.scopeGlobal) {
        selectedBranchIds = allGroupIds;
      } else if (memberBranchIds.length > 0) {
        const scoped = allGroupIds.filter((id) => memberBranchIds.includes(id));
        selectedBranchIds = scoped.length > 0 ? scoped : allGroupIds;
      } else {
        selectedBranchIds = allGroupIds;
      }
    }

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roleTemplateId: user.roleTemplateId ?? null,
      scopeGlobal: user.scopeGlobal === true,
      scopeOrgWideHead: user.scopeOrgWideHead === true,
      scopeTeamSupervisor: user.scopeTeamSupervisor === true,
      permissions: Array.from(initialPermissions),
      logisticsLocationId: user.logisticsLocationId,
      currentBranchId,
      activeGroupId,
      selectedBranchIds,
      // Captured here so the tRPC branch-scope guard can fall back to the
      // sole branch for single-branch org-wide heads instead of throwing.
      branchIds: memberships.map((m) => m.branchId as string),
      appTheme: user.appTheme ?? null,
      fontScale: user.fontScale ?? null,
    };

    // CEO directive: sessions ALWAYS expire at 23:59 local time on the calendar day
    // the user signed in, regardless of remember-me. The remember-me flag is now
    // strictly a hint to the client to remember the email locally — it does NOT
    // extend session TTL beyond today. The `rememberMe` parameter and
    // `sessionTtlRemember` config are kept for backwards compatibility with older
    // tenants that may still want extended sessions; flip the env
    // `SESSION_DAILY_EXPIRY_DISABLED=true` to fall back to the old rolling TTL.
    const dailyExpiryDisabled = process.env['SESSION_DAILY_EXPIRY_DISABLED'] === 'true';
    const ttlSeconds = dailyExpiryDisabled
      ? rememberMe
        ? this.sessionTtlRemember
        : this.sessionTtl
      : secondsUntilEndOfLocalDay();

    // Bump login_count + last_login_at as the signing-in user; first login also moves
    // PENDING → ACTIVE in the same transaction so temporal audit records modified_by (never bare pool writes → "System").
    try {
      await withActor(this.db, sessionUser, async (tx) => {
        await tx
          .update(schema.users)
          .set({
            ...(user.status === 'PENDING' ? { status: 'ACTIVE' as const } : {}),
            loginCount: sql`${schema.users.loginCount} + 1`,
            lastLoginAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, user.id));
      });
    } catch (err) {
      // Login attribution is best-effort — if the audit write fails the user can still
      // sign in. Surface the error in logs so we notice if the trigger / column drifts.
      this.logger.warn(
        `login_audit_write_failed user=${user.id} reason=${(err as Error).message}`,
      );
    }

    // Persist session in DB, then cache in Redis when available.
    await this.sessionStore.createSession(token, sessionUser, ttlSeconds);

    return { token, user: sessionUser, ttlSeconds };
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
   * Push changed branch memberships onto the user's live sessions WITHOUT a
   * forced logout — used after a branch add/remove so access reflects the new
   * memberships on the very next request. Deactivation still uses
   * `killUserSessions` (the user must be logged out entirely).
   */
  async refreshUserBranchSessions(targetUserId: string): Promise<number> {
    return this.sessionStore.refreshUserBranchMemberships(targetUserId);
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
      throw new ForbiddenException('Already in mirror mode. Exit current mirror first.');
    }

    const targetRows = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        status: schema.users.status,
        logisticsLocationId: schema.users.logisticsLocationId,
        appTheme: schema.users.appTheme,
        fontScale: schema.users.fontScale,
        primaryBranchId: schema.users.primaryBranchId,
        roleTemplateId: schema.users.roleTemplateId,
        scopeGlobal: schema.users.scopeGlobal,
        scopeOrgWideHead: schema.users.scopeOrgWideHead,
        scopeTeamSupervisor: schema.users.scopeTeamSupervisor,
      })
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

    const actorPermSet = await this.permissions.getEffectivePermissions(actor.id);
    const syncMirror = canMirror(
      {
        id: actor.id,
        role: actor.role,
        permissions: Array.from(actorPermSet),
        currentBranchId: actor.currentBranchId,
        mirroredBy: actor.mirroredBy,
      },
      { id: target.id, role: target.role, primaryBranchId: target.primaryBranchId },
    );
    const viaSupervision =
      !syncMirror &&
      (await this.branchTeams.actorCanMirrorViaSupervision(
        { id: actor.id, currentBranchId: actor.currentBranchId },
        { id: target.id, role: target.role },
      ));
    if (!syncMirror && !viaSupervision) {
      throw new ForbiddenException('You are not allowed to mirror this user.');
    }

    // Resolve branch context to match `login` (CEO 2026-05-09): any user with branch
    // membership defaults to primary / first branch so supervisor flags and branch-scoped
    // mutations see a concrete `currentBranchId`. Global users with zero memberships keep
    // null (all-branches). Mirror previously only set a branch when global + exactly one
    // membership — that left HoM-style globals with 2+ branches at null and broke
    // `isMarketingTeamSupervisorOnActiveBranch` + Remix loaders vs real login.
    let currentBranchId: string | null = null;
    const targetPermSet = await this.permissions.getEffectivePermissions(target.id);
    const targetIsGlobal = canViewAllBranches({
      role: target.role,
      permissions: Array.from(targetPermSet),
    });
    const targetMemberships = await this.db
      .select({ branchId: schema.userBranches.branchId, isPrimary: schema.userBranches.isPrimary })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, target.id))
      .orderBy(desc(schema.userBranches.isPrimary), asc(schema.userBranches.branchId));

    if (!targetIsGlobal) {
      if (targetMemberships.length === 0) {
        throw new BadRequestException('Target user has no branch — cannot mirror.');
      }
      if (target.role === 'MEDIA_BUYER') {
        // Single-branch MBs default to that branch so supervisor features and
        // branch-scoped pages work immediately — matches login flow.
        currentBranchId = targetMemberships.length === 1
          ? targetMemberships[0]!.branchId as string
          : null;
      } else {
        currentBranchId = resolveSessionBranchIdFromMemberships(targetMemberships, target.primaryBranchId);
      }
    }
    // Global users (org-wide heads, admins) default to null = "All Branches".
    // They can narrow via the header switcher.

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

    // Resolve activeGroupId + selectedBranchIds for the mirrored session,
    // same as the login flow — without this the header branch switcher can't
    // determine which company group is active.
    let mirrorActiveGroupId: string | null = null;
    let mirrorSelectedBranchIds: string[] | null = null;
    if (currentBranchId) {
      const [branchRow] = await this.db
        .select({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(eq(schema.branches.id, currentBranchId))
        .limit(1);
      mirrorActiveGroupId = branchRow?.groupId ?? null;
    } else if (targetMemberships.length > 0) {
      const memberBranchIds = targetMemberships.map((m) => m.branchId as string);
      const groupRows = await this.db
        .selectDistinct({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(inArray(schema.branches.id, memberBranchIds));
      const validGroups = groupRows.filter((g) => g.groupId != null);
      if (validGroups.length > 0) mirrorActiveGroupId = validGroups[0]!.groupId;
    }
    if (mirrorActiveGroupId) {
      const groupBranches = await this.db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(eq(schema.branches.groupId, mirrorActiveGroupId));
      const allGroupIds = groupBranches.map((b) => b.id);
      const memberBranchIds = targetMemberships.map((m) => m.branchId as string);
      if (isAdminLevel(target) || target.scopeGlobal) {
        mirrorSelectedBranchIds = allGroupIds;
      } else if (memberBranchIds.length > 0) {
        const scoped = allGroupIds.filter((id) => memberBranchIds.includes(id));
        mirrorSelectedBranchIds = scoped.length > 0 ? scoped : allGroupIds;
      } else {
        mirrorSelectedBranchIds = allGroupIds;
      }
    }

    const mirroredSession: SessionUser = {
      id: target.id,
      email: target.email,
      name: target.name,
      role: target.role,
      roleTemplateId: target.roleTemplateId ?? null,
      scopeGlobal: target.scopeGlobal === true,
      scopeOrgWideHead: target.scopeOrgWideHead === true,
      scopeTeamSupervisor: target.scopeTeamSupervisor === true,
      // Same as login: tRPC `permissionProcedure` reads `ctx.user.permissions`
      // from the session payload — without this array every mirrored request
      // appears to have zero grants (false "Missing permission" UX).
      permissions: Array.from(targetPermSet),
      logisticsLocationId: target.logisticsLocationId,
      currentBranchId,
      activeGroupId: mirrorActiveGroupId,
      selectedBranchIds: mirrorSelectedBranchIds,
      branchIds: targetMemberships.map((m) => m.branchId as string),
      // Surface the target's appearance so the admin sees the app exactly as the
      // user would. The green border makes Mirror Mode obvious; the theme is part
      // of the read-only "live walkthrough".
      appTheme: target.appTheme ?? null,
      fontScale: target.fontScale ?? null,
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
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        logisticsLocationId: schema.users.logisticsLocationId,
        appTheme: schema.users.appTheme,
        fontScale: schema.users.fontScale,
        primaryBranchId: schema.users.primaryBranchId,
        roleTemplateId: schema.users.roleTemplateId,
        scopeGlobal: schema.users.scopeGlobal,
        scopeOrgWideHead: schema.users.scopeOrgWideHead,
        scopeTeamSupervisor: schema.users.scopeTeamSupervisor,
      })
      .from(schema.users)
      .where(eq(schema.users.id, originalActorId))
      .limit(1);
    const actor = actorRows[0];
    if (!actor) {
      throw new BadRequestException('Original actor no longer exists; please log in again.');
    }

    const actorPermSet = await this.permissions.getEffectivePermissions(actor.id);
    const memberships = await this.db
      .select({ branchId: schema.userBranches.branchId, isPrimary: schema.userBranches.isPrimary })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, actor.id))
      .orderBy(desc(schema.userBranches.isPrimary), asc(schema.userBranches.branchId));

    let currentBranchId: string | null = null;
    const actorGlobal = canViewAllBranches({
      role: actor.role,
      permissions: Array.from(actorPermSet),
    });
    if (!actorGlobal) {
      if (actor.role === 'MEDIA_BUYER') {
        // Single-branch MBs default to that branch — matches login flow.
        currentBranchId = memberships.length === 1
          ? memberships[0]!.branchId as string
          : null;
      } else {
        currentBranchId = resolveSessionBranchIdFromMemberships(memberships, actor.primaryBranchId);
      }
    }
    // Global users default to null = "All Branches".

    const restored: SessionUser = {
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      roleTemplateId: actor.roleTemplateId ?? null,
      scopeGlobal: actor.scopeGlobal === true,
      scopeOrgWideHead: actor.scopeOrgWideHead === true,
      scopeTeamSupervisor: actor.scopeTeamSupervisor === true,
      permissions: Array.from(actorPermSet),
      logisticsLocationId: actor.logisticsLocationId,
      currentBranchId,
      branchIds: memberships.map((m) => m.branchId as string),
      appTheme: actor.appTheme ?? null,
      fontScale: actor.fontScale ?? null,
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

    this.logger.log(`Password reset token generated for user ${user.id}`);
    void this.notifications
      .sendEmail({
        to: user.email,
        subject: 'Yannis EOSE — Password Reset',
        html,
        text,
      })
      .then((sent) => {
        if (!sent && process.env.NODE_ENV !== 'production') {
          this.logger.warn(
            `[dev] Password reset email was not delivered — use this link once: ${resetUrl}`,
          );
        }
      });
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

    // Update password with actor injection. `withActor` opens a drizzle
    // transaction and runs `SET LOCAL yannis.current_user_id` on the same pinned
    // connection as the UPDATE — without the transaction wrapper, postgres.js's
    // pool would land the UPDATE on a different connection and the audit trail
    // would attribute the password reset to "System" instead of the user.
    await withActor(this.db, { id: userId }, async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash })
        .where(eq(schema.users.id, userId));
    });

    // Invalidate the reset token (single-use)
    await this.redis.del(`${RESET_TOKEN_PREFIX}${token}`);

    // Kill all existing sessions for security
    await this.killUserSessions(userId);

    this.logger.log(`Password reset completed for user ${userId}`);
  }

  /**
   * Branch IDs a Media Buyer may scope their session to: current memberships
   * UNION every branch their own orders / campaigns are attributed to. A buyer
   * moved off a branch keeps it in this set so they can still open it as a
   * read-only data lens. Attribution is by ownership (`media_buyer_id`), so a
   * buyer never sees beyond their own data.
   */
  private async mediaBuyerBranchScopeIds(userId: string): Promise<string[]> {
    const [memberships, orderBranches, campaignBranches] = await Promise.all([
      this.db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.userId, userId)),
      this.db
        .selectDistinct({ branchId: schema.orders.branchId })
        .from(schema.orders)
        .where(eq(schema.orders.mediaBuyerId, userId)),
      this.db
        .selectDistinct({ branchId: schema.campaigns.branchId })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.mediaBuyerId, userId)),
    ]);
    const ids = new Set<string>();
    for (const r of [...memberships, ...orderBranches, ...campaignBranches]) {
      if (r.branchId) ids.add(r.branchId);
    }
    return [...ids];
  }

  /**
   * Switch the active branch in the current session.
   * User must be a member of the target branch (or admin-class). A Media Buyer
   * may additionally switch to any branch in their data footprint (branches
   * their own orders/campaigns are attributed to) as a read-only data lens.
   * `branchId = null` clears branch context ("All Branches"); allowed for
   * org-wide users and Media Buyers (whose orders are ownership-scoped, so
   * "All Branches" still only ever exposes their own data).
   * Updates Redis session and returns the full updated SessionUser so the
   * controller can re-issue the bundle cookie in the same response.
   */
  async switchBranch(sessionToken: string, branchId: string | null, selectedBranchIds?: string[] | null): Promise<SessionUser> {
    const sessionData = await this.sessionStore.getSession(sessionToken);
    if (!sessionData) {
      throw new UnauthorizedException('Session not found');
    }

    const user: SessionUser = sessionData;
    const isMediaBuyer = user.role === 'MEDIA_BUYER';

    if (branchId === null) {
      if (!canViewAllBranches(user) && !isMediaBuyer) {
        throw new ForbiddenException('Only org-wide users can clear branch context');
      }
    } else if (isMediaBuyer) {
      // A Media Buyer may switch to any branch in their data footprint — a
      // branch they were removed from stays reachable as a read-only lens.
      // Branch-scoped mutations there are blocked by the tRPC middleware
      // `blockMediaBuyerMutationsOutsideMemberBranch`.
      const scopeIds = await this.mediaBuyerBranchScopeIds(user.id);
      if (!scopeIds.includes(branchId)) {
        throw new ForbiddenException('You have no orders or campaigns in this branch');
      }
    } else if (!canViewAllBranches(user)) {
      // Scoped users must be a member of the target branch
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

    // Multi-branch selection: when selectedBranchIds is provided and non-empty,
    // store it on the session. Cleared when a single branch is selected or
    // when all branches are cleared. CEO directive 2026-06-10.
    const resolvedSelectedIds =
      selectedBranchIds && selectedBranchIds.length > 0 ? selectedBranchIds : null;

    // Resolve the active group from the branch. When branchId is set, look up
    // its group_id. When selectedBranchIds is set, derive from the first branch.
    // When null (All Branches), resolve from the user's memberships — if all
    // belong to one group, auto-set it (company-wide roles stay scoped).
    let activeGroupId: string | null = null;
    const groupLookupBranchId = branchId ?? resolvedSelectedIds?.[0] ?? null;
    if (groupLookupBranchId) {
      const [row] = await this.db
        .select({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(eq(schema.branches.id, groupLookupBranchId))
        .limit(1);
      activeGroupId = row?.groupId ?? null;
    } else if (user.branchIds?.length) {
      const groupRows = await this.db
        .selectDistinct({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(inArray(schema.branches.id, user.branchIds));
      if (groupRows.length === 1 && groupRows[0]?.groupId) {
        activeGroupId = groupRows[0].groupId;
      }
    }

    // Resolve the set of branch IDs this user is permitted to view within the
    // active group. For truly global users (SuperAdmin/Admin/scopeGlobal) that
    // is every branch in the group; everyone else — including HoM/HoCS/HoL — is
    // constrained to their assigned branches within the group.
    //
    // This permitted set is the TRUST BOUNDARY for effectiveBranchIds: a
    // client-supplied selectedBranchIds is never stored verbatim, it is always
    // intersected with this set. Otherwise a forged POST could widen the
    // session's effectiveBranchIds to branches in another company group and
    // bypass every downstream query scope. (Pillar 2/4.)
    let allGroupIds: string[] = [];
    let permittedGroupIds: string[] | null = null;
    if (activeGroupId) {
      const groupBranches = await this.db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(eq(schema.branches.groupId, activeGroupId));
      allGroupIds = groupBranches.map((b) => b.id);
      const scoped = (isAdminLevel(user) || user.scopeGlobal)
        ? allGroupIds
        : user.branchIds?.length
          ? allGroupIds.filter((id) => user.branchIds!.includes(id))
          : allGroupIds;
      // Never collapse to empty for a group view — fall back to the whole
      // group rather than accidentally going global.
      permittedGroupIds = scoped.length > 0 ? scoped : allGroupIds;
    }

    // The permitted allow-list to filter any client selection against. Global
    // users with no active group (SuperAdmin spanning groups) have no list —
    // they already see everything, so narrowing to their own selection is safe.
    const allowList = permittedGroupIds
      ?? ((isAdminLevel(user) || user.scopeGlobal) ? null : (user.branchIds ?? []));

    let groupBranchIds: string[] | null;
    if (resolvedSelectedIds) {
      // Client-supplied multi-branch selection — strip anything outside the
      // permitted set (foreign-group or non-member branches).
      const sanitized = allowList
        ? resolvedSelectedIds.filter((id) => allowList.includes(id))
        : resolvedSelectedIds;
      groupBranchIds = sanitized.length > 0 ? sanitized : null;
    } else if (permittedGroupIds && !branchId) {
      // Group-level view ("All Branches" within the active group). Scope to the
      // permitted set so effectiveBranchIds is correctly bounded.
      groupBranchIds = permittedGroupIds;
    } else {
      // A specific branch is selected — selectedBranchIds stays null so queries
      // scope to currentBranchId alone.
      groupBranchIds = null;
    }

    const updated: SessionUser = {
      ...user,
      currentBranchId: branchId,
      selectedBranchIds: groupBranchIds,
      activeGroupId,
    };
    await this.sessionStore.updateSession(sessionToken, updated, this.sessionTtl);

    return updated;
  }

  /**
   * Resolve activeGroupId from a set of branch IDs.
   * Returns the group ID if all branches belong to one group, null otherwise.
   */
  async resolveGroupFromBranches(branchIds: string[]): Promise<string | null> {
    if (!branchIds.length) return null;
    const rows = await this.db
      .selectDistinct({ groupId: schema.branches.groupId })
      .from(schema.branches)
      .where(inArray(schema.branches.id, branchIds));
    return rows.length === 1 && rows[0]?.groupId ? rows[0].groupId : null;
  }

  /**
   * Get all branch IDs belonging to a group.
   */
  async getGroupBranchIds(groupId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.groupId, groupId));
    return rows.map((r) => r.id);
  }

  /**
   * Get the first active branch group ID (for global users with no memberships).
   */
  async getFirstActiveGroupId(): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.branchGroups.id })
      .from(schema.branchGroups)
      .where(eq(schema.branchGroups.status, 'ACTIVE'))
      .orderBy(asc(schema.branchGroups.createdAt))
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * Patch activeGroupId + selectedBranchIds on an existing session.
   */
  async patchSessionGroupScope(sessionToken: string, groupId: string, selectedBranchIds: string[] | null): Promise<void> {
    const session = await this.sessionStore.getSession(sessionToken);
    if (!session) return;
    const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
    await this.sessionStore.updateSession(sessionToken, { ...session, activeGroupId: groupId, selectedBranchIds }, ttl);
  }

  /**
   * Patch activeGroupId on an existing session (one-shot backfill for stale sessions).
   */
  async patchSessionActiveGroupId(sessionToken: string, groupId: string): Promise<void> {
    const session = await this.sessionStore.getSession(sessionToken);
    if (!session) return;
    const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
    await this.sessionStore.updateSession(sessionToken, { ...session, activeGroupId: groupId }, ttl);
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
