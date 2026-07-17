import { Injectable, Inject } from '@nestjs/common';
import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';

type Drizzle = PostgresJsDatabase<typeof schema>;

export interface RecordImportInput {
  resourceType: string;
  fileName?: string | null;
  totalRows: number;
  successCount: number;
  failedCount: number;
  createdBy: string;
  branchId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListImportsInput {
  page: number;
  limit: number;
  resourceType?: string;
  createdBy?: string;
}

/**
 * ImportHistoryService — records and lists bulk import operations.
 *
 * Every CSV/Excel import (orders, users, products, transfers, logistics
 * locations/providers) calls `recordImport` so admins can see what was
 * imported, by whom, and how many rows succeeded or failed.
 */
@Injectable()
export class ImportHistoryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Drizzle,
  ) {}

  /**
   * Insert a single import-batch record after an import completes.
   */
  async recordImport(input: RecordImportInput) {
    const [row] = await this.db
      .insert(schema.importBatches)
      .values({
        resourceType: input.resourceType,
        fileName: input.fileName ?? null,
        totalRows: input.totalRows,
        successCount: input.successCount,
        failedCount: input.failedCount,
        createdBy: input.createdBy,
        branchId: input.branchId ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Paginated list of import batches, with creator name joined from users.
   */
  async listImports(input: ListImportsInput) {
    const { page, limit, resourceType, createdBy } = input;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    if (resourceType) {
      conditions.push(eq(schema.importBatches.resourceType, resourceType));
    }
    if (createdBy) {
      conditions.push(eq(schema.importBatches.createdBy, createdBy));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      this.db
        .select({
          id: schema.importBatches.id,
          resourceType: schema.importBatches.resourceType,
          fileName: schema.importBatches.fileName,
          totalRows: schema.importBatches.totalRows,
          successCount: schema.importBatches.successCount,
          failedCount: schema.importBatches.failedCount,
          createdBy: schema.importBatches.createdBy,
          creatorName: schema.users.name,
          branchId: schema.importBatches.branchId,
          metadata: schema.importBatches.metadata,
          createdAt: schema.importBatches.createdAt,
        })
        .from(schema.importBatches)
        .leftJoin(schema.users, eq(schema.importBatches.createdBy, schema.users.id))
        .where(where)
        .orderBy(desc(schema.importBatches.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.importBatches)
        .where(where),
    ]);

    return {
      rows,
      total: countResult[0]?.count ?? 0,
    };
  }
}
