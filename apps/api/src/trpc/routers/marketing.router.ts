import {
  createFundingSchema,
  verifyFundingSchema,
  listFundingSchema,
  listFundingRequestsSchema,
  getFundingBalanceSchema,
  approveFundingRequestSchema,
  rejectFundingRequestSchema,
  createAdSpendSchema,
  listAdSpendSchema,
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
    .query(async ({ input }) => {
      return getMarketingService().listFunding(input);
    }),

  fundingSummary: permissionProcedure('marketing.fundingSummary')
    .query(async () => {
      return getMarketingService().getFundingSummary();
    }),

  /** Funding balance for one user. Allowed: own; HoM viewing MB; SA/FO; users.read viewing HoM/MB. */
  getFundingBalance: permissionProcedure('marketing.fundingSummary', 'marketing.read', 'users.read')
    .input(getFundingBalanceSchema)
    .query(async ({ input, ctx }) => {
      return getMarketingService().getFundingBalanceWithAuth(input.userId, ctx.user);
    }),

  /** List funding balances for recipients. HoM sees self + Media Buyers; SA/FO see all HoM + MB.
   * Super Admin and Head of Marketing allowed by role (no permission required); others need permission. */
  listFundingBalances: authedProcedure
    .use(async ({ ctx, next }) => {
      if (ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'HEAD_OF_MARKETING') {
        return next({ ctx });
      }
      const perms = ctx.user.permissions ?? [];
      const hasAny = ['marketing.fundingSummary', 'marketing.read', 'marketing.teamOverview'].some((p) => perms.includes(p));
      if (!hasAny) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to list funding balances' });
      }
      return next({ ctx });
    })
    .query(async ({ ctx }) => {
      return getMarketingService().listFundingBalances(ctx.user);
    }),

  /** Media Buyer only: submit a funding request; notifies Head of Marketing. */
  requestFunding: authedProcedure
    .input(
      z.object({
        amount: z.coerce.number().min(0),
        reason: z.string().max(500).optional().default(''),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'MEDIA_BUYER') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Media Buyers can request funding' });
      }
      return getMarketingService().requestFunding(input.amount, input.reason ?? '', ctx.user.id);
    }),

  listFundingRequests: authedProcedure
    .input(listFundingRequestsSchema)
    .query(async ({ input, ctx }) => {
      const requesterId = ctx.user.role === 'MEDIA_BUYER' ? ctx.user.id : input.requesterId;
      return getMarketingService().listFundingRequests({
        requesterId,
        page: input.page,
        limit: input.limit,
      });
    }),

  /** HoM/SuperAdmin: approve a funding request (after sending money manually) by attaching receipt. Notifies Media Buyer. */
  approveFundingRequest: authedProcedure
    .input(approveFundingRequestSchema)
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'HEAD_OF_MARKETING' && ctx.user.role !== 'SUPER_ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Marketing or Super Admin can approve funding requests' });
      }
      return getMarketingService().approveFundingRequest(input.requestId, input.receiptUrl, ctx.user.id);
    }),

  /** HoM/SuperAdmin: reject a funding request. Notifies Media Buyer. */
  rejectFundingRequest: authedProcedure
    .input(rejectFundingRequestSchema)
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'HEAD_OF_MARKETING' && ctx.user.role !== 'SUPER_ADMIN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Marketing or Super Admin can reject funding requests' });
      }
      return getMarketingService().rejectFundingRequest(input.requestId, input.reason, ctx.user.id);
    }),

  // ── Ad Spend ─────────────────────────────────────
  createAdSpend: permissionProcedure('marketing.adSpend')
    .input(createAdSpendSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().createAdSpend(input, ctx.user.id);
    }),

  listAdSpend: authedProcedure
    .input(listAdSpendSchema)
    .query(async ({ input, ctx }) => {
      // Media Buyers may only see their own ad spend
      const effectiveInput = ctx.user.role === 'MEDIA_BUYER'
        ? { ...input, mediaBuyerId: ctx.user.id }
        : input;
      return getMarketingService().listAdSpend(effectiveInput);
    }),

  approveAdSpend: authedProcedure
    .input(approveAdSpendSchema)
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'HEAD_OF_MARKETING' && ctx.user.role !== 'SUPER_ADMIN') {
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
    .query(async ({ input }) => {
      return getMarketingService().getPerformanceMetrics(
        input.mediaBuyerId,
        input.startDate && input.endDate ? 'this_month' : 'all_time',
        input.startDate,
        input.endDate,
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
    .query(async ({ input }) => {
      return getMarketingService().getMediaBuyerLeaderboard(
        input.period ?? 'this_month',
        input.startDate,
        input.endDate,
      );
    }),

  checkHighCpa: permissionProcedure('marketing.checkHighCpa')
    .input(z.object({ threshold: z.number().positive() }))
    .query(async ({ input }) => {
      return getMarketingService().checkHighCpaAlerts(input.threshold);
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
      return getMarketingService().createCampaign(input, ctx.user.id);
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
    .query(async ({ input }) => {
      return getMarketingService().listCampaigns(input);
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
