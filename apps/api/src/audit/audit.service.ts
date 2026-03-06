import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type postgres from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { PG_CLIENT, DRIZZLE } from '../database/database.module';

/**
 * Whitelist of tables that have _history counterparts.
 * Only these table names are accepted in audit queries — prevents SQL injection.
 */
const AUDITABLE_TABLES = [
  'users', 'products', 'product_categories', 'stock_batches',
  'logistics_providers', 'logistics_locations', 'inventory_levels',
  'offer_templates', 'campaigns',
  'orders', 'order_items', 'stock_transfers', 'stock_movements',
  'marketing_funding', 'marketing_funding_requests', 'ad_spend_logs',
  'call_logs', 'order_transfer_requests',
  'invoices', 'approval_requests', 'budgets', 'settlement_configs',
  'commission_plans', 'payout_records', 'earnings_adjustments',
  'stock_reconciliations',
  'email_change_requests', 'user_product_assignments',
  'permission_requests', 'system_settings', 'cart_abandonments',
  'permissions', 'user_permissions',
] as const;

type AuditableTable = (typeof AUDITABLE_TABLES)[number];

function isAuditableTable(name: string): name is AuditableTable {
  return (AUDITABLE_TABLES as readonly string[]).includes(name);
}

export interface AuditEntry {
  id: string;
  tableName: string;
  recordId: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changedBy: string | null;
  validFrom: string;
  validTo: string | null;
  data: Record<string, unknown>;
}

export interface AuditLogFilters {
  tableName?: string;
  actorId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(PG_CLIENT) private readonly sql: ReturnType<typeof postgres>,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Resolve a list of user IDs to a map of id → { name, role }.
   * Used by the audit UI to display human-readable actor names.
   */
  async getUserNameMap(userIds: string[]): Promise<Record<string, { name: string; role: string }>> {
    if (userIds.length === 0) return {};

    const uniqueIds = [...new Set(userIds)];
    const users = await this.db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
      .from(schema.users)
      .where(inArray(schema.users.id, uniqueIds));

    const map: Record<string, { name: string; role: string }> = {};
    for (const u of users) {
      map[u.id] = { name: u.name, role: u.role };
    }
    return map;
  }

  /**
   * Get all history versions of a specific record.
   */
  async getRecordHistory(
    tableName: string,
    recordId: string,
    page = 1,
    limit = 20,
  ): Promise<{ rows: AuditEntry[]; total: number }> {
    if (!isAuditableTable(tableName)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Table '${tableName}' is not auditable`,
      });
    }

    const historyTable = `${tableName}_history`;
    const offset = (page - 1) * limit;

    // Count total rows
    const countResult = await this.sql.unsafe(
      `SELECT COUNT(*)::int AS total FROM ${historyTable} WHERE id = $1`,
      [recordId] as (string | number)[],
    );
    const total = (countResult[0] as Record<string, unknown> | undefined)?.total ?? 0;

    // Fetch paginated history rows
    const rows = await this.sql.unsafe(
      `SELECT *
       FROM ${historyTable}
       WHERE id = $1
       ORDER BY valid_from DESC
       LIMIT $2 OFFSET $3`,
      [recordId, limit, offset] as (string | number)[],
    );

    return {
      rows: rows.map((row) => this.mapHistoryRow(tableName, row as Record<string, unknown>)),
      total: total as number,
    };
  }

  /**
   * Query audit log across all (or a specific) history tables.
   */
  async getGlobalAuditLog(filters: AuditLogFilters): Promise<{ rows: AuditEntry[]; total: number }> {
    try {
      const { tableName, actorId, startDate, endDate, page = 1, limit = 20 } = filters;
      const offset = (page - 1) * limit;

      // Determine which tables to query
      const tables: AuditableTable[] = tableName
        ? isAuditableTable(tableName)
          ? [tableName]
          : (() => { throw new TRPCError({ code: 'BAD_REQUEST', message: `Table '${tableName}' is not auditable` }); })()
        : [...AUDITABLE_TABLES];

      // Build UNION ALL query across selected history tables
      const unionParts: string[] = [];
      const params: (string | number)[] = [];
      let paramIdx = 1;

      for (const table of tables) {
        const conditions: string[] = [];

        if (actorId) {
          conditions.push(`modified_by = $${paramIdx}`);
          params.push(actorId);
          paramIdx++;
        }
        if (startDate) {
          conditions.push(`valid_from >= $${paramIdx}::timestamptz`);
          params.push(startDate);
          paramIdx++;
        }
        if (endDate) {
          conditions.push(`valid_from <= $${paramIdx}::timestamptz`);
          params.push(endDate);
          paramIdx++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        unionParts.push(
          `SELECT '${table}' AS _table_name, id, modified_by,
                  valid_from, valid_to,
                  row_to_json(${table}_history.*) AS _row_data
           FROM ${table}_history
           ${whereClause}`,
        );
      }

      const unionQuery = unionParts.join('\n UNION ALL \n');

      // Count total
      const countQuery = `SELECT COUNT(*)::int AS total FROM (${unionQuery}) AS _audit_union`;
      const countResult = await this.sql.unsafe(countQuery, params);
      const total = ((countResult[0] as Record<string, unknown> | undefined)?.total ?? 0) as number;

      // Fetch paginated
      const dataQuery = `SELECT * FROM (${unionQuery}) AS _audit_union
                         ORDER BY valid_from DESC
                         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(limit, offset);

      const rows = await this.sql.unsafe(dataQuery, params);

      return {
        rows: rows.map((row) => {
          const rawRow = row as Record<string, unknown>;
          const data = (rawRow._row_data ?? {}) as Record<string, unknown>;
          // Remove temporal/internal fields from data display
          delete data.valid_from;
          delete data.valid_to;
          delete data.modified_by;

          return {
            id: String(rawRow.id ?? ''),
            tableName: String(rawRow._table_name ?? ''),
            recordId: String(rawRow.id ?? ''),
            action: this.inferAction(rawRow.valid_to),
            changedBy: rawRow.modified_by ? String(rawRow.modified_by) : null,
            validFrom: rawRow.valid_from ? new Date(rawRow.valid_from as string).toISOString() : '',
            validTo: rawRow.valid_to ? new Date(rawRow.valid_to as string).toISOString() : null,
            data,
          };
        }),
        total,
      };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Audit log query failed: ${message}. Ensure all _history tables exist and have valid_from, valid_to, modified_by columns.`,
      });
    }
  }

  /**
   * Time travel: get the state of a record at a specific point in time.
   */
  async timeTravel(
    tableName: string,
    recordId: string,
    asOf: string,
  ): Promise<Record<string, unknown> | null> {
    if (!isAuditableTable(tableName)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Table '${tableName}' is not auditable`,
      });
    }

    const historyTable = `${tableName}_history`;

    // Find the version that was active at the given timestamp
    const rows = await this.sql.unsafe(
      `SELECT row_to_json(${historyTable}.*) AS _row_data
       FROM ${historyTable}
       WHERE id = $1
         AND valid_from <= $2::timestamptz
         AND (valid_to > $2::timestamptz OR valid_to IS NULL)
       LIMIT 1`,
      [recordId, asOf] as (string | number)[],
    );

    if (rows.length === 0) {
      // Also check the current table (record may still be active)
      const currentRows = await this.sql.unsafe(
        `SELECT row_to_json(${tableName}.*) AS _row_data
         FROM ${tableName}
         WHERE id = $1
           AND valid_from <= $2::timestamptz`,
        [recordId, asOf] as (string | number)[],
      );
      if (currentRows.length === 0) return null;

      const firstRow = currentRows[0] as Record<string, unknown>;
      const data = (firstRow._row_data ?? {}) as Record<string, unknown>;
      delete data.modified_by;
      return data;
    }

    const firstRow = rows[0] as Record<string, unknown>;
    const data = (firstRow._row_data ?? {}) as Record<string, unknown>;
    delete data.modified_by;
    return data;
  }

  /**
   * Compute field-by-field diff between two consecutive history versions.
   */
  async diffVersions(
    tableName: string,
    recordId: string,
    versionATimestamp: string,
    versionBTimestamp: string,
  ): Promise<FieldDiff[]> {
    if (!isAuditableTable(tableName)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Table '${tableName}' is not auditable`,
      });
    }

    const historyTable = `${tableName}_history`;

    // Fetch both versions
    const rows = await this.sql.unsafe(
      `SELECT row_to_json(${historyTable}.*) AS _row_data, valid_from
       FROM ${historyTable}
       WHERE id = $1
         AND (valid_from = $2::timestamptz OR valid_from = $3::timestamptz)
       ORDER BY valid_from ASC`,
      [recordId, versionATimestamp, versionBTimestamp] as (string | number)[],
    );

    if (rows.length < 2) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Could not find both versions for comparison',
      });
    }

    const row0 = rows[0] as Record<string, unknown>;
    const row1 = rows[1] as Record<string, unknown>;
    const oldData = (row0._row_data ?? {}) as Record<string, unknown>;
    const newData = (row1._row_data ?? {}) as Record<string, unknown>;

    // Internal fields to skip
    const skip = new Set(['valid_from', 'valid_to', 'modified_by']);

    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    const diffs: FieldDiff[] = [];

    for (const key of allKeys) {
      if (skip.has(key)) continue;
      const oldVal = oldData[key];
      const newVal = newData[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        diffs.push({ field: key, oldValue: oldVal, newValue: newVal });
      }
    }

    return diffs;
  }

  /**
   * Get the list of auditable table names (for the UI dropdown).
   */
  getAuditableTables(): string[] {
    return [...AUDITABLE_TABLES];
  }

  // ── Private helpers ──────────────────────────────────────────

  private mapHistoryRow(tableName: string, row: Record<string, unknown>): AuditEntry {
    const validFrom = row.valid_from as string | null;
    const validTo = row.valid_to as string | null;

    // Build data object excluding temporal meta-fields
    const data = { ...row };
    delete data.valid_from;
    delete data.valid_to;
    delete data.modified_by;

    return {
      id: String(row.id ?? ''),
      tableName,
      recordId: String(row.id ?? ''),
      action: this.inferAction(validTo),
      changedBy: row.modified_by ? String(row.modified_by) : null,
      validFrom: validFrom ? new Date(validFrom).toISOString() : '',
      validTo: validTo ? new Date(validTo).toISOString() : null,
      data,
    };
  }

  private inferAction(
    validTo: unknown,
  ): 'INSERT' | 'UPDATE' | 'DELETE' {
    // valid_to IS NULL = initial INSERT we captured via trg_*_capture_history_insert
    // valid_to IS NOT NULL = superseded version (UPDATE or DELETE)
    if (!validTo || validTo === 'infinity') {
      return 'INSERT';
    }
    return 'UPDATE';
  }
}
