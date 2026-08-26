import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  createImportJobSchema,
  importJobIdSchema,
} from '@yannis/shared';
import { router, authedProcedure } from '../trpc';
import type { BulkImportService } from '../../orders/bulk-import.service';

// Static-router factory pattern (mirrors orders.router.ts): the Nest service
// singleton is injected at bootstrap via setBulkImportService().
let bulkImportServiceInstance: BulkImportService | null = null;

export function setBulkImportService(service: BulkImportService) {
  bulkImportServiceInstance = service;
}

function getBulkImportService(): BulkImportService {
  if (!bulkImportServiceInstance) {
    throw new Error('BulkImportService not initialized. Call setBulkImportService() first.');
  }
  return bulkImportServiceInstance;
}

/** SuperAdmin/Support only — matches the existing orders.importOrder gate. */
function assertImporter(role: string) {
  if (role !== 'SUPER_ADMIN' && role !== 'SUPPORT') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only Super Admin and Support can run bulk imports',
    });
  }
}

export const bulkImportRouter = router({
  /**
   * Create a resumable import job. The file is already uploaded to object
   * storage (presigned flow); we persist the job + column mapping and let the
   * @Cron worker drain it in chunks. Returns the job id to poll.
   */
  createJob: authedProcedure
    .input(createImportJobSchema)
    .mutation(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      // Pass the caller's active company + country scope so per-row branch
      // derivation, code resolution, AND currency are scoped to them (the job no
      // longer requires a branchId). effectiveCurrencyCodes is the hard country
      // permission; currentCurrencyCode is the top-bar country selection.
      return getBulkImportService().createJob(input, ctx.user.id, ctx.activeGroupId ?? null, {
        allowedCurrencyCodes: ctx.effectiveCurrencyCodes,
        selectedCurrencyCode: ctx.currentCurrencyCode,
      });
    }),

  /** Poll a job's live progress (processed/total/failed, status, error log). */
  getStatus: authedProcedure
    .input(importJobIdSchema)
    .query(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      const job = await getBulkImportService().getStatus(input.jobId);
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' });
      return job;
    }),

  /** Recent import jobs for the history panel. */
  list: authedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().listJobs(input?.limit ?? 20);
    }),

  /** Paginated per-row outcomes (IMPORTED / WARNING / FAILED) for a job. */
  listRows: authedProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        status: z.enum(['IMPORTED', 'WARNING', 'FAILED']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().listRows(input.jobId, {
        page: input.page,
        limit: input.limit,
        status: input.status,
      });
    }),

  /** Delete an import job + its row records (does NOT delete imported orders). */
  delete: authedProcedure
    .input(importJobIdSchema)
    .mutation(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().deleteJob(input.jobId, ctx.user.id);
    }),

  /** Continue a PAUSED/FAILED job from its saved cursor. */
  resume: authedProcedure
    .input(importJobIdSchema)
    .mutation(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().resume(input.jobId, ctx.user.id);
    }),

  /** Re-run only the failed rows (resets cursor to the first failure). */
  retryFailed: authedProcedure
    .input(importJobIdSchema)
    .mutation(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().retryFailed(input.jobId, ctx.user.id);
    }),
});
