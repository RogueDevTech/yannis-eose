import {
  createFundingSchema,
  verifyFundingSchema,
  listFundingSchema,
  fundingStatusCountsSchema,
  fundingRequestStatusCountsSchema,
  listFundingRequestsSchema,
  getFundingBalanceSchema,
  approveFundingRequestSchema,
  rejectFundingRequestSchema,
  createAdSpendSchema,
  listAdSpendSchema,
  adSpendStatusCountsSchema,
  approveAdSpendSchema,
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
  listOfferTemplatesSchema,
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, authedProcedure, permissionProcedure } from '../trpc';
import { MarketingService } from '../../marketing/marketing.service';

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
  createFunding: permissionProcedure('marketing.funding', 'finance.disburse')
    .input(createFundingSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().createFunding(input, ctx.user.id);
    }),

  verifyFunding: authedProcedure
    .input(verifyFundingSchema)
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
      return getMarketingService().fundingRequestStatusCounts(input, ctx.user, ctx.currentBranchId);
    }),

  fundingSummary: permissionProcedure('marketing.fundingSummary')
    .query(async ({ ctx }) => {
      return getMarketingService().getFundingSummary(ctx.currentBranchId);
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

  /** Media Buyer or Head of Marketing: submit a funding request. MB notifies HoM; HoM notifies SuperAdmin + Finance. */
  requestFunding: authedProcedure
    .input(
      z.object({
        amount: z.coerce.number().min(0),
        reason: z.string().max(500).optional().default(''),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'MEDIA_BUYER' && ctx.user.role !== 'HEAD_OF_MARKETING') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Media Buyers or Head of Marketing can request funding' });
      }
      return getMarketingService().requestFunding(
        input.amount,
        input.reason ?? '',
        ctx.user.id,
        ctx.user.role as 'MEDIA_BUYER' | 'HEAD_OF_MARKETING',
        ctx.currentBranchId,
      );
    }),

  listFundingRequests: authedProcedure
    .input(listFundingRequestsSchema)
    .query(async ({ input, ctx }) => {
      const requesterId = ctx.user.role === 'MEDIA_BUYER' ? ctx.user.id : input.requesterId;
      return getMarketingService().listFundingRequests(
        {
          requesterId,
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status,
          page: input.page,
          limit: input.limit,
        },
        ctx.currentBranchId,
      );
    }),

  /** HoM/SuperAdmin/Finance: approve a funding request (after sending money manually) by attaching receipt. Notifies Media Buyer. */
  approveFundingRequest: authedProcedure
    .input(approveFundingRequestSchema)
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'HEAD_OF_MARKETING' && (ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN') && ctx.user.role !== 'FINANCE_OFFICER') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Marketing, Finance Officer, or Super Admin can approve funding requests' });
      }
      return getMarketingService().approveFundingRequest(input.requestId, input.receiptUrl, ctx.user.id);
    }),

  /** HoM/SuperAdmin/Finance: reject a funding request. Notifies Media Buyer. */
  rejectFundingRequest: authedProcedure
    .input(rejectFundingRequestSchema)
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'HEAD_OF_MARKETING' && (ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN') && ctx.user.role !== 'FINANCE_OFFICER') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Marketing, Finance Officer, or Super Admin can reject funding requests' });
      }
      return getMarketingService().rejectFundingRequest(input.requestId, input.reason, ctx.user.id);
    }),

  // ── Ad Spend ─────────────────────────────────────
  createAdSpend: permissionProcedure('marketing.adSpend')
    .input(createAdSpendSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().createAdSpend(input, ctx.user.id, ctx.currentBranchId);
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

  adSpendStatusCounts: authedProcedure
    .input(adSpendStatusCountsSchema)
    .query(async ({ input, ctx }) => {
      const effectiveInput =
        ctx.user.role === 'MEDIA_BUYER' ? { ...input, mediaBuyerId: ctx.user.id } : input;
      return getMarketingService().adSpendStatusCounts(effectiveInput, ctx.currentBranchId);
    }),

  approveAdSpend: authedProcedure
    .input(approveAdSpendSchema)
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'HEAD_OF_MARKETING' && (ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Marketing or Super Admin can approve ad spend' });
      }
      return getMarketingService().approveAdSpend(input.adSpendId, ctx.user.id);
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
  createOfferTemplate: permissionProcedure('marketing.offerTemplate')
    .input(createOfferTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().createOfferTemplate(input, ctx.user.id);
    }),

  updateOfferTemplate: permissionProcedure('marketing.offerTemplate')
    .input(updateOfferTemplateSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().updateOfferTemplate(input, ctx.user.id);
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

  // ── Campaigns ────────────────────────────────────
  createCampaign: permissionProcedure('marketing.campaigns')
    .input(createCampaignSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().createCampaign(input, ctx.user.id, ctx.currentBranchId);
    }),

  updateCampaign: permissionProcedure('marketing.campaigns')
    .input(updateCampaignSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().updateCampaign(input, ctx.user.id);
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
