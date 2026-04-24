import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import type { AuditService } from '../../audit/audit.service';

// Factory pattern — same as all other routers
let auditServiceInstance: AuditService | null = null;

export function setAuditService(service: AuditService) {
  auditServiceInstance = service;
}

function getAuditService(): AuditService {
  if (!auditServiceInstance) {
    throw new Error('AuditService not initialized. Call setAuditService() first.');
  }
  return auditServiceInstance;
}

/**
 * Audit router — open to any authenticated user.
 *
 * Policy (Pillar 4, "Absolute Accountability"): every staff member can see
 * who changed what and when. Column-level security is still enforced via the
 * `stripFinanceFields` middleware applied in `authedProcedure`, so cost/margin
 * keys remain hidden from non-finance roles even when they appear inside audit
 * row JSON payloads. Phone numbers are already stored as hashes, so PII is not
 * leaked by exposing audit rows.
 *
 * If you need to re-gate this (e.g. hide audit from TPL riders), swap
 * `authedProcedure` back to `authedProcedure` on each row.
 */
export const auditRouter = router({
  /**
   * Get all history versions of a specific record in a table.
   */
  recordHistory: authedProcedure
    .input(
      z.object({
        tableName: z.string(),
        recordId: z.string().uuid(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input }) => {
      return getAuditService().getRecordHistory(
        input.tableName,
        input.recordId,
        input.page,
        input.limit,
      );
    }),

  /**
   * Global audit log — query across all or a specific history table.
   */
  globalLog: authedProcedure
    .input(
      z.object({
        tableName: z.string().optional(),
        actorId: z.string().uuid().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input }) => {
      return getAuditService().getGlobalAuditLog(input);
    }),

  /**
   * Time travel — view the state of a record at a specific point in time.
   */
  timeTravel: authedProcedure
    .input(
      z.object({
        tableName: z.string(),
        recordId: z.string().uuid(),
        asOf: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return getAuditService().timeTravel(
        input.tableName,
        input.recordId,
        input.asOf,
      );
    }),

  /**
   * Get list of auditable table names (for UI dropdown).
   */
  tables: authedProcedure
    .query(async () => {
      return getAuditService().getAuditableTables();
    }),

  /**
   * Resolve user IDs to names+roles for human-friendly audit display.
   */
  actorNames: authedProcedure
    .input(z.object({ userIds: z.array(z.string().uuid()) }))
    .query(async ({ input }) => {
      return getAuditService().getUserNameMap(input.userIds);
    }),
});
