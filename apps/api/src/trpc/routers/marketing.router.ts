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
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
  listOfferTemplatesSchema,
  archiveAllOfferTemplatesForProductSchema,
  createOfferGroupSchema,
  updateOfferGroupSchema,
  listOfferGroupsSchema,
  getOfferGroupSchema,
  clearLegacyOfferTemplatesSchema,
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, authedProcedure, permissionProcedure } from '../trpc';
import { MarketingService } from '../../marketing/marketing.service';
import { getBranchTeamsService } from './branches.router';

let marketingServiceInstance: MarketingService | null = null;

export function setMarketingService(service: MarketingService) {
  marketingServiceInstance = service;
}

function getMarketingService(): MarketingService {
  if (!marketingServiceInstance) {
    throw new Error('MarketingService not initialized. Call setMarketingService() first.');
  }
  return marketingServiceInstance;
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
      return getMarketingService().listFunding(input, ctx.currentBranchId);
    }),

  fundingStatusCounts: authedProcedure
    .input(fundingStatusCountsSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().fundingStatusCounts(input, ctx.currentBranchId);
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
      );
    }),

  fundingSummary: permissionProcedure('marketing.fundingSummary')
    .query(async ({ ctx }) => {
      return getMarketingService().getFundingSummary(ctx.currentBranchId);
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
      return getMarketingService().getFundingBalanceWithAuth(input.userId, ctx.user, ctx.currentBranchId);
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
      return getMarketingService().listFundingBalances(ctx.user, ctx.currentBranchId);
    }),

  /** Recipient candidates for the Request Funding modal (migration 0106). MBs get
   *  HoMs in their branch + Finance Officers (org-wide); HoMs get Finance Officers. */
  listFundingRequestRecipients: permissionProcedure('marketing.funding.request')
    .query(async ({ ctx }) => {
      const requesterRole: 'MEDIA_BUYER' | 'HEAD_OF_MARKETING' =
        ctx.user.role === 'HEAD_OF_MARKETING' ? 'HEAD_OF_MARKETING' : 'MEDIA_BUYER';
      return getMarketingService().listFundingRequestRecipients(requesterRole, ctx.currentBranchId);
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
      // MB visibility is always self-only (defense-in-depth). For other roles,
      // honour the explicit `requesterId` or `excludeSelfAsRequester` filters from the caller.
      const requesterId = ctx.user.role === 'MEDIA_BUYER' ? ctx.user.id : input.requesterId;
      const excludeSelfAsRequester =
        ctx.user.role !== 'MEDIA_BUYER' && !requesterId && input.excludeSelfAsRequester;

      // Migration 0106 — auto-scope inbox views to requests targeted at the
      // caller. Admin-class (SuperAdmin / Admin) bypass scoping and see every
      // request. MBs are already self-scoped via `requesterId`. For everyone
      // else (HoM, Finance, branch heads), we apply `targetUserId = ctx.user.id`
      // when the caller isn't asking for their own outbound — turning the
      // "all pending requests" view into "my inbox". Legacy NULL-target rows
      // (pre-migration broadcasts) are still included so historical audiences
      // keep visibility until those rows close out.
      const isAdminClass = ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN';
      const askingForOwnOutbound = requesterId === ctx.user.id;
      const targetUserId =
        !isAdminClass && !askingForOwnOutbound
          ? (input.targetUserId ?? ctx.user.id)
          : input.targetUserId;
      const includeLegacyNullTarget = !isAdminClass && !askingForOwnOutbound;

      return getMarketingService().listFundingRequests(
        {
          requesterId,
          excludeSelfAsRequester,
          targetUserId,
          includeLegacyNullTarget,
          callerId: ctx.user.id,
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status,
          search: input.search,
          page: input.page,
          limit: input.limit,
        },
        ctx.currentBranchId,
      );
    }),

  /**
   * HoM / custom roles: `marketing.funding.approve`.
   * Finance disbursements (`/admin/finance/disbursements`): `finance.disburse` only — catalog
   * removed `marketing.funding.approve` from FINANCE_OFFICER (2026-05-05); both codes OR here.
   */
  approveFundingRequest: permissionProcedure('marketing.funding.approve', 'finance.disburse')
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

  /** Approve parity — Finance rejects from disbursements inbox with same gate as approve. */
  rejectFundingRequest: permissionProcedure('marketing.funding.approve', 'finance.disburse')
    .meta({ branchScopedMutation: true })
    .input(rejectFundingRequestSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().rejectFundingRequest(input.requestId, input.reason, {
        id: ctx.user.id,
        role: ctx.user.role,
      });
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
      const effectiveInput = ctx.user.role === 'MEDIA_BUYER'
        ? { ...input, mediaBuyerId: ctx.user.id }
        : input;
      return getMarketingService().listAdSpend(effectiveInput, ctx.currentBranchId);
    }),

  /**
   * Grouped accordion view: each result row is one (date × MB) batch with
   * line items. Same role scoping as listAdSpend — Media Buyers see only
   * their own.
   */
  listAdSpendGrouped: authedProcedure
    .input(listAdSpendGroupedSchema)
    .query(async ({ input, ctx }) => {
      const effectiveInput =
        ctx.user.role === 'MEDIA_BUYER' ? { ...input, mediaBuyerId: ctx.user.id } : input;
      return getMarketingService().listAdSpendGrouped(effectiveInput, ctx.currentBranchId);
    }),

  adSpendStatusCounts: authedProcedure
    .input(adSpendStatusCountsSchema)
    .query(async ({ input, ctx }) => {
      const effectiveInput =
        ctx.user.role === 'MEDIA_BUYER' ? { ...input, mediaBuyerId: ctx.user.id } : input;
      return getMarketingService().adSpendStatusCounts(effectiveInput, ctx.currentBranchId);
    }),

  /** Orders since last APPROVED spend (same funnel) + indicative CPA — Log Ad Spend form preview. */
  previewAdSpendInterval: permissionProcedure('marketing.adSpend')
    .input(previewAdSpendIntervalSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().previewAdSpendInterval(input, ctx.user.id, ctx.currentBranchId);
    }),

  /** Phase 20: gated by `marketing.adSpend.approve` (HoM + Admin templates). */
  approveAdSpend: permissionProcedure('marketing.adSpend.approve')
    .meta({ branchScopedMutation: true })
    .input(approveAdSpendSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().approveAdSpend(input.adSpendId, ctx.user.id);
    }),

  /** Phase 20: same `marketing.adSpend.approve` covers both approve and reject. */
  rejectAdSpend: permissionProcedure('marketing.adSpend.approve')
    .meta({ branchScopedMutation: true })
    .input(rejectAdSpendSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().rejectAdSpend(input.adSpendId, input.reason, ctx.user.id);
    }),

  updateAdSpend: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(updateAdSpendSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...adSpendInput } = input;
      return getMarketingService().updateAdSpend(adSpendInput, { id: ctx.user.id, role: ctx.user.role }, branchId ?? ctx.currentBranchId);
    }),

  // ── Performance Metrics ──────────────────────────
  metrics: authedProcedure
    .input(
      z.object({
        mediaBuyerId: z.string().uuid().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getMarketingService().getPerformanceMetrics(
        input.mediaBuyerId,
        input.startDate && input.endDate ? 'this_month' : 'all_time',
        input.startDate,
        input.endDate,
        ctx.currentBranchId,
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
      );
    }),

  checkHighCpa: permissionProcedure('marketing.checkHighCpa')
    .input(z.object({ threshold: z.number().positive() }))
    .query(async ({ input, ctx }) => {
      return getMarketingService().checkHighCpaAlerts(input.threshold, ctx.currentBranchId);
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
    .query(async ({ input }) => {
      return getMarketingService().listOfferTemplates(input);
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
    .query(async ({ input }) => {
      return getMarketingService().listOfferGroups(input);
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
    .input(createCampaignSchema.extend({ branchId: z.string().uuid().optional() }))
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
      return getMarketingService().listCampaigns(input, ctx.currentBranchId);
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
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return getMarketingService().listMyCrossFunnelAttempts(
        ctx.user,
        input,
        ctx.currentBranchId,
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
