import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
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
 * Audit router — SuperAdmin only.
 * Provides read access to the temporal audit trail (_history tables).
 */
export const auditRouter = router({
  /**
   * Get all history versions of a specific record in a table.
   */
  recordHistory: permissionProcedure('audit.read')
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
  globalLog: permissionProcedure('audit.read')
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
  timeTravel: permissionProcedure('audit.read')
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
  tables: permissionProcedure('audit.read')
    .query(async () => {
      return getAuditService().getAuditableTables();
    }),

  /**
   * Resolve user IDs to names+roles for human-friendly audit display.
   */
  actorNames: permissionProcedure('audit.read')
    .input(z.object({ userIds: z.array(z.string().uuid()) }))
    .query(async ({ input }) => {
      return getAuditService().getUserNameMap(input.userIds);
    }),
});
