import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  canonicalPermissionCode,
  type ListStaffOnboardingDocumentsInput,
  type UpdateOnboardingProfileInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Staff Onboarding service — record-keeping for HR profile data.
 *
 * Core invariants:
 *  • The user's account stays ACTIVE regardless of onboarding status. This flow
 *    does not block login or anything in the app — it's an HR record.
 *  • Staff can edit their own onboarding while NOT_STARTED / IN_PROGRESS.
 *    Once SUBMITTED or APPROVED the form locks for staff (HR reviews read-only on `/hr/users/:id/onboarding`).
 *  • Only the staff member may update or submit their onboarding (`update` / `submit` as self).
 *    HR / admin approve via `approve` (`hr.onboarding.approve` or admin-class).
 *  • A `staff_onboarding` row is lazily created the first time a user opens
 *    their onboarding page, so we don't carry a 1-to-1 row from user creation.
 */
@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
  ) {}

  private actorHasPermission(actor: SessionUser, code: string): boolean {
    const required = canonicalPermissionCode(code);
    const have = (actor.permissions ?? []).map((c) => canonicalPermissionCode(c));
    return have.includes(required);
  }

  private canManageAnyOnboarding(actor: SessionUser): boolean {
    return (
      actor.role === 'SUPER_ADMIN' ||
      this.actorHasPermission(actor, 'hr.onboarding.write') ||
      this.actorHasPermission(actor, 'hr.onboarding.read') ||
      this.actorHasPermission(actor, 'hr.onboarding.approve')
    );
  }

  private canApproveOnboarding(actor: SessionUser): boolean {
    return actor.role === 'SUPER_ADMIN' || this.actorHasPermission(actor, 'hr.onboarding.approve');
  }

  /**
   * Read the onboarding row for a target user. Self-read is always allowed;
   * cross-user read requires `hr.onboarding.read` or admin-class. If no row
   * exists yet, returns a synthetic NOT_STARTED placeholder so the UI can
   * render an empty form.
   */
  async getForUser(targetUserId: string, actor: SessionUser) {
    if (targetUserId !== actor.id && !this.canManageAnyOnboarding(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only view your own onboarding record.',
      });
    }
    const [row] = await this.db
      .select()
      .from(schema.staffOnboarding)
      .where(eq(schema.staffOnboarding.userId, targetUserId))
      .limit(1);

    if (!row) {
      return {
        userId: targetUserId,
        status: 'NOT_STARTED' as const,
        gender: null,
        dateOfBirth: null,
        residentialAddress: null,
        proofOfAddressUrl: null,
        supportingDocuments: [] as Array<{ label: string; url: string }>,
        guarantor1Name: null,
        guarantor1Phone: null,
        guarantor1Email: null,
        guarantor1Address: null,
        guarantor1Relationship: null,
        guarantor1LetterUrl: null,
        guarantor2Name: null,
        guarantor2Phone: null,
        guarantor2Email: null,
        guarantor2Address: null,
        guarantor2Relationship: null,
        guarantor2LetterUrl: null,
        submittedAt: null,
        approvedAt: null,
        approvedBy: null,
      };
    }
    return row;
  }

  /**
   * Upsert the onboarding draft. If the row doesn't exist we create it; we
   * also bump status from NOT_STARTED → IN_PROGRESS as soon as any field is
   * touched, so the popup nudge knows the user has engaged.
   */
  async updateProfile(
    targetUserId: string,
    input: UpdateOnboardingProfileInput,
    actor: SessionUser,
  ) {
    if (targetUserId !== actor.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the staff member can update onboarding details from their own session.',
      });
    }

    return withActor(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.staffOnboarding)
        .where(eq(schema.staffOnboarding.userId, targetUserId))
        .limit(1);

      if (existing && (existing.status === 'SUBMITTED' || existing.status === 'APPROVED')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            existing.status === 'APPROVED'
              ? 'Your onboarding has been approved and is locked. Contact HR for changes.'
              : 'Your onboarding is awaiting HR review and is locked for edits.',
        });
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      const setIfPresent = (key: keyof UpdateOnboardingProfileInput, dbCol: string) => {
        const value = input[key];
        if (value === undefined) return;
        // Treat empty string as null for clean DB storage of optional text.
        patch[dbCol] = value === '' ? null : value;
      };

      setIfPresent('gender', 'gender');
      setIfPresent('dateOfBirth', 'dateOfBirth');
      setIfPresent('residentialAddress', 'residentialAddress');
      setIfPresent('proofOfAddressUrl', 'proofOfAddressUrl');
      if (input.supportingDocuments !== undefined) {
        patch['supportingDocuments'] = input.supportingDocuments;
      }
      setIfPresent('guarantor1Name', 'guarantor1Name');
      setIfPresent('guarantor1Phone', 'guarantor1Phone');
      setIfPresent('guarantor1Email', 'guarantor1Email');
      setIfPresent('guarantor1Address', 'guarantor1Address');
      setIfPresent('guarantor1Relationship', 'guarantor1Relationship');
      setIfPresent('guarantor1LetterUrl', 'guarantor1LetterUrl');
      setIfPresent('guarantor2Name', 'guarantor2Name');
      setIfPresent('guarantor2Phone', 'guarantor2Phone');
      setIfPresent('guarantor2Email', 'guarantor2Email');
      setIfPresent('guarantor2Address', 'guarantor2Address');
      setIfPresent('guarantor2Relationship', 'guarantor2Relationship');
      setIfPresent('guarantor2LetterUrl', 'guarantor2LetterUrl');

      if (existing) {
        // Bump NOT_STARTED → IN_PROGRESS on first edit.
        if (existing.status === 'NOT_STARTED') {
          patch['status'] = 'IN_PROGRESS';
        }
        const [updated] = await tx
          .update(schema.staffOnboarding)
          .set(patch)
          .where(eq(schema.staffOnboarding.userId, targetUserId))
          .returning();
        return updated!;
      }

      const [inserted] = await tx
        .insert(schema.staffOnboarding)
        .values({
          userId: targetUserId,
          status: 'IN_PROGRESS',
          ...patch,
        } as typeof schema.staffOnboarding.$inferInsert)
        .returning();
      return inserted!;
    });
  }

  /**
   * Move the record to SUBMITTED — locks it for the staff member. Only self-submit.
   *
   * Required fields at submission: gender, DOB, residential address, proof of
   * address, both guarantors with at least name + phone + letter URL.
   */
  async submit(targetUserId: string, actor: SessionUser) {
    if (targetUserId !== actor.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the staff member can submit their own onboarding.',
      });
    }

    const submitted = await withActor(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.staffOnboarding)
        .where(eq(schema.staffOnboarding.userId, targetUserId))
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Fill in your onboarding details before submitting.',
        });
      }
      if (existing.status === 'APPROVED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This onboarding is already approved.',
        });
      }
      if (existing.status === 'SUBMITTED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This onboarding is already submitted and awaiting HR review.',
        });
      }

      const missing: string[] = [];
      if (!existing.gender) missing.push('gender');
      if (!existing.dateOfBirth) missing.push('date of birth');
      if (!existing.residentialAddress) missing.push('residential address');
      if (!existing.proofOfAddressUrl) missing.push('proof of address');
      if (!existing.guarantor1Name || !existing.guarantor1Phone || !existing.guarantor1LetterUrl) {
        missing.push('guarantor 1 (name, phone, signed letter)');
      }
      if (!existing.guarantor2Name || !existing.guarantor2Phone || !existing.guarantor2LetterUrl) {
        missing.push('guarantor 2 (name, phone, signed letter)');
      }
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot submit yet — missing: ${missing.join(', ')}.`,
        });
      }

      const [updated] = await tx
        .update(schema.staffOnboarding)
        .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.staffOnboarding.userId, targetUserId))
        .returning();
      return updated!;
    });

    // Notify HR_MANAGERs that there's a new onboarding awaiting review. Best-
    // effort — never block the submission on notification failure.
    this.notifications
      .createForRole('HR_MANAGER', {
        type: 'hr:onboarding_submitted',
        title: 'Onboarding submitted for review',
        body: `${actor.name ?? 'A staff member'} submitted their onboarding profile.`,
        data: { userId: targetUserId },
      })
      .catch(() => {});

    return submitted;
  }

  /** Approve a submitted record. Locks edits for staff permanently. */
  async approve(targetUserId: string, actor: SessionUser) {
    if (!this.canApproveOnboarding(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only HR or an admin can approve onboarding records.',
      });
    }
    if (targetUserId === actor.id) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You cannot approve your own onboarding.',
      });
    }

    const approved = await withActor(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.staffOnboarding)
        .where(eq(schema.staffOnboarding.userId, targetUserId))
        .limit(1);
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No onboarding record exists for this user.',
        });
      }
      if (existing.status === 'APPROVED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This onboarding is already approved.',
        });
      }
      if (existing.status !== 'SUBMITTED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only submitted onboarding records can be approved.',
        });
      }
      const [updated] = await tx
        .update(schema.staffOnboarding)
        .set({
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.staffOnboarding.userId, targetUserId))
        .returning();
      return updated!;
    });

    this.notifications
      .create({
        userId: targetUserId,
        type: 'hr:onboarding_approved',
        title: 'Onboarding approved',
        body: 'Your onboarding profile has been approved by HR.',
        data: { userId: targetUserId },
      })
      .catch(() => {});

    return approved;
  }

  /**
   * HR overview: paginated staff directory with effective onboarding status
   * (`NOT_STARTED` when there is no `staff_onboarding` row yet). Branch scoping
   * mirrors `UsersService.list`.
   */
  async listStaffDocuments(
    input: ListStaffOnboardingDocumentsInput,
    actor: SessionUser,
    currentBranchId: string | null,
  ) {
    if (!this.canManageAnyOnboarding(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to view staff onboarding records.',
      });
    }

    const conditions = [];

    if (!input.userStatus) {
      conditions.push(ne(schema.users.status, 'DEACTIVATED'));
    } else {
      conditions.push(eq(schema.users.status, input.userStatus));
    }

    const canViewAllBranches =
      actor.role === 'SUPER_ADMIN' ||
      (actor.permissions ?? []).includes(canonicalPermissionCode('branches.manage'));
    const skipBranchScope = input.allBranches === true && canViewAllBranches;
    const branchFilter = skipBranchScope ? input.branchId : (input.branchId ?? currentBranchId ?? undefined);

    if (branchFilter) {
      conditions.push(
        sql<boolean>`EXISTS (
          SELECT 1
          FROM user_branches ub
          WHERE ub.user_id = ${schema.users.id}
            AND ub.branch_id = ${branchFilter}
        )`,
      );
    }

    if (input.search) {
      conditions.push(
        or(
          ilike(schema.users.name, `%${input.search}%`),
          ilike(schema.users.email, `%${input.search}%`),
        ),
      );
    }

    if (input.onboardingStatus !== 'ALL') {
      if (input.onboardingStatus === 'NOT_STARTED') {
        conditions.push(
          or(isNull(schema.staffOnboarding.id), eq(schema.staffOnboarding.status, 'NOT_STARTED')),
        );
      } else {
        conditions.push(eq(schema.staffOnboarding.status, input.onboardingStatus));
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const effectiveStatusSql = sql<string>`COALESCE(${schema.staffOnboarding.status}::text, 'NOT_STARTED')`;
    const sortKeySql = sql`COALESCE(${schema.staffOnboarding.updatedAt}, ${schema.users.updatedAt})`;

    const orderByExpr =
      input.sortBy === 'name'
        ? input.sortOrder === 'asc'
          ? asc(schema.users.name)
          : desc(schema.users.name)
        : input.sortOrder === 'asc'
          ? asc(sortKeySql)
          : desc(sortKeySql);

    const offset = (input.page - 1) * input.limit;

    const baseQuery = this.db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        primaryBranchId: schema.users.primaryBranchId,
        primaryBranchName: schema.branches.name,
        onboardingStatus: effectiveStatusSql,
        submittedAt: schema.staffOnboarding.submittedAt,
        approvedAt: schema.staffOnboarding.approvedAt,
        onboardingUpdatedAt: sortKeySql,
      })
      .from(schema.users)
      .leftJoin(schema.staffOnboarding, eq(schema.users.id, schema.staffOnboarding.userId))
      .leftJoin(schema.branches, eq(schema.users.primaryBranchId, schema.branches.id))
      .where(whereClause)
      .orderBy(orderByExpr)
      .limit(input.limit)
      .offset(offset);

    const countQuery = this.db
      .select({ count: count() })
      .from(schema.users)
      .leftJoin(schema.staffOnboarding, eq(schema.users.id, schema.staffOnboarding.userId))
      .where(whereClause);

    const [rows, totalRows] = await Promise.all([baseQuery, countQuery]);

    const total = Number(totalRows[0]?.count ?? 0);

    return {
      rows: rows.map((r) => ({
        ...r,
        onboardingStatus: r.onboardingStatus as
          | 'NOT_STARTED'
          | 'IN_PROGRESS'
          | 'SUBMITTED'
          | 'APPROVED',
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }
}
