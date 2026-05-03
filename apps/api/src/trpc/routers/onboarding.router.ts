/**
 * Staff onboarding tRPC router (Phase 22).
 *
 * Procedures:
 *  - get          — caller's own record (or HR/admin reads any user)
 *  - update       — caller updates own record only
 *  - hrUpdate     — same as update when `userId` is the caller; cross-user updates rejected in service
 *  - submit       — caller submits own draft for HR review
 *  - approve      — HR (or admin) marks a submitted record APPROVED
 *
 * Authorization:
 *  - Self-read / self-edit / self-submit: any authenticated user (`authedProcedure`).
 *    Service-layer logic enforces lock-after-submit / lock-after-approve for staff.
 *  - HR-side reads: `hr.onboarding.read` / write / approve permissions or admin-class (`get`, `listStaffDocuments`).
 *  - Cross-user field edits are not allowed — staff complete onboarding from `/admin/onboarding`.
 */

import { TRPCError } from '@trpc/server';
import {
  updateOnboardingProfileSchema,
  hrUpdateOnboardingSchema,
  submitOnboardingSchema,
  approveOnboardingSchema,
  getOnboardingSchema,
  listStaffOnboardingDocumentsSchema,
} from '@yannis/shared';
import { router, authedProcedure } from '../trpc';
import { OnboardingService } from '../../onboarding/onboarding.service';

let serviceInstance: OnboardingService | null = null;

export function setOnboardingService(service: OnboardingService) {
  serviceInstance = service;
}

function getService(): OnboardingService {
  if (!serviceInstance) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'OnboardingService not initialized.',
    });
  }
  return serviceInstance;
}

export const onboardingRouter = router({
  /** Self-read by default; pass `userId` to read someone else's (HR / admin only). */
  get: authedProcedure.input(getOnboardingSchema).query(async ({ input, ctx }) => {
    const targetId = input.userId ?? ctx.user.id;
    return getService().getForUser(targetId, ctx.user);
  }),

  /** Self-update — caller's own onboarding draft. */
  update: authedProcedure.input(updateOnboardingProfileSchema).mutation(async ({ input, ctx }) => {
    return getService().updateProfile(ctx.user.id, input, ctx.user);
  }),

  /** Legacy shape — only succeeds when `userId` is the authenticated user (same as `update`). */
  hrUpdate: authedProcedure.input(hrUpdateOnboardingSchema).mutation(async ({ input, ctx }) => {
    const { userId, ...patch } = input;
    return getService().updateProfile(userId, patch, ctx.user);
  }),

  /** Submit — self only (`userId` must match caller when provided). */
  submit: authedProcedure.input(submitOnboardingSchema).mutation(async ({ input, ctx }) => {
    const targetId = input.userId ?? ctx.user.id;
    return getService().submit(targetId, ctx.user);
  }),

  /** Approve — HR / admin only. */
  approve: authedProcedure.input(approveOnboardingSchema).mutation(async ({ input, ctx }) => {
    return getService().approve(input.userId, ctx.user);
  }),

  /** HR overview — staff × onboarding status (service enforces HR onboarding visibility). */
  listStaffDocuments: authedProcedure
    .input(listStaffOnboardingDocumentsSchema)
    .query(async ({ input, ctx }) => {
      return getService().listStaffDocuments(input, ctx.user, ctx.user.currentBranchId ?? null);
    }),
});
