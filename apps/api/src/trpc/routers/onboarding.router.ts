/**
 * Staff onboarding tRPC router (Phase 22).
 *
 * Procedures:
 *  - get          — caller's own record (or HR/admin reads any user)
 *  - update       — caller updates own record (or HR/admin updates anyone)
 *  - submit       — caller submits own draft for HR review
 *  - approve      — HR (or admin) marks a submitted record APPROVED
 *
 * Authorization:
 *  - Self-read / self-edit / self-submit: any authenticated user (`authedProcedure`).
 *    Service-layer logic enforces lock-after-submit / lock-after-approve for staff.
 *  - HR-side reads / edits / approvals: gated by `hr.onboarding.read` /
 *    `hr.onboarding.write` / `hr.onboarding.approve` permissions, or admin-class.
 *  - Admin-class always passes via `permissionProcedure`'s built-in bypass + the
 *    service's `isAdminLevel` checks.
 */

import { TRPCError } from '@trpc/server';
import {
  updateOnboardingProfileSchema,
  hrUpdateOnboardingSchema,
  submitOnboardingSchema,
  approveOnboardingSchema,
  getOnboardingSchema,
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

  /**
   * HR-side update — may target any user. Service enforces
   * `hr.onboarding.write` / admin-class.
   */
  hrUpdate: authedProcedure.input(hrUpdateOnboardingSchema).mutation(async ({ input, ctx }) => {
    const { userId, ...patch } = input;
    return getService().updateProfile(userId, patch, ctx.user);
  }),

  /** Submit — defaults to self; HR may submit on behalf if userId is provided. */
  submit: authedProcedure.input(submitOnboardingSchema).mutation(async ({ input, ctx }) => {
    const targetId = input.userId ?? ctx.user.id;
    return getService().submit(targetId, ctx.user);
  }),

  /** Approve — HR / admin only. */
  approve: authedProcedure.input(approveOnboardingSchema).mutation(async ({ input, ctx }) => {
    return getService().approve(input.userId, ctx.user);
  }),
});
