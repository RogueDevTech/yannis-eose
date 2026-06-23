import {
  createFundingSchema,
  verifyFundingSchema,
  listFundingSchema,
  fundingStatusCountsSchema,
  fundingRequestStatusCountsSchema,
  fundingDirectionSummarySchema,
  listFundingRequestsSchema,
  getFundingBalanceSchema,
  approveFundingRequestSchema,
  rejectFundingRequestSchema,
  createAdSpendWithBranchSchema,
  createAdSpendBatchWithBranchSchema,
  listAdSpendSchema,
  listAdSpendGroupedSchema,
  adSpendStatusCountsSchema,
  approveAdSpendSchema,
  rejectAdSpendSchema,
  updateAdSpendSchema,
  previewAdSpendIntervalSchema,
  campaignOrderTotalForBatchSchema,
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
  listOfferTemplatesSchema,
  archiveAllOfferTemplatesForProductSchema,
  createOfferGroupSchema,
  updateOfferGroupSchema,
  listOfferGroupsSchema,
  getOfferGroupSchema,
  clearLegacyOfferTemplatesSchema,
  createCampaignProcedureSchema,
  updateCampaignSchema,
  listCampaignsSchema,
  logDailyAdSpendWithBranchSchema,
  updateDailyAdSpendSchema,
  fundingLedgerSchema,
  type ListFundingInput,
  type ListFundingRequestsInput,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, authedProcedure, permissionProcedure } from '../trpc';
import { MarketingService } from '../../marketing/marketing.service';
import { getBranchTeamsService, listBranchesForUser } from './branches.router';
import {
  applySupervisorScope,
  buildOrdersListOpts,
  getOrdersService,
  isOrgWideMarketingViewer,
  narrowOrdersAggregateFiltersForViewer,
} from './orders.router';
import { getProductsService } from './products.router';
import { getUsersService } from './users.router';
import { getCartService } from './cart.router';
import { getCartOrdersService } from './cart-orders.router';
import { isAdminLevel } from '../../common/authz';
import { hasFinanceAccess } from '../../common/utils/strip-finance-fields';
import type { SessionUser } from '../../common/decorators/current-user.decorator';
import type { OrdersAggregateSupervisorScope } from '../../orders/orders.service';

let marketingServiceInstance: MarketingService | null = null;

export function setMarketingService(service: MarketingService) {
  marketingServiceInstance = service;
}

/** Exported for cross-router lookups (e.g. finance `overviewPageBundle`). */
export function getMarketingService(): MarketingService {
  if (!marketingServiceInstance) {
    throw new Error('MarketingService not initialized. Call setMarketingService() first.');
  }
  return marketingServiceInstance;
}

/**
 * Phase B: when a non-admin / non-org-wide caller is a Marketing supervisor on
 * the active branch, scope marketing list/count queries (ad spend, campaigns,
 * etc.) to their team — supervisor + supervised MBs.
 *
 * Skips when the caller already pins a specific `mediaBuyerId` (e.g. an MB
 * seeing their own, or HoM filtering by buyer in the dropdown).
 *
 * Important: gated on supervisor STATUS, not supervisee count. A supervisor
 * of a freshly-created empty team gets scoped to `[self]` — they see only
 * their own forms / spend until they assign MBs to the team. The previous
 * behaviour returned `input` unchanged in that case, which let an empty-team
 * supervisor see ALL campaigns in the branch (because the query then ran
 * with no buyer filter at all).
 */
async function applyMarketingSupervisorScope<
  T extends { mediaBuyerId?: string; mediaBuyerIds?: string[] },
>(
  ctx: { user: SessionUser; currentBranchId: string | null },
  input: T,
): Promise<T> {
  const branchId = ctx.currentBranchId;
  if (!branchId) return input;
  if (input.mediaBuyerId) return input;
  if (input.mediaBuyerIds) return input;
  const perms = ctx.user.permissions ?? [];
  if (perms.includes('marketing.scope.global')) return input;
  if (isAdminLevel(ctx.user)) return input;
  if (ctx.user.role === 'HEAD_OF_MARKETING') return input;
  const teams = getBranchTeamsService();
  const isSupervisor = await teams.isMarketingSupervisorOnBranch(ctx.user.id, branchId);
  if (!isSupervisor) return input;
  const scope = await teams.listSupervisorScopeIds(ctx.user.id, branchId);
  // `marketingUserIds` already includes the actor.
  return {
    ...input,
    mediaBuyerIds: scope.marketingUserIds,
  };
}

function seesFullMarketingTeamSurfaces(user: SessionUser): boolean {
  if (isAdminLevel(user)) return true;
  if (user.role === 'HEAD_OF_MARKETING') return true;
  return (user.permissions ?? []).includes('marketing.teamOverview');
}

/** HoM-class / perm holders, or branch marketing supervisor with an active branch session. */
function assertMarketingTeamSurfacesAccess(ctx: { user: SessionUser; currentBranchId: string | null }) {
  if (seesFullMarketingTeamSurfaces(ctx.user)) return;
  if (ctx.user.isMarketingTeamSupervisorOnActiveBranch === true && ctx.currentBranchId) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Missing marketing.teamOverview access',
  });
}

async function resolveMarketingTeamViewerScope(ctx: {
  user: SessionUser;
  currentBranchId: string | null;
}): Promise<{
  supervisorScope?: OrdersAggregateSupervisorScope;
  restrictMediaBuyerIds?: string[];
}> {
  if (seesFullMarketingTeamSurfaces(ctx.user)) return {};
  const branchId = ctx.currentBranchId;
  if (!branchId || ctx.user.isMarketingTeamSupervisorOnActiveBranch !== true) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Marketing team overview access denied.' });
  }
  const scope = await getBranchTeamsService().listSupervisorScopeIds(ctx.user.id, branchId);
  // Always include the supervisor themselves — they are also a Media Buyer with their own orders.
  // Even if the team is empty, the supervisor should see their own data.
  const mbIds = scope.marketingUserIds.length > 0
    ? scope.marketingUserIds
    : [ctx.user.id];
  // Ensure supervisor is always in the list
  if (!mbIds.includes(ctx.user.id)) mbIds.push(ctx.user.id);
  return {
    supervisorScope: { csUserIds: scope.csUserIds, mediaBuyerIds: mbIds },
    restrictMediaBuyerIds: mbIds,
  };
}

export const marketingRouter = router({
  // ── Funding ──────────────────────────────────────
  createFunding: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(createFundingSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...fundingInput } = input;
      const bId = branchId ?? ctx.currentBranchId ?? null;
      const perms = ctx.user.permissions ?? [];
      const hasFundingPerm =
        ctx.user.role === 'SUPER_ADMIN' ||
        perms.includes('marketing.funding') ||
        perms.includes('finance.disburse');
      if (!hasFundingPerm) {
        if (!bId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Switch to a branch to send funding',
          });
        }
        const supervisorOk = await getBranchTeamsService().isMarketingSupervisorOf(
          ctx.user.id,
          fundingInput.receiverId,
          bId,
        );
        if (!supervisorOk) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have permission to send funding to this user',
          });
        }
      }
      return getMarketingService().createFunding(fundingInput, ctx.user, bId);
    }),

  verifyFunding: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(verifyFundingSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().verifyFunding(input, ctx.user.id);
    }),

  listFunding: authedProcedure
    .input(listFundingSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().listFunding(input, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  fundingStatusCounts: authedProcedure
    .input(fundingStatusCountsSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().fundingStatusCounts(input, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  fundingRequestStatusCounts: authedProcedure
    .input(fundingRequestStatusCountsSchema)
    .query(async ({ input, ctx }) => {
      // Migration 0106 — same scoping rule as listFundingRequests. Non-admin
      // viewers without an explicit `requesterId` see counts for their own
      // inbox (target = caller) plus legacy NULL-target rows.
      const isAdminClass = ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN';
      const askingForOwnOutbound = input.requesterId === ctx.user.id;
      const scopedTargetUserId =
        !isAdminClass && !askingForOwnOutbound
          ? (input.targetUserId ?? ctx.user.id)
          : input.targetUserId;
      return getMarketingService().fundingRequestStatusCounts(
        { ...input, targetUserId: scopedTargetUserId },
        ctx.user,
        ctx.currentBranchId,
        ctx.effectiveBranchIds,
      );
    }),

  fundingSummary: permissionProcedure('marketing.fundingSummary')
    .query(async ({ ctx }) => {
      return getMarketingService().getFundingSummary(ctx.currentBranchId, undefined, ctx.effectiveBranchIds);
    }),

  /** Per-actor directional summary used by the Funding page top strip — totals received,
   * totals distributed, plus pending mark-received and disputed counts (action signals). */
  fundingByDirectionSummary: authedProcedure
    .input(fundingDirectionSummarySchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().fundingByDirectionSummary(ctx.user.id, input);
    }),

  /** Funding balance for one user. Allowed: own; HoM viewing MB; SA/FO; users.read viewing HoM/MB. */
  getFundingBalance: permissionProcedure('marketing.fundingSummary', 'marketing.read', 'users.read')
    .input(getFundingBalanceSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().getFundingBalanceWithAuth(input.userId, ctx.user, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /** Chronological ledger of all funding events for a user — transfers, expenses, requests. */
  fundingLedger: permissionProcedure('marketing.fundingSummary', 'marketing.read', 'users.read')
    .input(fundingLedgerSchema)
    .query(async ({ input, ctx }) => {
      // MBs can only view their own ledger
      if (ctx.user.role === 'MEDIA_BUYER' && input.userId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your own funding ledger.' });
      }
      return getMarketingService().getFundingLedger(input, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /** List funding balances for recipients. HoM sees self + Media Buyers; SA/FO see all HoM + MB.
   * Super Admin and Head of Marketing allowed by role (no permission required); others need permission. */
  listFundingBalances: authedProcedure
    .use(async ({ ctx, next }) => {
      if ((ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN') || ctx.user.role === 'HEAD_OF_MARKETING') {
        return next({ ctx });
      }
      const perms = ctx.user.permissions ?? [];
      const hasAny = ['marketing.fundingSummary', 'marketing.read', 'marketing.teamOverview', 'finance.disburse'].some((p) => perms.includes(p));
      if (!hasAny) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to list funding balances' });
      }
      return next({ ctx });
    })
    .query(async ({ ctx }) => {
      return getMarketingService().listFundingBalances(ctx.user, ctx.currentBranchId, undefined, ctx.effectiveBranchIds);
    }),

  /** Recipient candidates for the Request Funding modal (migration 0106).
   *  MBs get their marketing-team supervisor (preselected when present) +
   *  HoMs in their branch + Finance Officers (org-wide); HoMs get Finance Officers. */
  listFundingRequestRecipients: permissionProcedure('marketing.funding.request')
    .query(async ({ ctx }) => {
      const requesterRole: 'MEDIA_BUYER' | 'HEAD_OF_MARKETING' =
        ctx.user.role === 'HEAD_OF_MARKETING' ? 'HEAD_OF_MARKETING' : 'MEDIA_BUYER';
      return getMarketingService().listFundingRequestRecipients(
        requesterRole,
        ctx.currentBranchId,
        ctx.user.id,
      );
    }),

  /** Media Buyer or Head of Marketing: submit a funding request to a specific recipient.
   *  MB picks HoM (default, branch-scoped) or Finance Officer; HoM picks Finance.
   *  Pre-migration-0106 broadcast flow remains as the fallback when no target is given. */
  requestFunding: permissionProcedure('marketing.funding.request')
    .meta({ branchScopedMutation: true })
    .input(
      z.object({
        amount: z.coerce.number().min(0),
        reason: z.string().max(500).optional().default(''),
        branchId: z.string().uuid().optional(),
        /**
         * Recipient user (CEO directive 2026-05-03). When set, only that user
         * (plus admin-class) sees the request and can approve/reject.
         * The service validates the target's role + branch scope. When omitted
         * (legacy clients), the service falls back to broadcast-by-role.
         */
        targetUserId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const requesterRole: 'MEDIA_BUYER' | 'HEAD_OF_MARKETING' =
        ctx.user.role === 'HEAD_OF_MARKETING' ? 'HEAD_OF_MARKETING' : 'MEDIA_BUYER';
      return getMarketingService().requestFunding(
        input.amount,
        input.reason ?? '',
        ctx.user.id,
        requesterRole,
        input.branchId ?? ctx.currentBranchId,
        input.targetUserId,
      );
    }),

  listFundingRequests: authedProcedure
    .input(listFundingRequestsSchema)
    .query(async ({ input, ctx }) => {
      // A marketing-team supervisor (still role=MEDIA_BUYER) needs to act as
      // an inbox holder for their team's requests — same shape as HoM. So we
      // skip the MB-only "self as requester" pin and let the inbox-scope rule
      // below do its job (`targetUserId = ctx.user.id`). Without this, a
      // supervisor's `/admin/marketing/funding` page would only show their
      // own outbound requests and never the ones their teammates sent them.
      const isMarketingSupervisorViewer =
        ctx.user.role === 'MEDIA_BUYER' &&
        ctx.user.isMarketingTeamSupervisorOnActiveBranch === true;

      // MB visibility is always self-only (defense-in-depth) — except for
      // supervisors (above). For other roles, honour the explicit
      // `requesterId` or `excludeSelfAsRequester` filters from the caller.
      const requesterId =
        ctx.user.role === 'MEDIA_BUYER' && !isMarketingSupervisorViewer
          ? ctx.user.id
          : input.requesterId;
      const excludeSelfAsRequester =
        (ctx.user.role !== 'MEDIA_BUYER' || isMarketingSupervisorViewer) &&
        !requesterId &&
        input.excludeSelfAsRequester;

      // Migration 0106 — auto-scope inbox views to requests targeted at the
      // caller. Admin-class (SuperAdmin / Admin) bypass scoping and see every
      // request. Plain MBs are already self-scoped via `requesterId` above.
      // For everyone else (HoM, Finance, branch heads, AND marketing-team
      // supervisors), we apply `targetUserId = ctx.user.id` when the caller
      // isn't asking for their own outbound — turning the "all pending
      // requests" view into "my inbox". Legacy NULL-target rows (pre-migration
      // broadcasts) are still included so historical audiences keep
      // visibility until those rows close out.
      const isAdminClass = ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN';
      const askingForOwnOutbound = requesterId === ctx.user.id;
      const targetUserId =
        !isAdminClass && !askingForOwnOutbound
          ? (input.targetUserId ?? ctx.user.id)
          : input.targetUserId;
      // Legacy NULL-target rows: include for HoM/Finance/branch heads (their
      // historical broadcast audience) but NOT for marketing-team supervisors
      // — they were never the target of pre-migration broadcasts and showing
      // those rows would leak branch-wide history they shouldn't see.
      const includeLegacyNullTarget =
        !isAdminClass && !askingForOwnOutbound && !isMarketingSupervisorViewer;

      return getMarketingService().listFundingRequests(
        {
          requesterId,
          excludeSelfAsRequester,
          targetUserId,
          includeLegacyNullTarget,
          requesterRole: input.requesterRole,
          callerId: ctx.user.id,
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status,
          search: input.search,
          page: input.page,
          limit: input.limit,
        },
        ctx.currentBranchId,
        ctx.effectiveBranchIds,
      );
    }),

  /**
   * Approve a funding request. Allowed for:
   *   - SUPER_ADMIN / SUPPORT (permissionProcedure bypass)
   *   - Users with `marketing.funding.approve` or `finance.disburse` permission
   *   - The targeted recipient of the request (HoM, supervisor, or anyone the
   *     requester picked in the "Request from" modal — the service layer validates
   *     `existing.targetUserId === actor.id`)
   *
   * Uses `authedProcedure` instead of `permissionProcedure` so the targeted-
   * recipient path isn't blocked before the service can check it.
   */
  approveFundingRequest: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(approveFundingRequestSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().approveFundingRequest(
        input.requestId,
        input.amount,
        input.receiptUrl,
        ctx.user,
        input.branchId ?? ctx.currentBranchId,
      );
    }),

  /** Reject parity — same gate as approve (targeted recipient OR perm holder). */
  rejectFundingRequest: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(rejectFundingRequestSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().rejectFundingRequest(input.requestId, input.reason, ctx.user);
    }),

  /**
   * "Back-and-forth" timeline for one funding flow — pass a transferId or requestId and
   * the service stitches together the request + transfer rows + their event sequence.
   * Permission gate lives in the service (party / admin / Finance) so we use `authedProcedure`.
   */
  getFundingFlow: authedProcedure
    .input(
      z
        .object({
          transferId: z.string().uuid().optional(),
          requestId: z.string().uuid().optional(),
        })
        .refine((v) => v.transferId || v.requestId, {
          message: 'Provide transferId or requestId',
        }),
    )
    .query(async ({ input, ctx }) => {
      return getMarketingService().getFundingFlow(input, {
        id: ctx.user.id,
        role: ctx.user.role,
        permissions: ctx.user.permissions ?? [],
      });
    }),

  // ── Ad Spend ─────────────────────────────────────
  createAdSpend: permissionProcedure('marketing.adSpend')
    .meta({ branchScopedMutation: true })
    .input(createAdSpendWithBranchSchema)
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...adSpendInput } = input;
      return getMarketingService().createAdSpend(adSpendInput, ctx.user.id, branchId ?? ctx.currentBranchId);
    }),

  /**
   * Multi-line "Add Expense" submission. One day, N lines, single transaction.
   * HoM gets ONE notification for the whole batch — see MarketingService.createAdSpendBatch.
   */
  createAdSpendBatch: permissionProcedure('marketing.adSpend')
    .meta({ branchScopedMutation: true })
    .input(createAdSpendBatchWithBranchSchema)
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...batchInput } = input;
      return getMarketingService().createAdSpendBatch(
        batchInput,
        ctx.user.id,
        branchId ?? ctx.currentBranchId,
      );
    }),

  listAdSpend: authedProcedure
    .input(listAdSpendSchema)
    .query(async ({ input, ctx }) => {
      // Media Buyers may only see their own ad spend
      let effectiveInput = ctx.user.role === 'MEDIA_BUYER'
        ? { ...input, mediaBuyerId: ctx.user.id }
        : input;
      effectiveInput = await applyMarketingSupervisorScope(ctx, effectiveInput);
      return getMarketingService().listAdSpend(effectiveInput, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /**
   * Grouped accordion view: each result row is one (date × MB) batch with
   * line items. Same role scoping as listAdSpend — Media Buyers see only
   * their own.
   */
  listAdSpendGrouped: authedProcedure
    .input(listAdSpendGroupedSchema)
    .query(async ({ input, ctx }) => {
      let effectiveInput =
        ctx.user.role === 'MEDIA_BUYER' ? { ...input, mediaBuyerId: ctx.user.id } : input;
      effectiveInput = await applyMarketingSupervisorScope(ctx, effectiveInput);
      return getMarketingService().listAdSpendGrouped(effectiveInput, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  adSpendStatusCounts: authedProcedure
    .input(adSpendStatusCountsSchema)
    .query(async ({ input, ctx }) => {
      let effectiveInput =
        ctx.user.role === 'MEDIA_BUYER' ? { ...input, mediaBuyerId: ctx.user.id } : input;
      effectiveInput = await applyMarketingSupervisorScope(ctx, effectiveInput);
      return getMarketingService().adSpendStatusCounts(effectiveInput, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /** Orders since last APPROVED spend (same funnel) + indicative CPA — Log Ad Spend form preview. */
  previewAdSpendInterval: permissionProcedure('marketing.adSpend')
    .input(previewAdSpendIntervalSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().previewAdSpendInterval(input, ctx.user.id, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /**
   * Campaign-level order total for the Add Expense modal split UX
   * (CEO directive 2026-05-08). Returns the form's order count the MB
   * must split across their batch lines.
   */
  campaignOrderTotalForBatch: permissionProcedure('marketing.adSpend')
    .input(campaignOrderTotalForBatchSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().getCampaignOrderTotalForBatch(
        input,
        ctx.user.id,
        ctx.currentBranchId,
        ctx.effectiveBranchIds,
      );
    }),

  /**
   * Phase 20: `marketing.adSpend.approve` — plus branch marketing supervisors for supervisee rows only
   * (enforced in MarketingService).
   */
  approveAdSpend: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(approveAdSpendSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().approveAdSpend(input.adSpendId, ctx.user);
    }),

  rejectAdSpend: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(rejectAdSpendSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().rejectAdSpend(input.adSpendId, input.reason, ctx.user);
    }),

  updateAdSpend: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(updateAdSpendSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...adSpendInput } = input;
      return getMarketingService().updateAdSpend(
        adSpendInput,
        {
          id: ctx.user.id,
          role: ctx.user.role,
          permissions: ctx.user.permissions ?? [],
        },
        branchId ?? ctx.currentBranchId,
      );
    }),

  // ── Daily Ad Spend (Simplified Flow — 2026-05) ──────────────────────
  logDailySpend: permissionProcedure('marketing.adSpend')
    .meta({ branchScopedMutation: true })
    .input(logDailyAdSpendWithBranchSchema)
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...spendInput } = input;
      return getMarketingService().logDailyAdSpend(
        spendInput,
        ctx.user,
        branchId ?? ctx.currentBranchId,
      );
    }),

  orderCountForDate: permissionProcedure('marketing.adSpend')
    .input(z.object({ spendDate: z.string().date() }))
    .query(async ({ input, ctx }) => {
      return getMarketingService().getOrderCountForAdSpendDate(
        input.spendDate,
        ctx.user.id,
        ctx.currentBranchId,
        ctx.effectiveBranchIds,
      );
    }),

  updateDailySpend: permissionProcedure('marketing.adSpend')
    .meta({ branchScopedMutation: true })
    .input(updateDailyAdSpendSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...spendInput } = input;
      // Reuse updateAdSpend — it handles PENDING/REJECTED/APPROVED status transitions.
      return getMarketingService().updateAdSpend(
        { adSpendId: spendInput.adSpendId, spendAmount: spendInput.spendAmount },
        {
          id: ctx.user.id,
          role: ctx.user.role,
          permissions: ctx.user.permissions ?? [],
        },
        branchId ?? ctx.currentBranchId,
      );
    }),

  // ── Performance Metrics ──────────────────────────
  metrics: authedProcedure
    .input(
      z.object({
        mediaBuyerId: z.string().uuid().optional(),
        assignedCsId: z.string().uuid().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        /** When true, skip supervisor scope expansion — return only the caller's own metrics. */
        personalOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      let mediaBuyerId = input.mediaBuyerId;
      let assignedCsId = input.assignedCsId;

      if (ctx.user.role === 'MEDIA_BUYER') {
        if (input.mediaBuyerId && input.mediaBuyerId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Cannot query another media buyer funnel.',
          });
        }
        // A Media Buyer who's been promoted to supervise their branch's
        // marketing team gets the team-aggregated view (their own funnel +
        // every supervised peer) — same plumbing the orders aggregates use.
        // The narrow helper auto-derives `supervisorScope.mediaBuyerIds[]`
        // from `applySupervisorScope` and drops the single `mediaBuyerId`
        // filter; the metrics service then OR-aggregates across the IDs.
        // When `personalOnly` is set, skip this expansion — supervisor sees only their own stats.
        if (
          !input.personalOnly &&
          ctx.user.isMarketingTeamSupervisorOnActiveBranch === true &&
          ctx.currentBranchId
        ) {
          const narrowed = await narrowOrdersAggregateFiltersForViewer(ctx, ctx.currentBranchId, {
            mediaBuyerId: ctx.user.id,
            startDate: input.startDate,
            endDate: input.endDate,
          });
          return getMarketingService().getPerformanceMetrics(
            narrowed.mediaBuyerId,
            input.startDate && input.endDate ? 'this_month' : 'all_time',
            input.startDate,
            input.endDate,
            ctx.currentBranchId,
            undefined,
            narrowed.supervisorScope,
            ctx.effectiveBranchIds,
          );
        }
        mediaBuyerId = ctx.user.id;
        assignedCsId = undefined;
      } else if (ctx.user.role === 'CS_CLOSER') {
        if (input.mediaBuyerId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Media buyer filter is not available for Sales closers.',
          });
        }
        if (input.assignedCsId && input.assignedCsId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Cannot scope metrics to another Sales closer.',
          });
        }
        assignedCsId = ctx.user.id;
      } else if (!isAdminLevel(ctx.user)) {
        assignedCsId = undefined;
      }

      if (ctx.user.role === 'CS_CLOSER') {
        const narrowed = await narrowOrdersAggregateFiltersForViewer(ctx, ctx.currentBranchId, {
          assignedCsId: ctx.user.id,
          startDate: input.startDate,
          endDate: input.endDate,
        });
        // CS_CLOSER self-query: the closer's orders list ignores the marketing
        // branch — they see every order assigned to them across branches. The
        // metrics must mirror that or the dashboard reports fewer Delivered /
        // Confirmed than the list shows (see project_closer_self_query_branch_parity).
        // `assignedCsId = me` is already an exact ownership scope, so dropping
        // the branch AND here yields the same row set as the list.
        return getMarketingService().getPerformanceMetrics(
          narrowed.mediaBuyerId,
          input.startDate && input.endDate ? 'this_month' : 'all_time',
          input.startDate,
          input.endDate,
          null,
          narrowed.assignedCsId,
          narrowed.supervisorScope,
          ctx.effectiveBranchIds,
        );
      }

      // HEAD_OF_CS: apply the same supervisor scope so the dashboard funnel
      // matches the Sales Orders page (team-scoped, not branch-wide).
      if (ctx.user.role === 'HEAD_OF_CS') {
        const narrowed = await narrowOrdersAggregateFiltersForViewer(ctx, ctx.currentBranchId, {
          startDate: input.startDate,
          endDate: input.endDate,
        });
        return getMarketingService().getPerformanceMetrics(
          narrowed.mediaBuyerId,
          input.startDate && input.endDate ? 'this_month' : 'all_time',
          input.startDate,
          input.endDate,
          ctx.currentBranchId,
          narrowed.assignedCsId,
          narrowed.supervisorScope,
          ctx.effectiveBranchIds,
        );
      }

      return getMarketingService().getPerformanceMetrics(
        mediaBuyerId,
        input.startDate && input.endDate ? 'this_month' : 'all_time',
        input.startDate,
        input.endDate,
        ctx.currentBranchId,
        assignedCsId,
        undefined,
        ctx.effectiveBranchIds,
      );
    }),

  /** Org-wide profitability config (target ROAS + green/red threshold). Drives the
   * Profitability column color on `/admin/marketing/team` and the ROAS pill color on
   * `/admin/marketing/leaderboard`. SuperAdmin sets it on Settings → System. */
  profitabilityConfig: permissionProcedure('marketing.read').query(async () => {
    return getMarketingService().getProfitabilityConfig();
  }),

  // ── Media Buyer Leaderboard ─────────────────────
  leaderboard: permissionProcedure('marketing.leaderboard')
    .input(
      z.object({
        period: z.enum(['this_month', 'all_time']).optional().default('this_month'),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getMarketingService().getMediaBuyerLeaderboard(
        input.period ?? 'this_month',
        input.startDate,
        input.endDate,
        ctx.currentBranchId,
        undefined,
        ctx.effectiveBranchIds,
      );
    }),

  /**
   * Single-request bundle for `/admin/marketing/overview`.
   *
   * Replaces 5 parallel HTTP round-trips — `marketing.metrics`,
   * `marketing.leaderboard`, `marketing.listFundingBalances`, `orders.list`
   * (recent orders), and `cart.listActivity` — with one request. Same
   * fan-out runs server-side via `Promise.all`.
   *
   * Permission gate: `marketing.teamOverview` / HoM / admin — **or** branch marketing supervisor.
   */
  overviewPageBundle: authedProcedure
    .input(
      z.object({
        period: z.enum(['this_month', 'all_time']).optional().default('this_month'),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        recentOrdersLimit: z.number().int().min(1).max(100).default(20),
        liveActivityLimit: z.number().int().min(1).max(200).default(60),
      }),
    )
    .query(async ({ input, ctx }) => {
      assertMarketingTeamSurfacesAccess(ctx);
      const branchId = ctx.currentBranchId;
      const eIds = ctx.effectiveBranchIds;
      const viewer = await resolveMarketingTeamViewerScope(ctx);
      const supervisorScope = viewer.supervisorScope;
      const restrictMbIds = viewer.restrictMediaBuyerIds;

      const perms = ctx.user.permissions ?? [];
      const canQueryLiveActivity =
        isAdminLevel(ctx.user) ||
        perms.includes('cart.read') ||
        perms.includes('marketing.read') ||
        ctx.user.isMarketingTeamSupervisorOnActiveBranch === true;

      const recentOrdersInputBase = {
        page: 1,
        limit: input.recentOrdersLimit,
        sortBy: 'createdAt' as const,
        sortOrder: 'desc' as const,
        ...(input.startDate && { startDate: input.startDate }),
        ...(input.endDate && { endDate: input.endDate }),
      };
      const recentOrdersInput = await applySupervisorScope(ctx, recentOrdersInputBase, branchId);

      const fetchLiveActivity = async () => {
        if (!canQueryLiveActivity) return [];
        if (ctx.user.role === 'MEDIA_BUYER') {
          // A plain MB sees ALL their own carts/orders across every branch
          // (mediaBuyerId is itself an exact scope). Same rationale as
          // `marketingOrdersOverviewStripFor`.
          return getCartService().listActivity({
            limit: input.liveActivityLimit,
            mediaBuyerId: ctx.user.id,
          });
        }
        if (restrictMbIds && restrictMbIds.length > 1) {
          const perMb = Math.max(1, Math.ceil(input.liveActivityLimit / restrictMbIds.length));
          const chunks = await Promise.all(
            restrictMbIds.map((mediaBuyerId) =>
              getCartService().listActivity({
                limit: perMb,
                mediaBuyerId,
                branchId: branchId ?? undefined,
                effectiveBranchIds: eIds,
              }),
            ),
          );
          const merged = chunks.flat();
          merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          return merged.slice(0, input.liveActivityLimit);
        }
        if (restrictMbIds?.length === 1) {
          return getCartService().listActivity({
            limit: input.liveActivityLimit,
            mediaBuyerId: restrictMbIds[0],
            branchId: branchId ?? undefined,
            effectiveBranchIds: eIds,
          });
        }
        return getCartService().listActivity({
          limit: input.liveActivityLimit,
          branchId: branchId ?? undefined,
          effectiveBranchIds: eIds,
        });
      };

      const [metrics, leaderboard, balancesList, recentOrders, liveActivity, abandonedCartCount] = await Promise.all([
        getMarketingService().getPerformanceMetrics(
          undefined,
          input.startDate && input.endDate ? 'this_month' : 'all_time',
          input.startDate,
          input.endDate,
          branchId,
          undefined,
          supervisorScope,
          ctx.effectiveBranchIds,
        ),
        getMarketingService().getMediaBuyerLeaderboard(
          input.period,
          input.startDate,
          input.endDate,
          branchId,
          restrictMbIds,
          ctx.effectiveBranchIds,
        ),
        getMarketingService().listFundingBalances(ctx.user, branchId, undefined, ctx.effectiveBranchIds),
        getOrdersService().list(recentOrdersInput, branchId, { ...buildOrdersListOpts(ctx.user), effectiveBranchIds: eIds }),
        fetchLiveActivity(),
        getCartOrdersService().getStatusCounts(branchId, undefined, input.startDate, input.endDate, ctx.effectiveBranchIds, restrictMbIds?.length === 1 ? restrictMbIds[0] : undefined)
          .then((counts) => Object.entries(counts).filter(([k]) => k !== 'DELETED').reduce((sum, [, n]) => sum + n, 0))
          .catch(() => 0),
      ]);

      return {
        metrics,
        leaderboard,
        balancesList,
        recentOrders,
        liveActivity,
        abandonedCartCount,
      };
    }),

  checkHighCpa: permissionProcedure('marketing.checkHighCpa')
    .input(z.object({ threshold: z.number().positive() }))
    .query(async ({ input, ctx }) => {
      return getMarketingService().checkHighCpaAlerts(input.threshold, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  // ── Offer Templates ──────────────────────────────
  createOfferTemplate: permissionProcedure('products.offers')
    .meta({ branchScopedMutation: true })
    .input(createOfferTemplateSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...offerTemplateInput } = input;
      return getMarketingService().createOfferTemplate(offerTemplateInput, ctx.user.id);
    }),

  updateOfferTemplate: permissionProcedure('products.offers')
    .meta({ branchScopedMutation: true })
    .input(updateOfferTemplateSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...offerTemplateInput } = input;
      return getMarketingService().updateOfferTemplate(offerTemplateInput, ctx.user.id);
    }),

  archiveAllOfferTemplatesForProduct: permissionProcedure('products.offers')
    .meta({ branchScopedMutation: true })
    .input(archiveAllOfferTemplatesForProductSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _b, ...rest } = input;
      return getMarketingService().archiveAllOfferTemplatesForProduct(rest.productId, ctx.user.id);
    }),

  getOfferTemplate: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getMarketingService().getOfferTemplate(input.id);
    }),

  listOfferTemplates: authedProcedure
    .input(listOfferTemplatesSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().listOfferTemplates(input, ctx.activeGroupId);
    }),

  // ── Offer Groups ─────────────────────────────────
  createOfferGroup: permissionProcedure('products.offers')
    .meta({ branchScopedMutation: true })
    .input(createOfferGroupSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...offerGroupInput } = input;
      return getMarketingService().createOfferGroup(offerGroupInput, ctx.user.id);
    }),

  updateOfferGroup: permissionProcedure('products.offers')
    .meta({ branchScopedMutation: true })
    .input(updateOfferGroupSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...offerGroupInput } = input;
      return getMarketingService().updateOfferGroup(offerGroupInput, ctx.user.id);
    }),

  getOfferGroup: authedProcedure
    .input(getOfferGroupSchema)
    .query(async ({ input }) => {
      return getMarketingService().getOfferGroup(input.id);
    }),

  listOfferGroups: authedProcedure
    .input(listOfferGroupsSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().listOfferGroups(input, ctx.activeGroupId);
    }),

  clearLegacyOfferTemplates: permissionProcedure('products.offers')
    .meta({ branchScopedMutation: true })
    .input(clearLegacyOfferTemplatesSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...rest } = input;
      return getMarketingService().clearLegacyOfferTemplates(rest, ctx.user.id);
    }),

  // ── Campaigns ────────────────────────────────────
  createCampaign: permissionProcedure('marketing.campaigns')
    .meta({ branchScopedMutation: true })
    .input(createCampaignProcedureSchema)
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...campaignInput } = input;
      return getMarketingService().createCampaign(campaignInput, ctx.user.id, branchId ?? ctx.currentBranchId);
    }),

  updateCampaign: permissionProcedure('marketing.campaigns')
    .meta({ branchScopedMutation: true })
    .input(updateCampaignSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...campaignInput } = input;
      return getMarketingService().updateCampaign(campaignInput, ctx.user.id);
    }),

  getCampaign: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      return getMarketingService().getCampaign(input.id);
    }),

  listCampaigns: authedProcedure
    .input(listCampaignsSchema)
    .query(async ({ input, ctx }) => {
      // Rank-and-file MB sees only their own forms — always pinned to self so
      // an MB can never pass another buyer's id. Supervisors get team scope
      // via `applyMarketingSupervisorScope`. Admin / HoM / global-scope see all.
      const isOwnMbView = ctx.user.role === 'MEDIA_BUYER';
      let effectiveInput = isOwnMbView ? { ...input, mediaBuyerId: ctx.user.id } : input;
      effectiveInput = await applyMarketingSupervisorScope(ctx, effectiveInput);
      // Forms are branch-scoped: a form belongs to its campaign's branch, so
      // the selected branch filters the forms list. `null` currentBranchId
      // ("All branches") = no filter. `listCampaigns` also surfaces a moved
      // MB's parked (DEACTIVATED) forms under their new primary branch.
      return getMarketingService().listCampaigns(effectiveInput, ctx.currentBranchId, { callerId: ctx.user.id, effectiveBranchIds: ctx.effectiveBranchIds });
    }),

  /**
   * Single-request bundle for the `/admin/marketing/orders` secondary fan-out.
   *
   * Why this exists: the page loader previously made 6 parallel HTTP calls
   * (orders.statusCounts, marketing.metrics, orders.timeSeriesByCreated,
   * users.list[MEDIA_BUYER], products.list, marketing.listCampaigns). Each
   * paid the full HTTP + auth-middleware + session-resolution cost on its own
   * — even though the user, branch, and permissions were identical for all
   * six. Collapsing them into one tRPC procedure fans out to the same
   * services in parallel via Promise.all, but pays the per-request overhead
   * once. The wall-clock for the page's secondary defer drops from
   * ~max(slowest endpoint) + N × middleware to ~max(slowest single query) +
   * 1 × middleware.
   *
   * Permission gate matches the page itself (`marketing.orders`) — every role
   * that can land on `/admin/marketing/orders` (MEDIA_BUYER, HEAD_OF_MARKETING,
   * SUPER_ADMIN, ADMIN) holds this code.
   */
  ordersPageBundle: permissionProcedure('marketing.orders')
    .input(
      z.object({
        // Shared scope — applies to status counts, metrics, daily counts.
        mediaBuyerId: z.string().uuid().optional(),
        // Optional status filter for the trend chart only (mirrors timeSeriesByCreated).
        status: z.string().optional(),
        // Date window — accept ISO datetime in addition to plain dates so this matches
        // the regex used by orders.statusCounts / orders.timeSeriesByCreated.
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/)
          .optional(),
        // Only HoM / admin loaders ask for the buyer picklist (Media Buyers don't
        // have the export modal). When false, the buyers query is skipped.
        includeMarketingExportPicklists: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { mediaBuyerId, status, startDate, endDate, includeMarketingExportPicklists } = input;
      // Branch scope must mirror `orders.list` (`orderListBranchIdOwnerAware`)
      // so the overview strip matches the orders table:
      //  - A plain Media Buyer scopes by their header branch lens — the
      //    currently-selected branch, or null ("All Branches") for all their
      //    orders across every branch. The media-buyer-id filter keeps the
      //    result exact either way, so the strip always matches the table.
      //  - An org-wide marketing viewer (HoM / admin) drilling into one buyer is
      //    org-wide (matches the team-analysis leaderboard).
      //  - Everyone else (incl. marketing team supervisors) stays branch-scoped.
      const branchId =
        mediaBuyerId && isOrgWideMarketingViewer(ctx.user)
          ? null
          : ctx.currentBranchId;

      const ordersScope = await narrowOrdersAggregateFiltersForViewer(ctx, branchId, {
        mediaBuyerId,
        startDate,
        endDate,
      });

      // Defense-in-depth: the original page loader gated the buyer picklist on
      // `users.list` (which is `permissionProcedure('users.read')`). Calling
      // `getUsersService().list(...)` directly here bypasses that gate, so we
      // re-check the caller actually holds `users.read` before honouring
      // `includeMarketingExportPicklists`. MEDIA_BUYER does NOT hold it; HoM /
      // admin-class do.
      // Marketing team supervisors are also allowed — but we restrict their
      // picklist to their supervised team (handled below where we feed
      // `restrictBuyerIds` instead of opening the global users.list query).
      const callerPerms = ctx.user.permissions ?? [];
      const isMarketingSupervisor =
        ctx.user.isMarketingTeamSupervisorOnActiveBranch === true && !!branchId;
      const canSeeBuyerPicklist =
        includeMarketingExportPicklists &&
        (isAdminLevel(ctx.user) || callerPerms.includes('users.read') || isMarketingSupervisor);
      const supervisorBuyerIds = isMarketingSupervisor && ordersScope.supervisorScope
        ? ordersScope.supervisorScope.mediaBuyerIds
        : null;

      const metricsBuyerId = ordersScope.mediaBuyerId ?? mediaBuyerId;

      // Six concurrent service calls — same shape as the old loader fan-out, but
      // running in-process without per-call HTTP / auth overhead.
      const [
        statusCounts,
        metrics,
        timeSeries,
        buyersResult,
        productsResult,
        campaignsResult,
        abandonedCartCount,
        supplementaryCounts,
      ] = await Promise.all([
        getOrdersService().getStatusCounts(
          ordersScope.mediaBuyerId,
          ordersScope.startDate,
          ordersScope.endDate,
          ordersScope.assignedCsId,
          undefined,
          branchId,
          undefined,
          ordersScope.supervisorScope,
          // Marketing Orders page — every viewer (MB / HoM) scopes by the
          // marketing branch (`orders.branch_id`) so counts match the order
          // rows and an order CS-routed elsewhere still counts here.
          'marketing',
          ctx.effectiveBranchIds,
          // Exclude follow-up orders — matches getPerformanceMetrics which
          // filters isFollowUp=false. Without this, reopened follow-up orders
          // inflate Unassigned/Assigned counts beyond Total Orders.
          false,
          // Exclude offline orders — marketing metrics only count edge-form orders.
          // Offline orders affect Sales metrics only (CEO 2026-06-05).
          true,
        ),
        getMarketingService().getPerformanceMetrics(
          metricsBuyerId,
          startDate && endDate ? 'this_month' : 'all_time',
          startDate,
          endDate,
          branchId,
          ordersScope.assignedCsId,
          ordersScope.supervisorScope,
          ctx.effectiveBranchIds,
        ),
        getOrdersService().getOrdersTimeSeriesByCreated(
          ordersScope.startDate,
          ordersScope.endDate,
          branchId,
          {
            mediaBuyerId: ordersScope.mediaBuyerId,
            csCloserId: ordersScope.assignedCsId,
            supervisorScope: ordersScope.supervisorScope,
            status,
          },
          // Marketing Orders page — scope the trend by the marketing branch.
          'marketing',
          ctx.effectiveBranchIds,
        ),
        canSeeBuyerPicklist
          ? supervisorBuyerIds && supervisorBuyerIds.length > 0
            ? // Supervisor path: only their team's MBs (the supervisor themselves
              // is included in `supervisorBuyerIds`). Skips users.list which
              // requires `users.read` (MBs don't hold it).
              getUsersService()
                .listByIds(supervisorBuyerIds)
                .then((rows) => ({ users: rows, total: rows.length }))
            : getUsersService().list(
                {
                  page: 1,
                  limit: 100,
                  role: 'MEDIA_BUYER',
                  status: 'ACTIVE',
                  sortBy: 'createdAt',
                  sortOrder: 'desc',
                  // Picklist consumers only need id + name — skip the membership join.
                  includeBranchMemberships: false,
                },
                ctx.user,
                ctx.currentBranchId,
                ctx.effectiveBranchIds,
              )
          : Promise.resolve(null),
        getProductsService().list(
          {
            page: 1,
            limit: 100,
            status: 'ACTIVE',
            sortBy: 'name',
            sortOrder: 'asc',
          },
          ctx.user.id,
          ctx.user.role,
          ctx.activeGroupId,
        ),
        getMarketingService().listCampaigns(
          {
            page: 1,
            limit: 100,
            status: 'ACTIVE',
            // An MB's Form-filter dropdown lists their own forms, every branch.
            ...(ctx.user.role === 'MEDIA_BUYER' ? { mediaBuyerId: ctx.user.id } : {}),
          },
          null, // Forms are global — never branch-scoped (but company-group-scoped via effectiveBranchIds)
          { enrichProductIds: false, effectiveBranchIds: ctx.effectiveBranchIds }, // Orders page only needs id+name for the filter dropdown
        ),
        // Cart orders total — marketers see how many abandoned carts entered the
        // recovery pipeline. Scoped by branch so the stat strip matches the
        // Cart Orders page for the same branch selection.
        getCartOrdersService().getStatusCounts(branchId, undefined, startDate, endDate, ctx.effectiveBranchIds, ordersScope.mediaBuyerId)
          .then((counts) => Object.entries(counts).filter(([k]) => k !== 'DELETED').reduce((sum, [, n]) => sum + n, 0))
          .catch(() => 0),
        // Supplementary counts: offline + duplicate — same scope as statusCounts.
        getOrdersService().getSupplementaryCounts(
          ordersScope.mediaBuyerId,
          ordersScope.startDate,
          ordersScope.endDate,
          ordersScope.assignedCsId,
          branchId,
          ordersScope.supervisorScope,
          'marketing',
          ctx.effectiveBranchIds,
        ),
      ]);

      // Slim the picklist payloads down to what the page actually uses (id + name)
      // so we're not shipping full product / campaign rows over the wire.
      const productsForFilter = (productsResult.products ?? []).map((p) => ({
        id: p.id,
        name: p.name,
      }));
      const campaignsForFilter = (campaignsResult.campaigns ?? []).map((c) => ({
        id: c.id,
        name: c.name,
      }));
      let mediaBuyersForFilter = buyersResult
        ? (buyersResult.users ?? []).map((u) => ({ id: u.id, name: u.name }))
        : [];

      // When the page is opened pre-filtered to a specific media buyer — e.g.
      // the "View orders" link from team analysis — guarantee that buyer is in
      // the picklist so the filter dropdown can render the active selection.
      // The active-buyers query above is scoped to ACTIVE status (and the
      // current branch), so a probation / deactivated / cross-branch buyer who
      // still shows on the team leaderboard would otherwise be missing and the
      // dropdown would silently fall back to "All media buyers".
      if (
        mediaBuyerId &&
        canSeeBuyerPicklist &&
        !mediaBuyersForFilter.some((b) => b.id === mediaBuyerId)
      ) {
        const [extraBuyer] = await getUsersService().listByIds([mediaBuyerId]);
        if (extraBuyer) {
          mediaBuyersForFilter = [
            { id: extraBuyer.id, name: extraBuyer.name },
            ...mediaBuyersForFilter,
          ];
        }
      }

      return {
        statusCounts,
        metrics,
        dailyCounts: timeSeries,
        mediaBuyersForFilter,
        productsForFilter,
        campaignsForFilter,
        abandonedCartCount,
        offlineCount: supplementaryCounts.offlineCount,
        duplicateCount: supplementaryCounts.duplicateCount,
      };
    }),

  /**
   * Single-request bundle for `/admin/marketing/team`.
   *
   * Replaces 4 parallel loader calls (listFundingBalances, fundingSummary,
   * leaderboard, profitabilityConfig) plus an optional 2-call fallback when the
   * balances list is empty (users.list MEDIA_BUYER + HEAD_OF_MARKETING). One
   * HTTP request, one auth pass, parallel service calls.
   *
   * Permission gate: `marketing.teamOverview` / HoM / admin — **or** branch marketing supervisor.
   */
  teamPageBundle: authedProcedure
    .input(
      z.object({
        period: z.enum(['this_month', 'all_time']).optional().default('this_month'),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      assertMarketingTeamSurfacesAccess(ctx);
      const branchId = ctx.currentBranchId;
      const viewer = await resolveMarketingTeamViewerScope(ctx);
      const restrictMbIds = viewer.restrictMediaBuyerIds;
      const fundingOpts: { restrictToReceiverIds?: string[]; startDate?: string; endDate?: string } =
        restrictMbIds && restrictMbIds.length > 0 ? { restrictToReceiverIds: restrictMbIds } : {};
      if (input.startDate) fundingOpts.startDate = input.startDate;
      if (input.endDate) fundingOpts.endDate = input.endDate;

      const [balances, fundingSummary, leaderboard, profitabilityConfig] = await Promise.all([
        // Team Analysis roster — ACTIVE only, so it lines up with the
        // ACTIVE-only leaderboard and a deactivated account never shows as a
        // metric-less ghost row.
        getMarketingService().listFundingBalances(ctx.user, branchId, { activeOnly: true }, ctx.effectiveBranchIds),
        getMarketingService().getFundingSummary(branchId, Object.keys(fundingOpts).length > 0 ? fundingOpts : undefined, ctx.effectiveBranchIds),
        getMarketingService().getMediaBuyerLeaderboard(
          input.period,
          input.startDate,
          input.endDate,
          branchId,
          restrictMbIds,
          ctx.effectiveBranchIds,
        ),
        getMarketingService().getProfitabilityConfig(),
      ]);

      // Fallback: when balances is empty AND the caller is admin-class / HoM, the
      // legacy loader fired two more `users.list` queries to surface MB + HoM as
      // 0-balance rows. Inline that here so we keep one HTTP round-trip.
      let usersFallback: Array<{ id: string; name: string; role: string }> | null = null;
      if (balances.length === 0 && (isAdminLevel(ctx.user) || ctx.user.role === 'HEAD_OF_MARKETING')) {
        const [mbRes, homRes] = await Promise.all([
          getUsersService().list(
            {
              page: 1,
              limit: 20,
              role: 'MEDIA_BUYER',
              sortBy: 'createdAt',
              sortOrder: 'desc',
              includeBranchMemberships: false,
            },
            ctx.user,
            branchId,
            ctx.effectiveBranchIds,
          ),
          getUsersService().list(
            {
              page: 1,
              limit: 20,
              role: 'HEAD_OF_MARKETING',
              sortBy: 'createdAt',
              sortOrder: 'desc',
              includeBranchMemberships: false,
            },
            ctx.user,
            branchId,
            ctx.effectiveBranchIds,
          ),
        ]);
        usersFallback = [...(homRes.users ?? []), ...(mbRes.users ?? [])].map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
        }));
      } else if (
        balances.length === 0 &&
        restrictMbIds &&
        restrictMbIds.length > 0 &&
        ctx.user.isMarketingTeamSupervisorOnActiveBranch === true
      ) {
        const mbRes = await getUsersService().list(
          {
            page: 1,
            limit: 100,
            role: 'MEDIA_BUYER',
            sortBy: 'createdAt',
            sortOrder: 'desc',
            includeBranchMemberships: false,
          },
          ctx.user,
          branchId,
          ctx.effectiveBranchIds,
        );
        const allow = new Set(restrictMbIds);
        const picked = (mbRes.users ?? [])
          .filter((u) => allow.has(u.id))
          .map((u) => ({ id: u.id, name: u.name, role: u.role }));
        usersFallback = picked.length > 0 ? picked : null;
      }

      return {
        balances,
        fundingSummary,
        leaderboard,
        profitabilityConfig,
        usersFallback,
      };
    }),

  /**
   * Single-request bundle for the `/admin/marketing/ad-spend` page picklists.
   *
   * Replaces 3 parallel calls in the loader's `adSpendPicklists` deferred
   * promise: `marketing.adSpendStatusCounts`, `marketing.listCampaigns`, and
   * `users.list[MEDIA_BUYER]` (only fetched for non-MB viewers). Page itself is
   * gated by `marketing.read`; we mirror that here.
   */
  adSpendPagePicklistsBundle: permissionProcedure('marketing.read')
    .input(
      z.object({
        // Same shape as adSpendStatusCounts (subset — no date.date enum so we accept
        // ISO and yyyy-mm-dd both)
        mediaBuyerId: z.string().uuid().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        search: z.string().trim().max(200).optional(),
        productId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        // The campaigns dropdown — non-paginated for the picker.
        campaignsLimit: z.number().int().min(1).max(500).optional().default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const branchId = ctx.currentBranchId;
      const isMediaBuyer = ctx.user.role === 'MEDIA_BUYER';
      const isMarketingSupervisor =
        isMediaBuyer && ctx.user.isMarketingTeamSupervisorOnActiveBranch === true && !!branchId;
      const callerPerms = ctx.user.permissions ?? [];
      const canSeeBuyerPicklist =
        (!isMediaBuyer && (isAdminLevel(ctx.user) || callerPerms.includes('users.read'))) ||
        isMarketingSupervisor;

      // Auto-pin to self ONLY for rank-and-file MBs. Supervisors fall through
      // so `applyMarketingSupervisorScope` can broaden to their team.
      const pinToSelf = isMediaBuyer && !isMarketingSupervisor;
      let adSpendCountsScope: typeof input & { mediaBuyerId?: string; mediaBuyerIds?: string[] } = {
        ...input,
        ...(pinToSelf ? { mediaBuyerId: ctx.user.id } : {}),
      };
      let campaignsScope: { mediaBuyerId?: string; mediaBuyerIds?: string[]; page: number; limit: number } = {
        page: 1,
        limit: input.campaignsLimit,
        ...(pinToSelf ? { mediaBuyerId: ctx.user.id } : {}),
      };
      adSpendCountsScope = await applyMarketingSupervisorScope(ctx, adSpendCountsScope);
      campaignsScope = await applyMarketingSupervisorScope(ctx, campaignsScope);

      const supervisorBuyerIds =
        isMarketingSupervisor && campaignsScope.mediaBuyerIds && campaignsScope.mediaBuyerIds.length > 0
          ? campaignsScope.mediaBuyerIds
          : null;

      const [adSpendStatusCounts, campaigns, buyersResult, teamsRaw] = await Promise.all([
        getMarketingService().adSpendStatusCounts(adSpendCountsScope, branchId, ctx.effectiveBranchIds),
        // Forms are global — never branch-scoped (but company-group-scoped via effectiveBranchIds).
        getMarketingService().listCampaigns(campaignsScope, null, { enrichProductIds: false, effectiveBranchIds: ctx.effectiveBranchIds }),
        canSeeBuyerPicklist
          ? supervisorBuyerIds
            ? getUsersService()
                .listByIds(supervisorBuyerIds)
                .then((rows) => ({ users: rows, total: rows.length }))
            : getUsersService().list(
                {
                  page: 1,
                  limit: 100,
                  role: 'MEDIA_BUYER',
                  status: 'ACTIVE',
                  sortBy: 'createdAt',
                  sortOrder: 'desc',
                  includeBranchMemberships: false,
                },
                ctx.user,
                branchId,
                ctx.effectiveBranchIds,
              )
          : Promise.resolve(null),
        // Marketing teams for the team filter (HoM / admin / supervisor only).
        branchId && !isMediaBuyer
          ? getBranchTeamsService().listTeamsWithMembers(branchId).catch(() => [])
          : Promise.resolve([]),
      ]);

      const canApproveAdSpend =
        isAdminLevel(ctx.user) ||
        callerPerms.includes('marketing.adSpend.approve') ||
        (ctx.user.isMarketingTeamSupervisorOnActiveBranch === true && !!branchId);

      // Marketing teams with their MB member IDs — drives the Team filter dropdown.
      const marketingTeams = (teamsRaw ?? [])
        .filter((t) => t.department === 'MARKETING')
        .map((t) => ({
          id: t.id,
          name: t.name ?? 'Unnamed team',
          memberIds: t.members.map((m) => m.userId),
        }));

      // The branch-scoped users.list may miss MBs who were removed from the
      // branch but still have ad-spend records (or daily-flow rows with
      // campaignId=NULL). Merge any extra MB IDs actually present in ad_spend_logs
      // so the filter dropdown always lets you reach every row in the list.
      let mediaBuyersForFilter = buyersResult
        ? (buyersResult.users ?? []).map((u) => ({ id: u.id, name: u.name }))
        : [];

      if (canSeeBuyerPicklist && !supervisorBuyerIds) {
        const knownIds = new Set(mediaBuyersForFilter.map((b) => b.id));
        const extraBuyerIds = await getMarketingService().distinctAdSpendMediaBuyerIds(branchId, ctx.effectiveBranchIds);
        const missingIds = extraBuyerIds.filter((id) => !knownIds.has(id));
        if (missingIds.length > 0) {
          const extraUsers = await getUsersService().listByIds(missingIds);
          mediaBuyersForFilter = [
            ...mediaBuyersForFilter,
            ...extraUsers.map((u) => ({ id: u.id, name: u.name })),
          ];
        }
      }

      return {
        adSpendStatusCounts,
        campaigns: campaigns.campaigns ?? [],
        mediaBuyersForFilter,
        marketingTeams,
        canApproveAdSpend,
      };
    }),

  /**
   * Single-request bundle for `/admin/finance/disbursements`.
   *
   * Replaces 6 parallel loader calls — `marketing.listFunding`,
   * `marketing.listFundingBalances`, `marketing.fundingSummary`,
   * `marketing.listFundingRequests`, `marketing.fundingRequestStatusCounts`, and
   * `users.list` — with one HTTP request. Same fan-out runs server-side.
   *
   * Permission gate matches the page (`finance.disburse`).
   */
  disbursementsPageBundle: permissionProcedure('finance.disburse')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        status: z.enum(['SENT', 'COMPLETED', 'DISPUTED']).optional(),
        receiverId: z.string().uuid().optional(),
        search: z.string().trim().max(200).optional(),
        requestsPage: z.number().int().min(1).default(1),
        requestsLimit: z.number().int().min(1).max(100).default(20),
        usersLimit: z.number().int().min(1).max(500).default(200),
      }),
    )
    .query(async ({ input, ctx }) => {
      const branchId = ctx.currentBranchId;

      const listFundingInput = {
        page: input.page,
        limit: input.limit,
        receiverRole: 'HEAD_OF_MARKETING' as const,
        ...(input.startDate && { startDate: input.startDate }),
        ...(input.endDate && { endDate: input.endDate }),
        ...(input.status && { status: input.status }),
        ...(input.receiverId && { receiverId: input.receiverId }),
        ...(input.search && { search: input.search }),
      };

      // Mirror the standalone `listFundingRequests`/`fundingRequestStatusCounts`
      // scoping for non-company-wide callers (target = caller). Finance / Admin
      // are company-wide and see every pending HoM disbursement request on this
      // page — they are the disbursers, not the targets.
      //
      // `requesterRole: 'HEAD_OF_MARKETING'` is the key scope for this page:
      // Finance disburses to Heads of Marketing only — Media Buyer funding
      // requests are the HoM's to manage, not Finance's, so they must not
      // appear on the Disbursements pending tab or in its status counts.
      const seesAllRequests = isAdminLevel(ctx.user) || hasFinanceAccess(ctx.user);
      const requestsInput = {
        page: input.requestsPage,
        limit: input.requestsLimit,
        requesterRole: 'HEAD_OF_MARKETING' as const,
        ...(seesAllRequests ? {} : { targetUserId: ctx.user.id }),
      };

      // Pre-fetch HoM IDs so we can scope the summary to Finance→HoM transfers only.
      const homBalances = await getMarketingService().listFundingBalances(ctx.user, branchId, undefined, ctx.effectiveBranchIds);
      const homUserIds = homBalances
        .filter((b) => b.role === 'HEAD_OF_MARKETING')
        .map((b) => b.userId);

      const [funding, summary, requests, requestsCounts, users] =
        await Promise.all([
          getMarketingService().listFunding(listFundingInput, branchId, ctx.effectiveBranchIds),
          getMarketingService().getFundingSummary(branchId, {
            restrictToReceiverIds: homUserIds,
            ...(input.startDate && { startDate: input.startDate }),
            ...(input.endDate && { endDate: input.endDate }),
          }, ctx.effectiveBranchIds),
          getMarketingService().listFundingRequests(requestsInput, branchId, ctx.effectiveBranchIds),
          getMarketingService().fundingRequestStatusCounts(
            {
              requesterRole: 'HEAD_OF_MARKETING',
              ...(seesAllRequests ? {} : { targetUserId: ctx.user.id }),
            },
            ctx.user,
            branchId,
            ctx.effectiveBranchIds,
          ),
          // Requesters list — id + name + role only.
          getUsersService().list(
            {
              page: 1,
              limit: input.usersLimit,
              sortBy: 'createdAt',
              sortOrder: 'desc',
              includeBranchMemberships: false,
            },
            ctx.user,
            branchId,
            ctx.effectiveBranchIds,
          ),
        ]);
      const balances = homBalances;

      return {
        funding,
        balances,
        summary,
        requests,
        requestsCounts,
        users: (users.users ?? []).map((u) => ({
          id: u.id,
          name: u.name,
          email: (u as { email?: string }).email ?? '',
          role: u.role,
        })),
      };
    }),

  /**
   * Single-request bundle for `/admin/marketing/funding`.
   *
   * Replaces up to 14 parallel HTTP round-trips — direction summary, status
   * counts (incoming + outgoing + my-requests + mb-requests), funding ledger
   * (received + distributing transfers + requests), funding balance,
   * balances list, users picklist, branches list, request recipients — with
   * a single request. All fan-out runs server-side via `Promise.all`.
   *
   * Replicates the conditional fetch logic from
   * `apps/web/app/routes/admin.marketing.funding/route.tsx` so empty slices
   * stay empty (no wasted DB hits) and admin-only slices only run for
   * `isFundingAdmin` callers.
   */
  fundingPageBundle: permissionProcedure('marketing.read')
    .input(
      z.object({
        section: z.enum(['received', 'distributing']).default('distributing'),
        entryType: z.enum(['all', 'transfer', 'request']).default('all'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        mergedFetchLimit: z.number().int().min(1).max(100).default(100),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        status: z.enum(['SENT', 'COMPLETED', 'DISPUTED']).optional(),
        requestStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
        search: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const branchId = ctx.currentBranchId;
      const role = ctx.user.role;
      const isMediaBuyer = role === 'MEDIA_BUYER';
      const isMarketingSupervisor = isMediaBuyer && ctx.user.isTeamSupervisor && branchId
        ? await getBranchTeamsService().isMarketingSupervisorOnBranch(ctx.user.id, branchId)
        : false;
      const isFundingAdmin =
        isAdminLevel(ctx.user) ||
        role === 'HEAD_OF_MARKETING' ||
        role === 'FINANCE_OFFICER' ||
        isMarketingSupervisor;
      const canDistribute = !isMediaBuyer || isMarketingSupervisor;
      const canRequestFunding =
        role === 'MEDIA_BUYER' || role === 'HEAD_OF_MARKETING' || isMarketingSupervisor;
      const showFundingBalance =
        role === 'MEDIA_BUYER' || role === 'HEAD_OF_MARKETING' || isMarketingSupervisor;

      // Same skip logic as the loader: if `entryStatus` is request-only
      // (PENDING/APPROVED/REJECTED), the transfer ledger pull is wasted; same in
      // reverse for transfer-only statuses.
      const skipTransfersForStatus =
        input.entryType !== 'transfer' && !!input.requestStatus && !input.status;
      const skipRequestsForStatus =
        input.entryType !== 'request' && !!input.status && !input.requestStatus;

      const dateRange = {
        ...(input.startDate && { startDate: input.startDate }),
        ...(input.endDate && { endDate: input.endDate }),
      };
      const transferPage = input.entryType === 'transfer' ? input.page : 1;
      const transferLimit = input.entryType === 'transfer' ? input.limit : input.mergedFetchLimit;
      const requestPage = input.entryType === 'request' ? input.page : 1;
      const requestLimit = input.entryType === 'request' ? input.limit : input.mergedFetchLimit;

      type ListFundingArgs = ListFundingInput;
      type ListFundingRequestsArgs = ListFundingRequestsInput;

      // Build per-section fetch promises. The same MarketingService.listFunding
      // backs both received (receiverId) and distributing (senderId) paths.
      const buildTransferInput = (mode: 'received' | 'distributing'): ListFundingArgs | null => {
        if (input.section !== mode) return null;
        if (input.entryType === 'request' || skipTransfersForStatus) return null;
        return {
          page: transferPage,
          limit: transferLimit,
          ...(mode === 'received'
            ? { receiverId: ctx.user.id }
            : { senderId: ctx.user.id }),
          ...dateRange,
          ...(input.status && { status: input.status }),
          ...(input.search && { search: input.search }),
        };
      };
      const buildRequestInput = (mode: 'received' | 'distributing'): ListFundingRequestsArgs | null => {
        if (input.section !== mode) return null;
        if (input.entryType === 'transfer' || skipRequestsForStatus) return null;
        return {
          page: requestPage,
          limit: requestLimit,
          ...(mode === 'received'
            ? { requesterId: ctx.user.id }
            : { excludeSelfAsRequester: true, callerId: ctx.user.id }),
          ...dateRange,
          ...(input.requestStatus && { status: input.requestStatus }),
          ...(input.search && { search: input.search }),
        };
      };

      const receivedTransferInput = buildTransferInput('received');
      const receivedRequestInput = buildRequestInput('received');
      const distributingTransferInput = buildTransferInput('distributing');
      const distributingRequestInput = buildRequestInput('distributing');

      // Run all 14 calls in parallel server-side. Branch list + funding balance
      // are scoped by user; counts always run; ledger calls are conditional.
      const [
        directionSummary,
        usersResult,
        balancesList,
        fundingBalance,
        branches,
        fundingRequestRecipients,
        incomingCounts,
        myRequestsCounts,
        outgoingCounts,
        mbRequestsCounts,
        receivedTransfers,
        receivedRequests,
        distributingTransfers,
        distributingRequests,
      ] = await Promise.all([
        getMarketingService().fundingByDirectionSummary(ctx.user.id, dateRange, ctx.effectiveBranchIds),
        isFundingAdmin
          ? (async () => {
              // Supervisors see only their team members as funding recipients
              if (isMarketingSupervisor) {
                const scope = await getBranchTeamsService().listSupervisorScopeIds(ctx.user.id, branchId!);
                const teamMemberIds = scope.marketingUserIds.filter((id) => id !== ctx.user.id);
                if (teamMemberIds.length === 0) return null;
                return getUsersService().list(
                  { page: 1, limit: 200, sortBy: 'createdAt' as const, sortOrder: 'desc' as const, includeBranchMemberships: false, userIds: teamMemberIds },
                  ctx.user,
                  branchId,
                  ctx.effectiveBranchIds,
                );
              }
              return getUsersService().list(
                { page: 1, limit: 200, sortBy: 'createdAt' as const, sortOrder: 'desc' as const, includeBranchMemberships: false },
                ctx.user,
                branchId,
                ctx.effectiveBranchIds,
              );
            })()
          : Promise.resolve(null),
        isFundingAdmin
          ? getMarketingService().listFundingBalances(ctx.user, branchId, undefined, ctx.effectiveBranchIds).catch(() => null)
          : Promise.resolve(null),
        showFundingBalance
          ? getMarketingService().getFundingBalance(ctx.user.id, branchId, ctx.effectiveBranchIds)
          : Promise.resolve(null),
        ctx.currentBranchId
          ? listBranchesForUser(ctx.user).catch(() => [] as Array<{ id: string; name: string }>)
          : Promise.resolve([] as Array<{ id: string; name: string }>),
        canRequestFunding
          ? getMarketingService()
              .listFundingRequestRecipients(
                role as 'MEDIA_BUYER' | 'HEAD_OF_MARKETING',
                branchId,
                ctx.user.id,
              )
              .catch(() => [] as Array<unknown>)
          : Promise.resolve([] as Array<unknown>),
        getMarketingService().fundingStatusCounts(
          { receiverId: ctx.user.id, ...dateRange },
          branchId,
          ctx.effectiveBranchIds,
        ),
        getMarketingService().fundingRequestStatusCounts(
          { requesterId: ctx.user.id, ...dateRange },
          ctx.user,
          branchId,
          ctx.effectiveBranchIds,
        ),
        canDistribute
          ? getMarketingService().fundingStatusCounts(
              { senderId: ctx.user.id, ...dateRange },
              branchId,
              ctx.effectiveBranchIds,
            )
          : Promise.resolve(null),
        canDistribute
          ? getMarketingService().fundingRequestStatusCounts(
              { excludeSelfAsRequester: true, ...dateRange },
              ctx.user,
              branchId,
              ctx.effectiveBranchIds,
            )
          : Promise.resolve(null),
        receivedTransferInput
          ? getMarketingService().listFunding(receivedTransferInput, branchId, ctx.effectiveBranchIds)
          : Promise.resolve(null),
        receivedRequestInput
          ? getMarketingService().listFundingRequests(receivedRequestInput, branchId, ctx.effectiveBranchIds)
          : Promise.resolve(null),
        distributingTransferInput
          ? getMarketingService().listFunding(distributingTransferInput, branchId, ctx.effectiveBranchIds)
          : Promise.resolve(null),
        distributingRequestInput
          ? getMarketingService().listFundingRequests(distributingRequestInput, branchId, ctx.effectiveBranchIds)
          : Promise.resolve(null),
      ]);

      return {
        directionSummary,
        users: usersResult
          ? (usersResult.users ?? []).map((u) => ({
              id: u.id,
              name: u.name,
              email: (u as { email?: string }).email ?? '',
              role: u.role,
            }))
          : [],
        balancesList,
        fundingBalance,
        branches,
        fundingRequestRecipients,
        incomingCounts,
        myRequestsCounts,
        outgoingCounts,
        mbRequestsCounts,
        receivedTransfers,
        receivedRequests,
        distributingTransfers,
        distributingRequests,
        // Surface the resolved flags so the loader doesn't re-derive them.
        flags: {
          isMediaBuyer,
          isFundingAdmin,
          canDistribute,
          canRequestFunding,
          showFundingBalance,
        },
      };
    }),

  // ── Cross-Funnel Attempts (per-MB visibility) ───
  /**
   * List cross-funnel attempts the caller is allowed to see.
   * Strictly per-MB visibility — Media Buyers see their own; HoM sees their branch;
   * admin-class sees all. CS / non-marketing roles get an empty list.
   */
  listMyCrossFunnelAttempts: authedProcedure
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        productId: z.string().uuid().optional(),
        campaignId: z.string().uuid().optional(),
        mediaBuyerId: z.string().uuid().optional(),
        search: z.string().max(200).optional(),
        duplicateType: z.enum(['resubmission', 'same-mb', 'cross-funnel']).optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getMarketingService().listMyCrossFunnelAttempts(
        ctx.user,
        input,
        ctx.currentBranchId,
        ctx.effectiveBranchIds,
      );
    }),

  /**
   * Aggregate stats (count, unique customers, per-product breakdown) for the
   * caller's cross-funnel attempts view. Used by the marketing dashboard.
   */
  crossFunnelStats: authedProcedure
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getMarketingService().crossFunnelStats(
        ctx.user,
        input,
        ctx.currentBranchId,
        ctx.effectiveBranchIds,
      );
    }),

  // ── Public Endpoint (Edge Worker) ──────────────
  /**
   * Public campaign config for the Edge Worker form rendering.
   * No auth required — called by Cloudflare Edge Worker to load
   * campaign details, products, and form config for the sales form.
   */
  getPublic: publicProcedure
    .input(z.object({ campaignId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getMarketingService().getPublicCampaign(input.campaignId);
    }),
});
