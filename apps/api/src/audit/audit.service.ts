import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type postgres from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, asc, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { PG_CLIENT, DRIZZLE } from '../database/database.module';
import { shouldScopeGlobalAuditToBranch, type GlobalAuditAccessUser } from '../common/authz';
import { CacheService } from '../common/cache/cache.service';

/**
 * Whitelist of tables that have _history counterparts.
 * Only these table names are accepted in audit queries — prevents SQL injection.
 *
 * Tables intentionally OMITTED from audit queries even though their `*_history`
 * tables exist (skipped 2026-05 — see migration 0119):
 *   - inventory_levels    — every order CONFIRMED/AGENT_ASSIGNED/DELIVERED
 *                           updates `(stock_count, reserved_count)`. The
 *                           per-row delta has no business context; the
 *                           order's own audit row + the `stock_movements`
 *                           ledger already say WHY the count changed.
 *   - stock_batches       — `remaining_quantity` decrements on every FIFO
 *                           consumption. Same story: stock_movements is
 *                           the canonical movement ledger; the batch
 *                           history table just duplicates it without context.
 *   - stock_movements     — append-only ledger. Every row IS the audit
 *                           entry — a `*_history` twin is a 1:1 duplicate.
 *   - call_logs           — append-only call attempts. The row itself is
 *                           the audit; status transitions are visible on
 *                           the live row.
 *   - cart_abandonments   — most state transitions (PENDING → ABANDONED)
 *                           are cron-driven with a "System" actor. The
 *                           live row's status + timestamps tell the story.
 *
 * Migration 0119 drops the `capture_history` and `capture_history_insert`
 * triggers on those five tables so they stop generating new history rows
 * (per-write overhead win). Existing history rows stay in place — recover
 * from there if a forensic question ever needs them.
 */
const AUDITABLE_TABLES = [
  'users', 'products', 'product_categories',
  'logistics_providers', 'logistics_locations',
  'offer_templates', 'campaigns',
  'orders', 'order_items', 'stock_transfers',
  'marketing_funding', 'marketing_funding_requests', 'ad_spend_logs',
  'invoices', 'approval_requests', 'budgets', 'settlement_configs',
  'commission_plans', 'payout_records', 'earnings_adjustments',
  'stock_reconciliations',
  'email_change_requests', 'user_product_assignments',
  'permission_requests', 'system_settings',
  'permissions', 'user_permissions',
  'cs_order_routing_rules', 'cs_order_routing_rule_targets',
  'cs_order_routing_branch_settings',
  'branch_teams', 'branch_team_settings',
  // mirror_sessions is append-only (no _history twin) — globalLog SELECTs from it
  // directly using started_at/ended_at as the temporal markers.
  'mirror_sessions',
] as const;

type AuditableTable = (typeof AUDITABLE_TABLES)[number];

function isAuditableTable(name: string): name is AuditableTable {
  return (AUDITABLE_TABLES as readonly string[]).includes(name);
}

/**
 * One slice of a user's name+role lifetime — pulled from `users` (current) and `users_history`.
 * The audit UI uses `validFrom`/`validTo` to pick the slice covering an audit row's `validFrom`,
 * so an action by Kabir-back-when-they-were-Kabir keeps rendering as "Kabir" even after the
 * rename.
 */
export interface ActorVersion {
  /** ISO timestamp — when this version of the user became active. */
  validFrom: string;
  /** ISO timestamp — when this version was superseded. `null` for the current version. */
  validTo: string | null;
  name: string;
  role: string;
}

export interface ActorRecord {
  /** Current name from the live `users` table — what the actor is called now. */
  nameNow: string;
  /** Current role from the live `users` table. */
  roleNow: string;
  /**
   * All versions newest-first. Always contains at least the current version (mirroring
   * `nameNow`/`roleNow` with `validTo = null`); historical entries follow.
   */
  history: ActorVersion[];
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

/**
 * Base tables whose *_history rows include `branch_id` (native uuid after migration 0062).
 *
 * NOTE: `marketing_funding_requests` is intentionally NOT in this set — funding requests
 * aren't branch-scoped at the row level (branch context flows through requester/receiver
 * users, not the request itself). Migration 0041 added `branch_id` to every other branch-
 * scoped *_history table and deliberately skipped this one. Adding it here would break
 * the audit query with `column "branch_id" does not exist` whenever a branch filter is
 * active in the viewer's session.
 */
const HISTORY_TABLES_WITH_BRANCH_ID = new Set<string>([
  'orders',
  'campaigns',
  'marketing_funding',
  'ad_spend_logs',
  'inventory_levels',
  'commission_plans',
  'payout_records',
  'logistics_locations',
  'branch_teams',
]);

export interface FieldDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

@Injectable()
export class AuditService {
  private existingHistoryTables: Set<string> | null = null;

  constructor(
    @Inject(PG_CLIENT) private readonly sql: ReturnType<typeof postgres>,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cache: CacheService,
  ) {}

  /**
   * Discover which _history tables actually exist in the database.
   * Cached after first call for the lifetime of the service instance.
   */
  private async getExistingHistoryTables(): Promise<Set<string>> {
    if (this.existingHistoryTables) return this.existingHistoryTables;

    const rows = await this.sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE '%_history'
    `;
    const existing = new Set<string>();
    for (const row of rows) {
      const histName = (row as Record<string, unknown>).table_name as string;
      // Strip _history suffix to get the base table name
      const baseName = histName.replace(/_history$/, '');
      if ((AUDITABLE_TABLES as readonly string[]).includes(baseName)) {
        existing.add(baseName);
      }
    }
    this.existingHistoryTables = existing;
    return existing;
  }

  /**
   * Resolve a list of user IDs to their CURRENT name+role plus the full version history
   * pulled from `users_history`. The audit UI uses the history to render an actor as they
   * appeared at the moment of the action — e.g. "Kabir" on a 2026-03-01 row even after the
   * SuperAdmin renamed themselves to "Admin" on 2026-04-24. The current name is also returned
   * so the UI can render "Kabir → Admin" when the actor's identity has shifted.
   *
   * Only the audit trail uses time-aware resolution. Operational reads (e.g. the sidebar's
   * "logged in as" label) keep using the live `users` row directly.
   */
  async getUserNameMap(userIds: string[]): Promise<Record<string, ActorRecord>> {
    if (userIds.length === 0) return {};

    const uniqueIds = [...new Set(userIds)];

    const [currentRows, historyRows] = await Promise.all([
      this.db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          role: schema.users.role,
          validFrom: schema.users.validFrom,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, uniqueIds)),
      this.sql<Array<{ id: string; name: string; role: string; valid_from: Date; valid_to: Date | null }>>`
        SELECT id::text, name, role, valid_from, valid_to
        FROM users_history
        WHERE id = ANY(${uniqueIds}::uuid[])
        ORDER BY id, valid_from DESC
      `,
    ]);

    const map: Record<string, ActorRecord> = {};
    for (const u of currentRows) {
      map[u.id] = {
        nameNow: u.name,
        roleNow: u.role,
        history: [
          {
            validFrom: u.validFrom instanceof Date ? u.validFrom.toISOString() : String(u.validFrom),
            validTo: null,
            name: u.name,
            role: u.role,
          },
        ],
      };
    }
    for (const h of historyRows) {
      const entry = map[h.id];
      if (!entry) continue;
      entry.history.push({
        validFrom: h.valid_from instanceof Date ? h.valid_from.toISOString() : String(h.valid_from),
        validTo: h.valid_to instanceof Date ? h.valid_to.toISOString() : h.valid_to ? String(h.valid_to) : null,
        name: h.name,
        role: h.role,
      });
    }
    // Sort each user's history newest-first so resolveActor's linear scan finds the right
    // version on the first iteration for the common case (recent audit entries).
    for (const id of Object.keys(map)) {
      const entry = map[id];
      if (entry) {
        entry.history.sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
      }
    }
    return map;
  }

  /**
   * Resolve logistics location UUIDs to current display names for audit copy
   * (warehouse transfer descriptions). Scoped the same callers as actor resolution.
   */
  async getLocationNameMap(locationIds: string[]): Promise<Record<string, string>> {
    if (locationIds.length === 0) return {};
    const uniqueIds = [...new Set(locationIds)];
    const rows = await this.db
      .select({ id: schema.logisticsLocations.id, name: schema.logisticsLocations.name })
      .from(schema.logisticsLocations)
      .where(inArray(schema.logisticsLocations.id, uniqueIds));

    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.id] = r.name;
    }
    return map;
  }

  /**
   * Resolve permission UUIDs to canonical permission codes for audit copy.
   * Used by `/admin/analytics/audit` when rendering `user_permissions` rows.
   */
  async getPermissionCodeMap(permissionIds: string[]): Promise<Record<string, string>> {
    if (permissionIds.length === 0) return {};
    const uniqueIds = [...new Set(permissionIds)];
    const rows = await this.db
      .select({ id: schema.permissions.id, code: schema.permissions.code })
      .from(schema.permissions)
      .where(and(inArray(schema.permissions.id, uniqueIds), isNull(schema.permissions.validTo)));

    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.id] = row.code;
    }
    return map;
  }

  /**
   * Users eligible for “filter by actor” on `/admin/analytics/audit`.
   *
   * The UI used to derive this list only from user IDs referenced on the current page of audit
   * rows (typically ~20 with ~3 actors), which made the picker look broken. Instead we preload
   * staff in the same branch/org visibility as {@link getGlobalAuditLog} — no `users.read`
   * required for audit-only viewers.
   */
  async listActorFilterOptions(
    viewer: GlobalAuditAccessUser,
  ): Promise<Array<{ id: string; name: string; role: string }>> {
    const scopeToBranch = shouldScopeGlobalAuditToBranch(viewer);
    const branchId = viewer.currentBranchId ?? null;

    const branchClause =
      scopeToBranch && branchId
        ? sql<boolean>`EXISTS (
            SELECT 1 FROM user_branches ub
            WHERE ub.user_id = ${schema.users.id} AND ub.branch_id = ${branchId}
          )`
        : null;

    const whereClause = branchClause ? and(ne(schema.users.status, 'ARCHIVED'), branchClause) : ne(schema.users.status, 'ARCHIVED');

    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(whereClause)
      .orderBy(asc(schema.users.name))
      .limit(500);

    return rows;
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

    const existingTables = await this.getExistingHistoryTables();
    if (!existingTables.has(tableName)) {
      return { rows: [], total: 0 };
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
   * @param viewer Required for branch scoping — same user passed from `audit.globalLog` tRPC ctx.
   */
  async getGlobalAuditLog(
    filters: AuditLogFilters,
    viewer: GlobalAuditAccessUser,
  ): Promise<{ rows: AuditEntry[]; total: number }> {
    try {
      const { tableName, actorId, startDate, endDate, page = 1, limit = 20 } = filters;
      const offset = (page - 1) * limit;

      // Determine which tables to query — only those with existing _history tables.
      // mirror_sessions is special-cased below (append-only, no `_history` twin).
      const existingTables = await this.getExistingHistoryTables();

      let tables: AuditableTable[] = tableName
        ? isAuditableTable(tableName)
          ? tableName === 'mirror_sessions' || existingTables.has(tableName)
            ? [tableName]
            : []
          : (() => {
              throw new TRPCError({ code: 'BAD_REQUEST', message: `Table '${tableName}' is not auditable` });
            })()
        : AUDITABLE_TABLES.filter((t) => t === 'mirror_sessions' || existingTables.has(t));

      const scopeToBranch = shouldScopeGlobalAuditToBranch(viewer);
      const branchId = viewer.currentBranchId ?? null;

      if (scopeToBranch && branchId) {
        // Branch viewers: no org-wide catalog/settings history; no mirror_sessions (org-wide).
        tables = tables.filter((t) => {
          if (t === 'mirror_sessions') return false;
          if (t === 'users') return true;
          return HISTORY_TABLES_WITH_BRANCH_ID.has(t);
        });
      }

      if (tables.length === 0) {
        return { rows: [], total: 0 };
      }

      // Shared placeholders across every UNION arm (PostgreSQL uses one param array for the whole query).
      const params: (string | number)[] = [];
      let next = 1;
      let actorIdx = 0;
      let startIdx = 0;
      let endIdx = 0;
      let branchIdx = 0;
      if (actorId) {
        actorIdx = next;
        next += 1;
        params.push(actorId);
      }
      if (startDate) {
        startIdx = next;
        next += 1;
        params.push(startDate);
      }
      if (endDate) {
        endIdx = next;
        next += 1;
        params.push(endDate);
      }
      if (scopeToBranch && branchId) {
        branchIdx = next;
        next += 1;
        params.push(branchId);
      }

      // Per-arm cap: each table only needs to surface its top (limit + offset)
      // newest rows — anything older than that on a single table cannot affect
      // the global page being requested. This is what turns each arm from a
      // "scan whole history table + sort" into an O(log N) index seek that
      // walks the new `*_history_valid_from_desc_idx` index (migration 0118).
      const perArmCap = limit + offset;
      const dataLimitIdx = next;
      next += 1;
      const dataParams = [...params, perArmCap];

      const dataUnionParts: string[] = [];
      const countUnionParts: string[] = [];

      for (const table of tables) {
        const conditions: string[] = [];

        const isMirror = table === 'mirror_sessions';
        const fromCol = isMirror ? 'started_at' : 'valid_from';

        if (actorIdx) {
          if (isMirror) {
            conditions.push(`actor_id = $${actorIdx}::uuid`);
          } else {
            // Cast both sides to text so the predicate works whether modified_by
            // is uuid (most tables) or text (legacy/inconsistent ones).
            conditions.push(`modified_by::text = $${actorIdx}::text`);
          }
        }
        if (startIdx) {
          conditions.push(`${fromCol} >= $${startIdx}::timestamptz`);
        }
        if (endIdx) {
          conditions.push(`${fromCol} <= $${endIdx}::timestamptz`);
        }
        if (branchIdx) {
          if (table === 'users') {
            conditions.push(`primary_branch_id = $${branchIdx}::uuid`);
          } else if (HISTORY_TABLES_WITH_BRANCH_ID.has(table)) {
            conditions.push(`branch_id = $${branchIdx}::uuid`);
          }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Two SELECTs per arm — the data path includes ORDER BY + LIMIT so the
        // planner can use the (valid_from DESC) index, while the count path
        // stays predicate-only (a top-N cap on each arm would under-count the
        // total).
        if (isMirror) {
          dataUnionParts.push(
            `(SELECT 'mirror_sessions' AS _table_name, id, actor_id::text AS modified_by,
                     COALESCE(ended_at, started_at) AS valid_from, ended_at AS valid_to,
                     row_to_json(mirror_sessions.*) AS _row_data
              FROM mirror_sessions
              ${whereClause}
              ORDER BY ${fromCol} DESC
              LIMIT $${dataLimitIdx})`,
          );
          countUnionParts.push(
            `SELECT 1 FROM mirror_sessions ${whereClause}`,
          );
        } else {
          // Always cast `modified_by` to text in the SELECT so the UNION succeeds
          // even if a history table declares it as text instead of uuid (drift).
          dataUnionParts.push(
            `(SELECT '${table}' AS _table_name, id, modified_by::text AS modified_by,
                     valid_from, valid_to,
                     row_to_json(${table}_history.*) AS _row_data
              FROM ${table}_history
              ${whereClause}
              ORDER BY valid_from DESC
              LIMIT $${dataLimitIdx})`,
          );
          countUnionParts.push(
            `SELECT 1 FROM ${table}_history ${whereClause}`,
          );
        }
      }

      // ── Total: Redis-cached for 30s ──────────────────────────────────────
      // Counting a UNION across 30+ history tables is the single most expensive
      // step of this query (it must scan every table, where the data fetch
      // only walks the top N rows of each). Audit volume changes constantly
      // but the user's perception of "Page X of Y" is fine with 30s staleness.
      // Cache key encodes every filter + viewer scope so different views don't
      // collide.
      const countCacheKey =
        `cache:audit:count:` +
        CacheService.hashInput({
          tables,
          actorId: actorId ?? null,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          branchId: scopeToBranch ? branchId : null,
        });
      const total = await this.cache.getOrSet<number>(countCacheKey, 30, async () => {
        const countQuery = `SELECT COUNT(*)::int AS total FROM (${countUnionParts.join('\n UNION ALL \n')}) AS _audit_count`;
        const countResult = await this.sql.unsafe(countQuery, params);
        return ((countResult[0] as Record<string, unknown> | undefined)?.total ?? 0) as number;
      });

      // ── Page: per-arm ORDER BY + LIMIT, then re-sort the small result ────
      // After per-arm caps, the outer query sees at most `tables × perArmCap`
      // rows (e.g. 30 tables × 40 = 1200 rows), trivial to sort in memory.
      const outerLimitIdx = next;
      const outerOffsetIdx = next + 1;
      const finalParams = [...dataParams, limit, offset];
      const dataQuery =
        `SELECT * FROM (${dataUnionParts.join('\n UNION ALL \n')}) AS _audit_union
         ORDER BY valid_from DESC
         LIMIT $${outerLimitIdx} OFFSET $${outerOffsetIdx}`;

      const rows = await this.sql.unsafe(dataQuery, finalParams);

      return {
        rows: rows.map((row) => {
          const rawRow = row as Record<string, unknown>;
          const data = (rawRow._row_data ?? {}) as Record<string, unknown>;
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

    const existingTables = await this.getExistingHistoryTables();
    if (!existingTables.has(tableName)) {
      return null;
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

    const existingTables = await this.getExistingHistoryTables();
    if (!existingTables.has(tableName)) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `History table for '${tableName}' does not exist`,
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
  async getAuditableTables(viewer?: GlobalAuditAccessUser): Promise<string[]> {
    const existing = await this.getExistingHistoryTables();
    let list = AUDITABLE_TABLES.filter((t) => existing.has(t));
    if (viewer && shouldScopeGlobalAuditToBranch(viewer) && viewer.currentBranchId) {
      list = list.filter((t) => {
        if (t === 'users') return true;
        return HISTORY_TABLES_WITH_BRANCH_ID.has(t);
      });
    }
    return list;
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

  /**
   * Mirror Mode session log — one entry per Mirror Mode session, paginated.
   * Resolved with actor + target user names so the UI can render "Kabir mirrored Yusuf"
   * without a join at render time. Sessions stay in the table forever (Pillar 4); `endedAt`
   * stays NULL while the session is active. Sorted newest-first.
   */
  async getMirrorSessions(
    filters: { page?: number; limit?: number; actorId?: string; targetId?: string },
    viewer?: GlobalAuditAccessUser,
  ): Promise<{
    rows: Array<{
      id: string;
      actorId: string;
      actorName: string | null;
      actorRole: string | null;
      targetId: string;
      targetName: string | null;
      targetRole: string | null;
      startedAt: string;
      endedAt: string | null;
      ipAddress: string | null;
      userAgent: string | null;
    }>;
    total: number;
  }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.actorId) {
      params.push(filters.actorId);
      conditions.push(`ms.actor_id = $${params.length}::uuid`);
    }
    if (filters.targetId) {
      params.push(filters.targetId);
      conditions.push(`ms.target_id = $${params.length}::uuid`);
    }
    if (viewer && shouldScopeGlobalAuditToBranch(viewer) && viewer.currentBranchId) {
      params.push(viewer.currentBranchId);
      const b = params.length;
      conditions.push(
        `(EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = ms.actor_id AND ub.branch_id = $${b}::uuid)` +
          ` OR EXISTS (SELECT 1 FROM users u WHERE u.id = ms.actor_id AND u.primary_branch_id = $${b}::uuid))`,
      );
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const dataQuery = `
      SELECT
        ms.id::text         AS id,
        ms.actor_id::text   AS "actorId",
        a.name              AS "actorName",
        a.role              AS "actorRole",
        ms.target_id::text  AS "targetId",
        t.name              AS "targetName",
        t.role              AS "targetRole",
        ms.started_at       AS "startedAt",
        ms.ended_at         AS "endedAt",
        ms.ip_address       AS "ipAddress",
        ms.user_agent       AS "userAgent"
      FROM mirror_sessions ms
      LEFT JOIN users a ON a.id = ms.actor_id
      LEFT JOIN users t ON t.id = ms.target_id
      ${whereSql}
      ORDER BY ms.started_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const countQuery = `SELECT COUNT(*)::int AS c FROM mirror_sessions ms ${whereSql}`;

    const [rows, countRows] = await Promise.all([
      this.sql.unsafe(dataQuery, params as never[]),
      this.sql.unsafe(countQuery, params as never[]),
    ]);

    return {
      rows: (rows as unknown as Array<{
        id: string;
        actorId: string;
        actorName: string | null;
        actorRole: string | null;
        targetId: string;
        targetName: string | null;
        targetRole: string | null;
        startedAt: Date | string;
        endedAt: Date | string | null;
        ipAddress: string | null;
        userAgent: string | null;
      }>).map((r) => ({
        ...r,
        startedAt: typeof r.startedAt === 'string' ? r.startedAt : r.startedAt.toISOString(),
        endedAt: r.endedAt
          ? typeof r.endedAt === 'string'
            ? r.endedAt
            : r.endedAt.toISOString()
          : null,
      })),
      total: Number((countRows[0] as { c: number } | undefined)?.c ?? 0),
    };
  }
}
