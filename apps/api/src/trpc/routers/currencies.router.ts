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

  /**
   * The countries this caller may actually SELECT in the switcher.
   *
   * Deliberately separate from `listActive`: that is the company's money-
   * rendering catalog (every authed user needs every code to format an amount
   * correctly, including codes they cannot browse), so filtering it to a user's
   * grants would mislabel other countries' totals.
   *
   * The switcher previously built its options straight from `listActive`, so a
   * country-scoped user was shown countries they had no grant for and got
   * "You do not have access to that country." on click. This returns the
   * selectable set instead.
   *
   * `null` means "every active currency in this company" (all-countries users).
   */
  selectableCountries: authedProcedure.query(async ({ ctx }) => {
    const active = await getCurrenciesService().listActive(ctx.activeGroupId ?? null);
    // The PERMISSION set, not `effectiveCurrencyCodes` — that one is already
    // narrowed to the current selection, so using it would show a user who has
    // picked Kenya only Kenya, with no way back.
    const allowed = ctx.permittedCurrencyCodes;
    return {
      /** Codes this user may switch to, or null for all of `currencies`. */
      allowedCodes: allowed,
      currencies: allowed == null ? active : active.filter((c) => allowed.includes(c.code)),
    };
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

  /**
   * Go-dark safeguard (multi-country): active non-default currencies that have
   * order data but no assigned Finance / Stock Manager / HoL user. Drives the
   * admin dashboard banner. Gated on currency management so only admins see it.
   */
  unassignedCountryAlarms: permissionProcedure('countries.manage').query(async ({ ctx }) => {
    return getCurrenciesService().getUnassignedCountryAlarms(ctx.activeGroupId ?? null);
  }),
});
