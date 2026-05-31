import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BRANCH_CONTEXT_REQUIRED_MESSAGE, authedProcedure, router } from './trpc';
import type { TrpcContext } from './context';

const testRouter = router({
  scopedMutation: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(z.object({ branchId: z.string().uuid().optional() }))
    .mutation(() => ({ ok: true })),
  regularMutation: authedProcedure
    .input(z.object({}))
    .mutation(() => ({ ok: true })),
});

function buildCtx(overrides?: Partial<TrpcContext>): TrpcContext {
  return {
    user: {
      id: '8a8d5664-c472-4cb2-b96c-ee66ef20e6ac',
      email: 'admin@yannis.test',
      name: 'Head of CS',
      role: 'HEAD_OF_CS',
      logisticsLocationId: null,
      permissions: [],
      currentBranchId: null,
      mirroredBy: null,
      mirrorSessionId: null,
    },
    req: {} as TrpcContext['req'],
    res: {} as TrpcContext['res'],
    sessionToken: null,
    currentBranchId: null,
    effectiveBranchIds: null,
    ...overrides,
  };
}

describe('branch-scoped mutation guard', () => {
  it('blocks org-wide head mutation in all-branches mode without branchId', async () => {
    const caller = testRouter.createCaller(buildCtx());
    await expect(caller.scopedMutation({})).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: BRANCH_CONTEXT_REQUIRED_MESSAGE,
    });
  });

  it('allows org-wide head mutation in all-branches mode when branchId is provided', async () => {
    const caller = testRouter.createCaller(buildCtx());
    await expect(
      caller.scopedMutation({ branchId: 'dc0c7751-4923-4aaf-8df0-6a8f3ffef093' }),
    ).resolves.toEqual({ ok: true });
  });

  it('does not block non-branch-scoped mutations in all-branches mode', async () => {
    const caller = testRouter.createCaller(buildCtx());
    await expect(caller.regularMutation({})).resolves.toEqual({ ok: true });
  });
});
