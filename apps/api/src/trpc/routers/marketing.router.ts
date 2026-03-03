import {
  createFundingSchema,
  verifyFundingSchema,
  listFundingSchema,
  createAdSpendSchema,
  listAdSpendSchema,
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
  listOfferTemplatesSchema,
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsSchema,
} from '@yannis/shared';
import { z } from 'zod';
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

  // ── Ad Spend ─────────────────────────────────────
  createAdSpend: permissionProcedure('marketing.adSpend')
    .input(createAdSpendSchema)
    .mutation(async ({ input, ctx }) => {
      return getMarketingService().createAdSpend(input, ctx.user.id);
    }),

  listAdSpend: authedProcedure
    .input(listAdSpendSchema)
    .query(async ({ input }) => {
      return getMarketingService().listAdSpend(input);
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
        'this_month',
        input.startDate,
        input.endDate,
      );
    }),

  // ── Media Buyer Leaderboard ─────────────────────
  leaderboard: permissionProcedure('marketing.leaderboard')
    .input(
      z.object({ period: z.enum(['this_month', 'all_time']).optional().default('this_month') }),
    )
    .query(async ({ input }) => {
      return getMarketingService().getMediaBuyerLeaderboard(input.period ?? 'this_month');
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
