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
        /** Free text over external id, customer name, order number. */
        search: z.string().max(120).optional(),
        /** The imported order's own lifecycle status. */
        orderStatus: z.string().max(40).optional(),
        /** Failure-reason bucket (see REASON_KINDS). */
        reasonKind: z.string().max(40).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().listRows(input.jobId, {
        page: input.page,
        limit: input.limit,
        status: input.status,
        search: input.search,
        orderStatus: input.orderStatus,
        reasonKind: input.reasonKind,
      });
    }),

  /** Counts per import outcome / order status / failure reason, for the filters. */
  rowFacets: authedProcedure
    .input(importJobIdSchema)
    .query(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().getRowFacets(input.jobId);
    }),

  /**
   * One row plus the source cells kept when it FAILED, for the fix-and-resubmit
   * form on the job page.
   */
  getRow: authedProcedure
    .input(z.object({ jobId: z.string().uuid(), rowIndex: z.number().int().min(0) }))
    .query(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      const row = await getBulkImportService().getRow(input.jobId, input.rowIndex);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Row not found' });
      return row;
    }),

  /**
   * Valid products / users / currencies / statuses for this job's company, so
   * the fix form offers only values that will actually resolve.
   */
  getRowOptions: authedProcedure
    .input(importJobIdSchema)
    .query(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().getRowOptions(input.jobId);
    }),

  /**
   * Re-import a single FAILED row after the user corrected it. Runs the SAME
   * mapRow + upsert path as the worker, so a fixed row gets identical validation
   * and an identical audit trail. Returns `{ ok: false, reason }` when the row
   * still doesn't validate, so the form can show the next problem inline.
   */
  resubmitRow: authedProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        rowIndex: z.number().int().min(0),
        // Edited cells keyed by the file's own header names.
        values: z.record(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().resubmitRow(
        input.jobId,
        input.rowIndex,
        input.values,
        ctx.user.id,
      );
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

  /**
   * Operator pause. A PROCESSING job stops at its next chunk boundary, so this
   * returns `pending: true` to say the stop is requested but not yet in effect.
   */
  pause: authedProcedure
    .input(importJobIdSchema)
    .mutation(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().pause(input.jobId, ctx.user.id);
    }),

  /** Re-run only the failed rows (resets cursor to the first failure). */
  retryFailed: authedProcedure
    .input(importJobIdSchema)
    .mutation(async ({ input, ctx }) => {
      assertImporter(ctx.user.role);
      return getBulkImportService().retryFailed(input.jobId, ctx.user.id);
    }),
});
