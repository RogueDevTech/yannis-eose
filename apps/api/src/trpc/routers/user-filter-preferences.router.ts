import {
  upsertFilterPreferenceSchema,
  deleteFilterPreferenceSchema,
  getFilterPreferenceSchema,
} from '@yannis/shared';
import { router, authedProcedure } from '../trpc';
import type { UserFilterPreferencesService } from '../../user-filter-preferences/user-filter-preferences.service';

let serviceInstance: UserFilterPreferencesService | null = null;

export function setUserFilterPreferencesService(svc: UserFilterPreferencesService) {
  serviceInstance = svc;
}

function getService() {
  if (!serviceInstance) throw new Error('UserFilterPreferencesService not initialized');
  return serviceInstance;
}

export const userFilterPreferencesRouter = router({
  /** Get ALL saved preferences for the current user. */
  getAll: authedProcedure.query(async ({ ctx }) => {
    return getService().getAllForUser(ctx.user.id);
  }),

  /** Get saved preferences for a single page. */
  getForPage: authedProcedure
    .input(getFilterPreferenceSchema)
    .query(async ({ ctx, input }) => {
      return getService().getForPage(ctx.user.id, input.pageKey);
    }),

  /** Upsert (save/overwrite) filter preferences for a page. */
  upsert: authedProcedure
    .input(upsertFilterPreferenceSchema)
    .mutation(async ({ ctx, input }) => {
      await getService().upsert(ctx.user.id, input.pageKey, input.filters);
      return { success: true };
    }),

  /** Delete saved preferences for a page. */
  delete: authedProcedure
    .input(deleteFilterPreferenceSchema)
    .mutation(async ({ ctx, input }) => {
      await getService().deleteForPage(ctx.user.id, input.pageKey);
      return { success: true };
    }),
});
