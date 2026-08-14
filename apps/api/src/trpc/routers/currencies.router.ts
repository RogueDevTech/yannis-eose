import {
  createCurrencySchema,
  updateCurrencySchema,
  setFxRateSchema,
  setDefaultCurrencySchema,
  listCurrenciesSchema,
} from '@yannis/shared';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { CurrenciesService } from '../../currencies/currencies.service';

let currenciesServiceInstance: CurrenciesService | null = null;

export function setCurrenciesService(service: CurrenciesService) {
  currenciesServiceInstance = service;
}

export function getCurrenciesService(): CurrenciesService {
  if (!currenciesServiceInstance) {
    throw new Error('CurrenciesService not initialized. Call setCurrenciesService() first.');
  }
  return currenciesServiceInstance;
}

/**
 * Resolve the company (branch group) to scope a currency op to.
 * Non–SuperAdmin callers are locked to their session company; SuperAdmin/Support
 * may pass an explicit groupId (for per-company config).
 */
function resolveGroupId(
  inputGroupId: string | null | undefined,
  ctxGroupId: string | null,
  role?: string,
): string | null {
  if (role === 'SUPER_ADMIN' || role === 'SUPPORT') {
    return inputGroupId !== undefined ? inputGroupId : ctxGroupId ?? null;
  }
  return ctxGroupId ?? null;
}

export const currenciesRouter = router({
  /**
   * Active currencies for the caller's company — the app-wide catalog + dormancy
   * source. authedProcedure (not permission-gated): every authed user needs to
   * know the currency list to render money. Read-only.
   */
  listActive: authedProcedure.query(async ({ ctx }) => {
    return getCurrenciesService().listActive(ctx.activeGroupId ?? null);
  }),

  /** Full list (incl. inactive) for the config panel. */
  list: permissionProcedure('settings.currencies.view').input(listCurrenciesSchema).query(async ({ input, ctx }) => {
    return getCurrenciesService().list({
      ...input,
      groupId: resolveGroupId(input.groupId, ctx.activeGroupId ?? null, ctx.user.role),
    });
  }),

  create: permissionProcedure('settings.currencies.manage')
    .input(createCurrencySchema)
    .mutation(async ({ input, ctx }) => {
      return getCurrenciesService().create(
        { ...input, groupId: resolveGroupId(input.groupId, ctx.activeGroupId ?? null, ctx.user.role) },
        { id: ctx.user.id },
        ctx.activeGroupId ?? null,
      );
    }),

  update: permissionProcedure('settings.currencies.manage')
    .input(updateCurrencySchema)
    .mutation(async ({ input, ctx }) => {
      return getCurrenciesService().update(input, { id: ctx.user.id }, ctx.activeGroupId ?? null);
    }),

  setFxRate: permissionProcedure('settings.currencies.manage')
    .input(setFxRateSchema)
    .mutation(async ({ input, ctx }) => {
      return getCurrenciesService().setFxRate(input, { id: ctx.user.id }, ctx.activeGroupId ?? null);
    }),

  setDefault: permissionProcedure('settings.currencies.manage')
    .input(setDefaultCurrencySchema)
    .mutation(async ({ input, ctx }) => {
      return getCurrenciesService().setDefault(input, { id: ctx.user.id }, ctx.activeGroupId ?? null);
    }),
});
