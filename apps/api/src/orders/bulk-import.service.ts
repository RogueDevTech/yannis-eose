import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { db as schema, SYSTEM_ACTOR_ID } from '@yannis/shared';
import type { ImportOrderInput } from '@yannis/shared';

// ImportJobStatus / ImportRowFailure live in the schema module, surfaced only
// under the `db` namespace at the package root — reference them through it.
type ImportJobStatus = schema.ImportJobStatus;
type ImportRowFailure = schema.ImportRowFailure;
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { getObjectStreamFromStorage } from '../common/storage/object-storage';
import { OrdersService } from './orders.service';
import { streamImportRows } from './bulk-import.parser';

/**
 * Rows upserted per worker tick. A bounded chunk keeps each tick short so the
 * @Cron scheduler stays responsive and a crash loses at most this many rows of
 * progress (which resume re-does harmlessly — upserts are idempotent). The DB is
 * remote (see MEMORY dev_db_latency), so this is the throughput knob.
 */
const CHUNK_SIZE = 500;

/** Cap on stored per-row failures so error_log can't grow unbounded on a bad file. */
const MAX_ERROR_LOG = 1000;

/**
 * Caps on the source cells we retain for a FAILED row (import_job_rows.raw_data),
 * so a pathological file (hundreds of columns, or a cell holding an essay) can't
 * bloat the table. Only failed rows store this at all — a clean import writes none.
 */
const MAX_RAW_DATA_CELLS = 60;

/**
 * Cap on how many snapshot-less rows one page load will recover from the source
 * file, so a page of legacy failures can't turn into an unbounded read.
 */
const MAX_RECOVERED_ROWS = 200;
const MAX_RAW_DATA_VALUE_LEN = 500;

/**
 * Mid-chunk progress heartbeat: flush accumulated row records + the running
 * processed/failed counts every N rows WITHIN a chunk, so the live UI (which
 * polls every ~2.5s) sees the progress bar advance and rows appear as they
 * import — not just once the whole chunk finishes. Matters most on a slow/
 * remote DB where a 500-row chunk can take many seconds (see dev_db_latency).
 * Kept modest so the extra writes don't dominate throughput.
 */
const MID_CHUNK_FLUSH_EVERY = 10;

/**
 * Options + column mapping chosen in the UI and persisted on the job's `config`.
 * The worker reads this to turn a raw spreadsheet row into an order.
 */
export interface ImportJobConfig {
  /**
   * Optional explicit branch for the whole job. Normally omitted: each order's
   * branch is DERIVED from its media buyer (then CS closer) primary branch, and
   * falls back to the company's first branch. Kept for backward-compat / a
   * caller that wants to pin every row to one branch.
   */
  branchId?: string;
  /**
   * The company (branch-group) this job belongs to, captured from the creator's
   * active company at createJob time. Scopes code resolution + branch derivation.
   * Set server-side, never trusted from the client.
   */
  groupId?: string | null;
  mediaBuyerId?: string | null;
  assignedCsId?: string | null;
  targetStatus: ImportOrderInput['targetStatus'];
  /** Header name (or 0-based column index as string) holding the unique external id. */
  externalIdColumn: string;
  /** Map of order field → source header name. */
  columnMap: {
    customerName: string;
    customerPhone: string;
    customerAddress?: string;
    deliveryState?: string;
    totalAmount?: string;
    createdAt?: string;
    productId?: string; // header holding a product UUID
    quantity?: string;
    unitPrice?: string;
    offerLabel?: string;
    // Header holding a per-row status label (Confirmed / Delivered / Pending…).
    // Parsed via parseRowStatus; blank/unknown falls back to config.targetStatus.
    status?: string;
    // Display-code columns resolved to UUIDs at import time (see mapRow).
    productCode?: string; // header holding a product code (PDT-N)
    mediaBuyerCode?: string; // header holding a user code (USR-N) for the MB
    closerCode?: string; // header holding a user code (USR-N) for the CS closer
    // NOTE: no branch column — branch is always derived from the MB / CS user.
    currency?: string; // header holding a currency code or country name (NGN / Ghana)
  };
  /** Fallback single product applied to every row when the file has no product column. */
  defaultProductId?: string;
  defaultQuantity?: number;
  defaultUnitPrice?: number;
  /**
   * Multi-country scope, captured from the creator's request at createJob time
   * (never trusted from the client). The country analogue of `groupId`:
   *  - `allowedCurrencyCodes` — the caller's hard data scope (ctx.effectiveCurrencyCodes).
   *    `null`/absent = all countries. A row whose resolved currency is NOT in this
   *    set HARD-FAILS, so an import can never write orders outside the caller's
   *    country permission.
   *  - `selectedCurrencyCode` — the single country picked in the top-bar switcher
   *    (ctx.currentCurrencyCode). Used as the default currency for rows that don't
   *    specify one, so a Nigeria-scoped import stamps NGN rather than base.
   */
  allowedCurrencyCodes?: string[] | null;
  selectedCurrencyCode?: string | null;
}

/**
 * Pre-loaded lookup tables mapping human display codes → internal UUIDs, built
 * ONCE per drainChunk (never per row — mapRow is synchronous and the file can be
 * 100k+ rows). Every map is scoped to the job's company, so a code only ever
 * resolves to an entity the importer's company owns.
 */
interface CodeMaps {
  /** user_number (USR-N) → user id */
  users: Map<string, string>;
  /** user id → that user's primary branch id (for branch derivation). */
  userPrimaryBranch: Map<string, string>;
  /** product_number (PDT-N) → product id */
  products: Map<string, string>;
  /**
   * The company's fallback branch (first branch in the group by creation),
   * used when a row's branch can't be derived from its MB or CS user. Null only
   * if the company has no branches at all (then such rows hard-fail).
   */
  fallbackBranchId: string | null;
  /**
   * Active currency lookup for THIS company. Keys are BOTH the code ("NGN") and
   * the country name ("NIGERIA"), both upper-cased, → the canonical code. Used
   * to validate/resolve an explicit currency column on the sheet.
   */
  currencyByKey: Map<string, string>;
  /** user id → their assigned currency codes (user_countries), for the fallback. */
  userCurrencies: Map<string, string[]>;
  /** The company's base currency code (final fallback). */
  baseCurrencyCode: string;
}

/** One reference field left NULL because its code didn't resolve (row still imported). */
interface UnresolvedRef {
  field: 'mediaBuyer' | 'closer';
  code: string;
}

/**
 * Normalize a display code for lookup: strip any alpha prefix + separators and
 * leading zeros, so "USR-7", "USR7", "MB7", "007", and "7" all key on "7".
 * Branch codes (alphabetic, e.g. "LGS") are handled separately (upper-cased).
 */
function normalizeNumericCode(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '').replace(/^0+/, '');
  return digits.length > 0 ? digits : null;
}

/**
 * The EXACT status labels the import accepts, and the order status each becomes.
 *
 * STRICT BY DIRECTIVE (CEO, 2026-09-01): "the status must match what we have on
 * our app". A sheet label must equal one of these keys exactly (ignoring case
 * and surrounding whitespace) — there is NO substring or fuzzy matching. A label
 * that is not on this list, or a blank cell, HARD-FAILS the row so nothing is
 * ever guessed.
 *
 * Why exact: the previous substring matcher read "Not Delivered" and "Delivery
 * Failed" as DELIVERED — the opposite meaning — silently inflating delivered
 * counts, which feed FIFO COGS and remittance. Loose matching on a status is a
 * financial-truth hazard, not a convenience.
 *
 * Note "Cancelled" maps to DELETED: per CLAUDE.md, CANCELLED is legacy-only and
 * must not be minted by new writes. DELETED is excluded from ALL metrics.
 */
const IMPORT_STATUS_LABELS: Record<string, ImportOrderInput['targetStatus']> = {
  // Unprocessed / new
  unprocessed: 'UNPROCESSED',
  new: 'UNPROCESSED',
  // Assigned to a CS agent, not yet worked
  pending: 'CS_ASSIGNED',
  assigned: 'CS_ASSIGNED',
  'cs assigned': 'CS_ASSIGNED',
  // Engaged: contacted but not yet confirmed
  'no response': 'CS_ENGAGED',
  no_response: 'CS_ENGAGED',
  'no answer': 'CS_ENGAGED',
  rescheduled: 'CS_ENGAGED',
  'cs engaged': 'CS_ENGAGED',
  engaged: 'CS_ENGAGED',
  unconfirmed: 'CS_ENGAGED',
  // Confirmed by the customer
  confirmed: 'CONFIRMED',
  // Delivered to the customer
  delivered: 'DELIVERED',
  // Delivered AND cash remitted to finance
  remitted: 'REMITTED',
  'delivered and cash remitted': 'REMITTED',
  'delivered & cash remitted': 'REMITTED',
  'cash remitted': 'REMITTED',
  // Returned by the customer
  returned: 'RETURNED',
  // Soft-removed. CANCELLED is legacy-only (CLAUDE.md), so a cancelled source
  // row imports as DELETED and is excluded from every metric.
  cancelled: 'DELETED',
  canceled: 'DELETED',
  deleted: 'DELETED',
};

/** The accepted labels, de-duplicated by target status, for error messages + the UI. */
export const IMPORT_STATUS_OPTIONS: Array<{
  label: string;
  status: ImportOrderInput['targetStatus'];
}> = [
  { label: 'Unprocessed', status: 'UNPROCESSED' },
  { label: 'Pending', status: 'CS_ASSIGNED' },
  { label: 'No Response', status: 'CS_ENGAGED' },
  { label: 'Rescheduled', status: 'CS_ENGAGED' },
  { label: 'Confirmed', status: 'CONFIRMED' },
  { label: 'Delivered', status: 'DELIVERED' },
  { label: 'Delivered and Cash Remitted', status: 'REMITTED' },
  { label: 'Returned', status: 'RETURNED' },
  { label: 'Cancelled', status: 'DELETED' },
];

/**
 * Resolve a source CRM status label to an order status, EXACTLY.
 *
 * Returns null for a blank cell or any label not in IMPORT_STATUS_LABELS — the
 * caller hard-fails the row in both cases. Normalisation is deliberately limited
 * to case, surrounding whitespace, collapsed inner whitespace, and separator
 * punctuation (so "No_Response", "no-response" and "No Response" agree). It does
 * NOT strip words, so "Not Delivered" can never resolve to "Delivered".
 */
function parseRowStatus(raw: string): ImportOrderInput['targetStatus'] | null {
  const key = raw
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!key) return null;
  return IMPORT_STATUS_LABELS[key] ?? null;
}

/**
 * Flatten one raw spreadsheet record into the small string map we retain for a
 * FAILED row (import_job_rows.raw_data), so the job page can render it in an
 * editable form. Bounded on both axes (MAX_RAW_DATA_CELLS columns,
 * MAX_RAW_DATA_VALUE_LEN chars per cell) so a pathological file can't bloat the
 * table. Blank cells are kept — an EMPTY required field is exactly the thing the
 * user needs to see in order to fix it.
 */
function snapshotRawRow(record: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, value] of Object.entries(record)) {
    if (n >= MAX_RAW_DATA_CELLS) break;
    let str: string;
    if (value == null) str = '';
    else if (typeof value === 'string') str = value;
    else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      str = String(value);
    } else {
      try {
        str = JSON.stringify(value) ?? '';
      } catch {
        str = '';
      }
    }
    out[key] = str.length > MAX_RAW_DATA_VALUE_LEN ? str.slice(0, MAX_RAW_DATA_VALUE_LEN) : str;
    n += 1;
  }
  return out;
}

/**
 * Failure-reason buckets for the job page's filter. `match` is an ILIKE pattern
 * against the stored reason text, so triaging a large import means picking a
 * CAUSE ("show me every row that failed on Cost") instead of scrolling.
 * Kept in one place so the filter and its dropdown can never drift apart.
 */
export const REASON_KINDS: Array<{ value: string; label: string; match: string }> = [
  { value: 'status', label: 'Status problem', match: '%status%' },
  { value: 'product', label: 'Product code', match: '%product%' },
  { value: 'media_buyer', label: 'Media buyer code', match: '%media buyer%' },
  { value: 'cs', label: 'CS code', match: '%CS code%' },
  { value: 'currency', label: 'Currency / country', match: '%currenc%' },
  { value: 'amount', label: 'Cost / amount', match: '%totalamount%' },
  { value: 'quantity', label: 'Quantity', match: '%quantity%' },
  { value: 'name', label: 'Customer name', match: '%name%' },
  { value: 'phone', label: 'Phone', match: '%phone%' },
  { value: 'email', label: 'Email', match: '%email%' },
  { value: 'external_id', label: 'Missing Order ID', match: '%external id%' },
  { value: 'branch', label: 'Branch', match: '%branch%' },
];

/**
 * Content fingerprint for an imported order: sha256(phone | product | date).
 *
 * This is the FALLBACK identity used when the source file's Order ID is absent
 * or was regenerated between exports, so a re-import repairs the existing order
 * rather than duplicating it.
 *
 * Why all three parts, and not just the phone: repeat customers are normal. In a
 * 1,000-row sample, 34 orders shared 12 phone numbers, and one line carried
 * THREE genuinely different orders. A phone identifies a CUSTOMER; only the
 * combination of who, what and when identifies an ORDER.
 *
 * Normalisation is what makes it survive a real CRM export:
 *  - phone   → digits only, last 10, so 08068880766 / +2348068880766 /
 *              080-6888-0766 / (080) 6888 0766 all collapse to one key.
 *  - product → the resolved product UUID, never the sheet's code text.
 *  - date    → calendar day only; the time-of-day a CRM stamps is noise here.
 *
 * Returns null when any part is missing — an unkeyable row simply falls back to
 * external-id-only behaviour rather than matching something arbitrary.
 */
function buildImportIdentityKey(args: {
  phone: string | undefined;
  productId: string | undefined;
  createdAtOverride: string | undefined;
}): string | null {
  const digits = (args.phone ?? '').replace(/\D/g, '');
  // Require a plausible line: shorter than 10 digits is junk ("CALL SHOP", a
  // truncated Excel number) and must never key an order.
  if (digits.length < 10) return null;
  const phone = digits.slice(-10);

  if (!args.productId) return null;

  const raw = (args.createdAtOverride ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  // Calendar day in UTC. Both sides of a comparison are built the same way, so
  // the choice of zone only has to be CONSISTENT, not correct-per-locale.
  const day = parsed.toISOString().slice(0, 10);

  return createHash('sha256').update(`${phone}|${args.productId}|${day}`).digest('hex');
}

export interface CreateImportJobInput {
  fileUrl: string;
  fileKey: string;
  fileName: string;
  fileType: 'xlsx' | 'csv';
  /** Client-counted data rows, shown as TOTAL until the worker recomputes it. */
  totalRows?: number;
  config: ImportJobConfig;
}

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger('BulkImport');
  /** In-process guard so overlapping @Cron ticks never double-drain one job. */
  private draining = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly ordersService: OrdersService,
  ) {}

  // ── Public API (called by the tRPC router) ─────────────────────────────────

  async createJob(
    input: CreateImportJobInput,
    actorId: string,
    activeGroupId?: string | null,
    countryScope?: {
      /** ctx.effectiveCurrencyCodes — the caller's hard country data scope. */
      allowedCurrencyCodes?: string[] | null;
      /** ctx.currentCurrencyCode — the top-bar country selection. */
      selectedCurrencyCode?: string | null;
    },
  ): Promise<{ id: string }> {
    // Stamp the caller's company + country scope onto the config so the worker
    // scopes code resolution, branch derivation, AND currency to it (never
    // trusted from the client).
    const config: ImportJobConfig = {
      ...input.config,
      groupId: activeGroupId ?? null,
      allowedCurrencyCodes: countryScope?.allowedCurrencyCodes ?? null,
      selectedCurrencyCode: countryScope?.selectedCurrencyCode ?? null,
    };
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.importJobs)
        .values({
          resourceType: 'orders',
          status: 'PENDING',
          fileUrl: input.fileUrl,
          fileKey: input.fileKey,
          fileName: input.fileName,
          fileType: input.fileType,
          config,
          // Client-counted rows so TOTAL shows immediately; the worker's first
          // pass recomputes the authoritative count and overwrites this.
          totalRows: input.totalRows ?? 0,
          branchId: config.branchId ?? null,
          createdBy: actorId,
        })
        .returning({ id: schema.importJobs.id });
      const created = rows[0];
      if (!created) throw new Error('Failed to create import job');
      this.logger.log(`Job ${created.id} created (${input.fileName})`);
      // Kick the worker immediately rather than waiting for the next cron tick.
      void this.tick();
      return { id: created.id };
    });
  }

  async getStatus(jobId: string) {
    const rows = await this.db
      .select()
      .from(schema.importJobs)
      .where(eq(schema.importJobs.id, jobId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** List recent jobs for the import history panel. */
  async listJobs(limit = 20) {
    return this.db
      .select()
      .from(schema.importJobs)
      .orderBy(desc(schema.importJobs.createdAt))
      .limit(limit);
  }

  /**
   * Paginated per-row outcomes for a job (from import_job_rows), in row order.
   * Optional `status` filter (IMPORTED / WARNING / FAILED). Returns the page of
   * rows plus a total count so the UI can paginate large imports without
   * pulling 100k rows at once.
   */
  async listRows(
    jobId: string,
    opts?: {
      page?: number;
      limit?: number;
      status?: schema.ImportRowStatus;
      /** Free text over external id, customer name, and order number. */
      search?: string;
      /** The IMPORTED order's own lifecycle status (CONFIRMED, DELIVERED…). */
      orderStatus?: string;
      /**
       * Failure-reason bucket, so a big import can be triaged by CAUSE rather
       * than scrolling. Matches the reason text the worker stored.
       */
      reasonKind?: string;
    },
  ) {
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(Math.max(1, opts?.limit ?? 100), 500);
    const offset = (page - 1) * limit;
    const conditions = [eq(schema.importJobRows.jobId, jobId)];
    if (opts?.status) conditions.push(eq(schema.importJobRows.status, opts.status));
    if (opts?.orderStatus) {
      conditions.push(eq(schema.orders.status, opts.orderStatus as never));
    }
    const search = opts?.search?.trim();
    if (search) {
      // Raw customer phone is deliberately NOT searchable here (Pillar 2).
      const like = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const numeric = /^\d+$/.test(search) ? Number(search) : null;
      const parts = [
        sql`${schema.importJobRows.externalId} ILIKE ${like}`,
        sql`${schema.orders.customerName} ILIKE ${like}`,
        ...(numeric != null ? [sql`${schema.orders.orderNumber} = ${numeric}`] : []),
      ];
      conditions.push(sql`(${sql.join(parts, sql` OR `)})`);
    }
    if (opts?.reasonKind) {
      const kind = REASON_KINDS.find((k) => k.value === opts.reasonKind);
      if (kind) conditions.push(sql`${schema.importJobRows.reason} ILIKE ${kind.match}`);
    }
    const where = and(...conditions);

    const [rows, countRows] = await Promise.all([
      // LEFT JOIN the imported order (by import_external_id) so the UI can show
      // the actual order — name, amount, currency, status — not just the row
      // outcome. FAILED rows have no order, so the joined columns come back null.
      // NOTE: customer phone is intentionally NOT selected here (Pillar 2 — raw
      // phones never leave the API for the import view).
      this.db
        .select({
          rowIndex: schema.importJobRows.rowIndex,
          status: schema.importJobRows.status,
          externalId: schema.importJobRows.externalId,
          reason: schema.importJobRows.reason,
          // Present only for FAILED rows — the UI uses it to decide whether the
          // row can be opened for fix-and-resubmit.
          hasRawData: sql<boolean>`(${schema.importJobRows.rawData} is not null)`,
          // The FAILED row's own source cells. A failed row has no joined order,
          // so without these every column below renders as a dash even though the
          // sheet had a perfectly good name, date and product on that row. The UI
          // falls back to these so the user can SEE what the row contained.
          rawData: schema.importJobRows.rawData,
          orderId: schema.orders.id,
          orderNumber: schema.orders.orderNumber,
          customerName: schema.orders.customerName,
          deliveryState: schema.orders.deliveryState,
          totalAmount: schema.orders.totalAmount,
          currencyCode: schema.orders.currencyCode,
          orderStatus: schema.orders.status,
          // Order date — the import stamps this from the sheet's date column
          // (createdAtOverride), else defaults to when the row was imported.
          orderCreatedAt: schema.orders.createdAt,
        })
        .from(schema.importJobRows)
        .leftJoin(
          schema.orders,
          eq(schema.orders.importExternalId, schema.importJobRows.externalId),
        )
        .where(where)
        .orderBy(schema.importJobRows.rowIndex)
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.importJobRows)
        // Same LEFT JOIN as the page query: the search / order-status filters
        // reference orders columns, so the count must see them too or the
        // "Showing X of Y" total disagrees with the rows actually listed.
        .leftJoin(
          schema.orders,
          eq(schema.orders.importExternalId, schema.importJobRows.externalId),
        )
        .where(where),
    ]);

    // Product name per order (first line item), fetched once for the page.
    const orderIds = rows.map((r) => r.orderId).filter((id): id is string => !!id);
    const productByOrder = new Map<string, string>();
    if (orderIds.length > 0) {
      const items = await this.db
        .select({
          orderId: schema.orderItems.orderId,
          productName: schema.products.name,
        })
        .from(schema.orderItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
        .where(inArray(schema.orderItems.orderId, orderIds));
      for (const it of items) {
        // First item wins (import creates a single-line order per row).
        if (!productByOrder.has(it.orderId)) productByOrder.set(it.orderId, it.productName);
      }
    }

    // A FAILED row has no joined order, so every display column would be a dash
    // even when the sheet's own cells were perfectly readable. Fall back to the
    // row's stored source cells (mapped through the job's column map) so the user
    // sees WHAT the row contained and can spot the bad field at a glance.
    // Only fetch the job's column map when this page actually contains a row
    // needing the fallback — a page of clean imports skips the extra query.
    const needsSourceFallback = rows.some((r) => !r.orderId);
    const jobRow = needsSourceFallback ? await this.getStatus(jobId) : null;

    // Rows that failed BEFORE per-row values were captured have no snapshot, so
    // every column on them would render as a dash. Recover their cells from the
    // uploaded file — ONE pass for the whole page, collecting every missing row
    // index at once, never a scan per row (a 100-row page would otherwise mean
    // 100 full file reads). Best-effort: if the file is gone the rows simply
    // stay blank, exactly as before.
    const missingIndexes = rows
      .filter((r) => !r.orderId && r.rawData == null)
      .map((r) => r.rowIndex);
    const recoveredByIndex = new Map<number, Record<string, string>>();
    if (missingIndexes.length > 0 && jobRow?.fileKey) {
      const found = await this.readRowsFromSourceFile(
        jobRow.fileKey,
        (jobRow.fileType as 'xlsx' | 'csv') ?? 'xlsx',
        missingIndexes,
      );
      for (const [idx, rec] of found) recoveredByIndex.set(idx, rec);
    }
    const cfg = (jobRow?.config ?? null) as ImportJobConfig | null;
    const cm = cfg?.columnMap;
    const pick = (raw: Record<string, string> | null, header?: string): string | null => {
      if (!raw || !header) return null;
      const v = raw[header];
      return v != null && v.trim() !== '' ? v.trim() : null;
    };

    const enriched = rows.map((r) => {
      const raw = ((r.rawData ?? recoveredByIndex.get(r.rowIndex)) ?? null) as
        | Record<string, string>
        | null;
      // Only fall back for rows that produced no order — never override real
      // imported values with the (possibly stale) source snapshot.
      const useRaw = !r.orderId && raw != null;
      return {
        ...r,
        rawData: undefined, // not sent to the client; the fix modal fetches it per row
        productName: r.orderId ? productByOrder.get(r.orderId) ?? null : null,
        customerName: r.customerName ?? (useRaw ? pick(raw, cm?.customerName) : null),
        deliveryState: r.deliveryState ?? (useRaw ? pick(raw, cm?.deliveryState) : null),
        totalAmount: r.totalAmount ?? (useRaw ? pick(raw, cm?.totalAmount) : null),
        // Source cells for the columns that have no order to read from. The UI
        // renders these in a muted style to signal "from the file, not imported".
        //
        // These are populated for EVERY failed row that has a snapshot, whatever
        // the failure reason. mapRow throws on the FIRST bad field, so a row
        // blocked by (say) a bad product code still had a perfectly good name,
        // date and status — the user needs to see those to judge the row, and to
        // recognise it as theirs. Showing only the field that broke, and dashes
        // everywhere else, hides the 90% that was fine.
        sourceProduct: useRaw ? pick(raw, cm?.productCode) : null,
        sourceDate: useRaw ? pick(raw, cm?.createdAt) : null,
        sourceStatus: useRaw ? pick(raw, cm?.status) : null,
        // The sheet's own Order ID cell. `externalId` is NULL on a row that
        // failed BECAUSE the id was missing/blank, but the cell may still hold
        // something (e.g. whitespace) worth showing rather than a bare dash.
        sourceExternalId:
          useRaw && !r.externalId ? pick(raw, cfg?.externalIdColumn) : null,
        /** True when the visible values came from the file rather than an order. */
        fromSource: useRaw,
      };
    });

    const total = countRows[0]?.count ?? 0;
    return { rows: enriched, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * Option lists for the fix-a-failed-row form: the products, media buyers, CS
   * closers and currencies this job could actually resolve, plus the accepted
   * status labels. Scoped to the job's OWN company + country scope, so the form
   * can only offer values that will pass `mapRow` — the user cannot re-enter an
   * invalid code, which is what caused most failures in the first place.
   */
  async getRowOptions(jobId: string) {
    const job = await this.getStatus(jobId);
    if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' });
    const config = job.config as ImportJobConfig;
    const groupId = config?.groupId ?? null;

    const [products, users, currencies] = await Promise.all([
      this.db
        .select({
          code: schema.products.productNumber,
          name: schema.products.name,
        })
        .from(schema.products)
        .where(groupId ? eq(schema.products.groupId, groupId) : isNull(schema.products.groupId))
        .orderBy(schema.products.productNumber),
      groupId
        ? this.db
            .selectDistinct({
              code: schema.users.userNumber,
              name: schema.users.name,
              role: schema.users.role,
            })
            .from(schema.users)
            .innerJoin(schema.userBranches, eq(schema.userBranches.userId, schema.users.id))
            .innerJoin(schema.branches, eq(schema.branches.id, schema.userBranches.branchId))
            .where(eq(schema.branches.groupId, groupId))
            .orderBy(schema.users.userNumber)
        : this.db
            .select({
              code: schema.users.userNumber,
              name: schema.users.name,
              role: schema.users.role,
            })
            .from(schema.users)
            .orderBy(schema.users.userNumber),
      this.db
        .select({ code: schema.currencies.code, countryName: schema.currencies.countryName })
        .from(schema.currencies)
        .where(
          groupId
            ? and(eq(schema.currencies.groupId, groupId), eq(schema.currencies.active, true))
            : eq(schema.currencies.active, true),
        ),
    ]);

    // Honour the job's country scope: never offer a currency the import would
    // then hard-fail on.
    const allowed = config?.allowedCurrencyCodes;
    const scopedCurrencies =
      allowed && allowed.length > 0
        ? currencies.filter((c) => allowed.includes(c.code.toUpperCase()))
        : currencies;

    return {
      products: products
        .filter((p) => p.code != null)
        .map((p) => ({ code: `PDT-${p.code}`, name: p.name })),
      users: users
        .filter((u) => u.code != null)
        .map((u) => ({
          code: `USR-${u.code}`,
          name: u.name,
          role: u.role,
        })),
      currencies: scopedCurrencies.map((c) => ({ code: c.code, countryName: c.countryName })),
      statuses: IMPORT_STATUS_OPTIONS,
    };
  }

  /**
   * Fetch ONE row of a job together with the original source cells we kept when
   * it failed, so the job page can render it in an editable form.
   *
   * Returns `rawData: null` when the row imported cleanly (nothing to fix) or
   * when it failed before this feature existed (migration 0339 added the
   * column — older jobs have no snapshot and can only be fixed by re-uploading).
   */
  async getRow(jobId: string, rowIndex: number) {
    const rows = await this.db
      .select({
        rowIndex: schema.importJobRows.rowIndex,
        status: schema.importJobRows.status,
        externalId: schema.importJobRows.externalId,
        reason: schema.importJobRows.reason,
        rawData: schema.importJobRows.rawData,
      })
      .from(schema.importJobRows)
      .where(
        and(
          eq(schema.importJobRows.jobId, jobId),
          eq(schema.importJobRows.rowIndex, rowIndex),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const job = await this.getStatus(jobId);
    const config = (job?.config ?? null) as ImportJobConfig | null;

    // No stored snapshot? Recover the cells from the uploaded file, which is
    // still in object storage. This covers rows that failed BEFORE migration
    // 0339 added raw_data — without it those rows could only be fixed by
    // re-running the whole import. Best-effort: if the file is gone or
    // unreadable, we return rawData:null and the UI explains the fallback.
    let rawData = row.rawData;
    let recoveredFromFile = false;
    if (!rawData && row.status !== 'IMPORTED' && job?.fileKey) {
      const recovered = await this.readRowFromSourceFile(
        job.fileKey,
        (job.fileType as 'xlsx' | 'csv') ?? 'xlsx',
        rowIndex,
      );
      if (recovered) {
        rawData = recovered;
        recoveredFromFile = true;
      }
    }

    return {
      ...row,
      rawData,
      /** True when the values came from the file rather than a stored snapshot. */
      recoveredFromFile,
      /** The header→field mapping, so the UI knows which cell is which field. */
      columnMap: config?.columnMap ?? null,
      externalIdColumn: config?.externalIdColumn ?? null,
    };
  }

  /**
   * Read ONE data row back out of the original uploaded file.
   *
   * Used to recover the cells of a failed row that has no stored snapshot. The
   * file streams from object storage and we stop as soon as the wanted row is
   * reached, so we never hold more than one row in memory — but it IS a full
   * scan up to that index, so this is strictly an on-demand, single-row path
   * (the import worker still uses chunked streaming).
   *
   * Returns null when the file is missing, unreadable, or shorter than the
   * requested index; the caller degrades to "no values available".
   */
  /**
   * Read MANY data rows back out of the original uploaded file in ONE pass.
   *
   * The single-row helper is fine for opening one row in the fix modal, but the
   * job page renders up to 100 rows at a time — scanning the file once per row
   * would be pathological. This walks the file a single time, collecting every
   * requested index, and stops as soon as the last one is found.
   *
   * Bounded on purpose: at most MAX_RECOVERED_ROWS rows are recovered per call,
   * so a page full of snapshot-less rows can't hold the stream open indefinitely.
   * Best-effort — a missing/unreadable file yields an empty map and the caller
   * simply renders blanks.
   */
  private async readRowsFromSourceFile(
    fileKey: string,
    fileType: 'xlsx' | 'csv',
    indexes: number[],
  ): Promise<Map<number, Record<string, string>>> {
    const out = new Map<number, Record<string, string>>();
    const wanted = new Set(indexes.slice(0, MAX_RECOVERED_ROWS));
    if (wanted.size === 0) return out;
    const lastWanted = Math.max(...wanted);

    let stream: Readable | null = null;
    try {
      stream = await getObjectStreamFromStorage(fileKey);
      if (!stream) return out;
      for await (const { rowIndex: idx, record } of streamImportRows(stream, fileType)) {
        if (wanted.has(idx)) {
          out.set(idx, snapshotRawRow(record));
          wanted.delete(idx);
        }
        // Nothing further to find — stop reading the rest of the file.
        if (wanted.size === 0 || idx >= lastWanted) break;
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `Could not recover rows from ${fileKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return out;
    } finally {
      stream?.destroy();
    }
  }

  private async readRowFromSourceFile(
    fileKey: string,
    fileType: 'xlsx' | 'csv',
    rowIndex: number,
  ): Promise<Record<string, string> | null> {
    let stream: Readable | null = null;
    try {
      stream = await getObjectStreamFromStorage(fileKey);
      if (!stream) return null;
      for await (const { rowIndex: idx, record } of streamImportRows(stream, fileType)) {
        if (idx < rowIndex) continue;
        if (idx > rowIndex) break;
        return snapshotRawRow(record);
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Could not recover row ${rowIndex} from ${fileKey}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    } finally {
      stream?.destroy();
    }
  }

  /**
   * Re-import a single FAILED row after the user corrected it on the job page.
   *
   * The edited cells arrive keyed by the SAME source header names as the
   * original file, so they go through the EXACT same `mapRow` + upsert path as a
   * normal import row. That is deliberate: a fixed row gets identical validation,
   * identical branch/currency derivation, identical audit trail. There is no
   * second, laxer code path that could let a bad row in.
   *
   * On success the row flips to IMPORTED and its raw snapshot is cleared; the
   * job's failure counters are decremented and its error_log entry dropped, so
   * the page's counts stay truthful. On failure the row stays FAILED with the
   * NEW reason (and the newly-edited cells retained), so the user can keep
   * iterating on it.
   */
  async resubmitRow(
    jobId: string,
    rowIndex: number,
    edited: Record<string, string>,
    actorId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const job = await this.getStatus(jobId);
    if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' });
    // A row the worker may still be touching must not be edited underneath it.
    if (job.status === 'PROCESSING' || job.status === 'PENDING') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This import is still running. Wait for it to finish before fixing rows.',
      });
    }

    const existing = await this.db
      .select({
        status: schema.importJobRows.status,
        rawData: schema.importJobRows.rawData,
      })
      .from(schema.importJobRows)
      .where(
        and(
          eq(schema.importJobRows.jobId, jobId),
          eq(schema.importJobRows.rowIndex, rowIndex),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Row not found' });
    if (row.status === 'IMPORTED') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This row already imported. Nothing to fix.',
      });
    }

    const config = job.config as ImportJobConfig;
    // Base cells to merge the edits onto. Prefer the stored snapshot; if the row
    // predates raw_data, recover them from the uploaded file so the UNMAPPED
    // columns (WhatsApp number, comments, delivery agent…) survive the resubmit
    // instead of being silently dropped.
    let base = row.rawData as Record<string, string> | null;
    if (!base && job.fileKey) {
      base = await this.readRowFromSourceFile(
        job.fileKey,
        (job.fileType as 'xlsx' | 'csv') ?? 'xlsx',
        rowIndex,
      );
    }

    // Merge the edits over the base so untouched cells keep their original
    // values (the UI only sends the mapped fields).
    const record: Record<string, unknown> = { ...(base ?? {}), ...edited };

    const codeMaps = await this.loadCodeMaps(config);

    let externalId: string | null = null;
    try {
      const { input } = this.mapRow(record, config, codeMaps);
      externalId = input.importExternalId;
      await this.ordersService.upsertImportOrderByExternalId(input, actorId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Keep the row FAILED, but store the user's edits + the new reason so the
      // next attempt starts from where they left off.
      await this.flushRowRecords(jobId, [
        {
          rowIndex,
          status: 'FAILED',
          externalId: this.readCell(record, config.externalIdColumn) ?? null,
          reason,
          rawData: snapshotRawRow(record),
        },
      ]);
      return { ok: false, reason };
    }

    // Imported. Flip the row and clear its snapshot.
    await this.flushRowRecords(jobId, [
      { rowIndex, status: 'IMPORTED', externalId, reason: null, rawData: null },
    ]);

    // Keep the job's counters honest: one fewer failure, one more processed,
    // and drop this row's entry from the error log.
    const remainingLog = (job.errorLog ?? []).filter((f) => f.row !== rowIndex);
    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx
        .update(schema.importJobs)
        .set({
          failedRows: sql`greatest(${schema.importJobs.failedRows} - 1, 0)`,
          processedRows: sql`${schema.importJobs.processedRows} + 1`,
          errorLog: remainingLog,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.importJobs.id, jobId));
    });

    this.logger.log(`Job ${jobId} row ${rowIndex} fixed and imported by ${actorId}`);
    return { ok: true };
  }

  /**
   * Counts for the job page's filter chrome: how many rows sit in each import
   * outcome, and how many failures fall into each reason bucket. Lets the page
   * show "Failed (133)" and hide reason buckets that have no rows, so the CEO
   * sees at a glance what actually went wrong rather than guessing.
   */
  async getRowFacets(jobId: string) {
    const [byStatus, byReason, byOrderStatus] = await Promise.all([
      this.db
        .select({ status: schema.importJobRows.status, count: sql<number>`count(*)::int` })
        .from(schema.importJobRows)
        .where(eq(schema.importJobRows.jobId, jobId))
        .groupBy(schema.importJobRows.status),
      // One pass over the failed rows, bucketed in SQL by the same patterns the
      // filter uses. A row matching two buckets counts in both — the buckets are
      // a triage aid, not a partition.
      this.db
        .select({
          reason: schema.importJobRows.reason,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.importJobRows)
        .where(
          and(
            eq(schema.importJobRows.jobId, jobId),
            eq(schema.importJobRows.status, 'FAILED'),
          ),
        )
        .groupBy(schema.importJobRows.reason),
      this.db
        .select({ status: schema.orders.status, count: sql<number>`count(*)::int` })
        .from(schema.importJobRows)
        .innerJoin(
          schema.orders,
          eq(schema.orders.importExternalId, schema.importJobRows.externalId),
        )
        .where(eq(schema.importJobRows.jobId, jobId))
        .groupBy(schema.orders.status),
    ]);

    // Bucket the distinct reason strings in app code (there are few of them —
    // one per failure mode, not per row).
    const reasonCounts = new Map<string, number>();
    for (const r of byReason) {
      const text = (r.reason ?? '').toLowerCase();
      for (const k of REASON_KINDS) {
        const needle = k.match.replace(/%/g, '').toLowerCase();
        if (needle && text.includes(needle)) {
          reasonCounts.set(k.value, (reasonCounts.get(k.value) ?? 0) + r.count);
        }
      }
    }

    return {
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
      byOrderStatus: Object.fromEntries(byOrderStatus.map((r) => [r.status, r.count])),
      reasons: REASON_KINDS.filter((k) => (reasonCounts.get(k.value) ?? 0) > 0).map((k) => ({
        value: k.value,
        label: k.label,
        count: reasonCounts.get(k.value) ?? 0,
      })),
    };
  }

  /**
   * Delete an import job and its per-row records (import_job_rows cascades via
   * the FK). Does NOT touch any orders already imported — those are real,
   * audited records; deleting the job only removes the import bookkeeping. A
   * PROCESSING job is refused so we never yank a row out from under the worker.
   */
  async deleteJob(jobId: string, actorId: string): Promise<{ ok: boolean }> {
    const job = await this.getStatus(jobId);
    if (!job) return { ok: false };
    if (job.status === 'PROCESSING') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This import is still processing. Wait for it to pause or finish before deleting.',
      });
    }
    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx.delete(schema.importJobs).where(eq(schema.importJobs.id, jobId));
    });
    return { ok: true };
  }

  /**
   * Continue a stopped job. Flips PAUSED/FAILED back to PENDING so the worker
   * picks it up and resumes from `cursor`. No-op if already terminal/running.
   */
  async resume(jobId: string, actorId: string): Promise<{ ok: boolean }> {
    const job = await this.getStatus(jobId);
    if (!job) return { ok: false };
    if (job.status !== 'PAUSED' && job.status !== 'FAILED') {
      // Already PENDING/PROCESSING/COMPLETED — nothing to do.
      return { ok: job.status === 'PROCESSING' || job.status === 'PENDING' };
    }
    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx
        .update(schema.importJobs)
        // Clearing pauseRequested is essential: a job paused by the operator
        // still carries the flag, and the worker would stop again at the very
        // next chunk boundary if we left it set.
        .set({
          status: 'PENDING',
          lastError: null,
          pauseRequested: false,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.importJobs.id, jobId));
    });
    void this.tick();
    return { ok: true };
  }

  /**
   * Operator-requested pause.
   *
   * PENDING (queued, no chunk in flight) → PAUSED immediately.
   * PROCESSING (a chunk is draining) → record the request and let the worker
   *   stop itself at the next chunk boundary, where the cursor and per-row
   *   records are already consistent. Writing PAUSED here instead would just be
   *   overwritten by the in-flight chunk's own boundary write.
   * Anything else (PAUSED / COMPLETED / FAILED) → nothing to do.
   */
  async pause(jobId: string, actorId: string): Promise<{ ok: boolean; pending: boolean }> {
    const job = await this.getStatus(jobId);
    if (!job) return { ok: false, pending: false };

    if (job.status === 'PENDING') {
      await withActor(this.db, { id: actorId }, async (tx) => {
        await tx
          .update(schema.importJobs)
          .set({ status: 'PAUSED', pauseRequested: false, updatedAt: sql`now()` })
          .where(
            and(eq(schema.importJobs.id, jobId), eq(schema.importJobs.status, 'PENDING')),
          );
      });
      return { ok: true, pending: false };
    }

    if (job.status === 'PROCESSING') {
      await withActor(this.db, { id: actorId }, async (tx) => {
        await tx
          .update(schema.importJobs)
          .set({ pauseRequested: true, updatedAt: sql`now()` })
          .where(eq(schema.importJobs.id, jobId));
      });
      // `pending` tells the UI the stop is requested but not yet in effect, so
      // it can show "Pausing…" rather than claiming the job is already stopped.
      return { ok: true, pending: true };
    }

    return { ok: false, pending: false };
  }

  /**
   * Retry only the failed rows: reset the cursor to the smallest failed row so
   * the worker re-streams from there and re-upserts. Idempotency means the
   * already-succeeded rows in that range are simply overwritten with identical
   * data, so this is safe. Clears error_log.
   */
  async retryFailed(jobId: string, actorId: string): Promise<{ ok: boolean }> {
    const job = await this.getStatus(jobId);
    if (!job) return { ok: false };
    const all = job.errorLog ?? [];
    // Only hard errors are retryable. Warnings (imported-with-unresolved rows)
    // are re-synced by re-running the whole file, not by Retry Failed.
    const hardErrors = all.filter((f) => (f.severity ?? 'error') === 'error');
    if (hardErrors.length === 0) return { ok: false };
    const minFailedRow = hardErrors.reduce((m, f) => Math.min(m, f.row), Number.MAX_SAFE_INTEGER);
    const resumeFrom = Number.isFinite(minFailedRow) ? minFailedRow : 0;
    // Keep the log for rows we will NOT re-process (both warnings and errors
    // below the resume point); the reprocessed range rebuilds its own entries.
    const kept = all.filter((f) => f.row < resumeFrom);
    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx
        .update(schema.importJobs)
        .set({
          status: 'PENDING',
          cursor: resumeFrom,
          // Only clear the failure count; warnings are not counted in failedRows.
          failedRows: 0,
          errorLog: kept,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.importJobs.id, jobId));
    });
    void this.tick();
    return { ok: true };
  }

  // ── Background worker ───────────────────────────────────────────────────────

  /**
   * Fires every 30s. Claims the oldest PENDING job and drains ONE chunk, then
   * yields — the next tick resumes it (or the immediate self-kick after a chunk).
   * This is the resumable grain: cursor is persisted after every chunk, so a
   * stop/crash/restart never loses more than the in-flight chunk.
   */
  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const job = await this.claimNextJob();
      if (!job) return;
      await this.drainChunk(job.id);
    } catch (err) {
      this.logger.error(`tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.draining = false;
    }
  }

  /** Atomically move the oldest PENDING job to PROCESSING and return it. */
  private async claimNextJob() {
    return withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      // Reaper: a job left in PROCESSING with no recent progress is orphaned —
      // the worker crashed/restarted mid-chunk (e.g. the process died on an
      // unhandled stream error). The cursor is persisted per chunk, so requeue
      // it to PENDING and it resumes from where it left off, losing at most the
      // in-flight chunk. Guard on updatedAt so we never steal a chunk that's
      // legitimately still draining.
      await tx
        .update(schema.importJobs)
        .set({ status: 'PENDING', updatedAt: sql`now()` })
        .where(
          and(
            eq(schema.importJobs.status, 'PROCESSING'),
            sql`${schema.importJobs.updatedAt} < now() - interval '2 minutes'`,
          ),
        );

      const pending = await tx
        .select({ id: schema.importJobs.id })
        .from(schema.importJobs)
        .where(eq(schema.importJobs.status, 'PENDING'))
        .orderBy(schema.importJobs.createdAt)
        .limit(1);
      const row = pending[0];
      if (!row) return null;
      const updated = await tx
        .update(schema.importJobs)
        .set({
          status: 'PROCESSING',
          startedAt: sql`COALESCE(started_at, now())`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(schema.importJobs.id, row.id), eq(schema.importJobs.status, 'PENDING')))
        .returning({ id: schema.importJobs.id });
      return updated[0] ?? null;
    });
  }

  /**
   * Stream the file from `cursor`, upsert up to CHUNK_SIZE rows, then persist
   * progress and hand back control. On success-of-whole-file → COMPLETED. On a
   * fatal error (file unreadable) → FAILED. Per-row errors are collected and do
   * NOT stop the chunk.
   */
  private async drainChunk(jobId: string): Promise<void> {
    const job = await this.getStatus(jobId);
    if (!job || job.status !== 'PROCESSING') return;

    const config = job.config as ImportJobConfig | null;
    if (!config) {
      await this.markFailed(jobId, 'Job has no config');
      return;
    }

    // Pre-load code → UUID maps + user→primary-branch + company fallback branch
    // ONCE for this chunk. A failure here is fatal for the chunk (can't resolve
    // anything), so pause and let the user resume.
    let codeMaps: CodeMaps;
    try {
      codeMaps = await this.loadCodeMaps(config);
    } catch (err) {
      await this.markFailed(
        jobId,
        `Failed to load lookup codes: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const startRow = job.cursor;
    const endRowExclusive = startRow + CHUNK_SIZE;
    let processedInChunk = 0;
    let lastRowSeen = startRow;
    let reachedEnd = true;
    // error_log holds BOTH hard errors and unresolved-reference warnings. Rebuild
    // it fresh each chunk to avoid duplicating a row's warning on re-touch: keep
    // only entries for rows OUTSIDE the range this chunk will re-process.
    const failures: ImportRowFailure[] = (job.errorLog ?? []).filter(
      (f) => f.row < startRow || f.row >= endRowExclusive,
    );
    let newFailures = 0;
    let newProcessed = 0;
    let newWarnings = 0;
    // Per-row outcomes for THIS chunk, upserted into import_job_rows so the job
    // page can list every uploaded row (not just failures). Keyed by row_index,
    // so a resume/retry re-stamps the same row instead of duplicating it.
    const rowRecords: Array<{
      rowIndex: number;
      status: schema.ImportRowStatus;
      externalId: string | null;
      reason: string | null;
      rawData?: Record<string, string> | null;
    }> = [];
    // How many of rowRecords have already been written by a mid-chunk heartbeat,
    // so the boundary/error flush only writes the remainder (ON CONFLICT makes a
    // re-write harmless, but this avoids the redundant round-trip).
    let flushedUpTo = 0;
    // Progress counts already written to the DB by mid-chunk heartbeats (which
    // write ABSOLUTE values). The boundary persistProgress is ADD-based, so it
    // must add only the delta SINCE the last heartbeat, or it would double-count.
    let heartbeatProcessed = 0;
    let heartbeatFailed = 0;
    // Set when an operator pause is observed MID-chunk, so we stop at the next
    // row instead of running to the 500-row boundary (or, on the final chunk,
    // never checking at all). See the heartbeat block below.
    let pausedMidChunk = false;

    let stream: Readable | null;
    try {
      stream = await getObjectStreamFromStorage(job.fileKey ?? '');
    } catch (err) {
      await this.markFailed(jobId, `Cannot open file: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!stream) {
      await this.markFailed(jobId, 'Object storage not configured');
      return;
    }

    try {
      for await (const { rowIndex, record } of streamImportRows(stream, job.fileType as 'xlsx' | 'csv')) {
        // Skip everything before the cursor (already processed).
        if (rowIndex < startRow) continue;
        // Chunk boundary: stop, we'll resume next tick from here.
        if (rowIndex >= endRowExclusive) {
          reachedEnd = false;
          break;
        }
        lastRowSeen = rowIndex;
        try {
          const { input, unresolved } = this.mapRow(record, config, codeMaps);
          await this.ordersService.upsertImportOrderByExternalId(input, job.createdBy);
          newProcessed += 1;
          // Row imported, but one or more codes didn't resolve → non-fatal
          // warning. The field is NULL; fixing the code on the sheet and
          // re-importing back-fills it (idempotent upsert).
          if (unresolved.length > 0) {
            newWarnings += 1;
            const warnReason = `Imported with unresolved: ${unresolved
              .map((u) => `${u.field}="${u.code}"`)
              .join(', ')}`;
            if (failures.length < MAX_ERROR_LOG) {
              failures.push({
                row: rowIndex,
                externalId: input.importExternalId,
                severity: 'warning',
                unresolved,
                reason: warnReason,
              });
            }
            rowRecords.push({ rowIndex, status: 'WARNING', externalId: input.importExternalId, reason: warnReason, rawData: null });
          } else {
            rowRecords.push({ rowIndex, status: 'IMPORTED', externalId: input.importExternalId, reason: null, rawData: null });
          }
        } catch (rowErr) {
          newFailures += 1;
          const failExternalId = this.readCell(record, config.externalIdColumn) ?? null;
          const failReason = rowErr instanceof Error ? rowErr.message : String(rowErr);
          if (failures.length < MAX_ERROR_LOG) {
            failures.push({
              row: rowIndex,
              externalId: failExternalId,
              severity: 'error',
              reason: failReason,
            });
          }
          rowRecords.push({
            rowIndex,
            status: 'FAILED',
            externalId: failExternalId,
            reason: failReason,
            // Keep the source cells so the job page can show this row and let
            // the user fix + resubmit it without re-uploading the file.
            rawData: snapshotRawRow(record),
          });
        }
        processedInChunk += 1;

        // Mid-chunk heartbeat: every N rows, push what we have so the live UI
        // advances instead of sitting at 0% for the whole (possibly slow) chunk.
        // We flush the NEW row records since the last heartbeat and write the
        // running ABSOLUTE progress (base counts + this chunk's deltas). This is
        // a lightweight direct update — the authoritative add-based
        // persistProgress still runs at the chunk boundary.
        if (processedInChunk % MID_CHUNK_FLUSH_EVERY === 0) {
          const fresh = rowRecords.slice(flushedUpTo);
          flushedUpTo = rowRecords.length;
          await this.flushRowRecords(jobId, fresh);
          await this.heartbeatProgress(jobId, {
            processedRows: (job.processedRows ?? 0) + newProcessed,
            failedRows: (job.failedRows ?? 0) + newFailures,
            cursor: lastRowSeen + 1,
          });
          heartbeatProcessed = newProcessed;
          heartbeatFailed = newFailures;

          // Honour an operator pause HERE, mid-chunk, not only at the 500-row
          // boundary. Two reasons this must live inside the loop:
          //   1. The boundary check is on the "more rows remain" path only, so a
          //      pause during the FINAL chunk was never honoured — the job ran to
          //      COMPLETED and the button sat on "Pausing…" forever.
          //   2. Every chunk re-streams the file from row 0 and skips to the
          //      cursor, so late chunks of a big file take a long time to reach
          //      their boundary. Waiting for it makes Pause look broken.
          // We've just flushed rows + progress, so stopping now loses nothing and
          // Continue resumes from exactly this cursor.
          if (await this.isPauseRequested(jobId)) {
            pausedMidChunk = true;
            reachedEnd = false;
            break;
          }
        }
      }
    } catch (streamErr) {
      await this.flushRowRecords(jobId, rowRecords.slice(flushedUpTo));
      flushedUpTo = rowRecords.length;
      const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      // Distinguish "the file itself is unreadable" (NOT resumable — retrying
      // hits the same error) from a genuine mid-stream parse failure (resumable
      // — pause and let the user Continue). A missing object / access error, or
      // a failure before we ever parsed a row, means re-upload is the only fix.
      const isFileUnreadable =
        /no such object|does not exist|not found|access denied|forbidden|permission|invalid zip|end of central directory|corrupt/i.test(
          msg,
        ) || newProcessed === 0;
      if (isFileUnreadable) {
        await this.markFailed(
          jobId,
          `Could not read the uploaded file: ${msg}. Re-upload the file and start a new import.`,
        );
        return;
      }
      // Genuine mid-stream parse failure: recoverable — pause and let the user resume.
      await this.persistProgress(jobId, {
        status: 'PAUSED',
        cursor: lastRowSeen + 1,
        // Only the delta since the last heartbeat (which already wrote its share).
        addProcessed: newProcessed - heartbeatProcessed,
        addFailed: newFailures - heartbeatFailed,
        errorLog: failures,
        lastError: `Parse error near row ${lastRowSeen}: ${msg}`,
      });
      return;
    }

    // Persist any per-row outcomes not yet written by a mid-chunk heartbeat,
    // before the progress write, so the job page's row list is consistent with
    // the counters.
    await this.flushRowRecords(jobId, rowRecords.slice(flushedUpTo));
    flushedUpTo = rowRecords.length;

    // A pause observed mid-chunk stops the job right here. This runs BEFORE the
    // reachedEnd branch on purpose: we broke out of the loop early, so the file
    // is not finished and the job must not be marked COMPLETED.
    if (pausedMidChunk) {
      await this.persistProgress(jobId, {
        status: 'PAUSED',
        cursor: lastRowSeen + 1,
        addProcessed: newProcessed - heartbeatProcessed,
        addFailed: newFailures - heartbeatFailed,
        errorLog: failures,
      });
      // Consume the request so Continue doesn't immediately re-pause.
      await this.clearPauseRequest(jobId);
      this.logger.log(`Job ${jobId} PAUSED by operator at row ${lastRowSeen + 1}`);
      return;
    }

    const nextCursor = reachedEnd ? lastRowSeen + 1 : endRowExclusive;

    if (reachedEnd) {
      // Whole file consumed.
      await this.persistProgress(jobId, {
        status: 'COMPLETED',
        cursor: nextCursor,
        // Only the delta since the last heartbeat (which already wrote its share).
        addProcessed: newProcessed - heartbeatProcessed,
        addFailed: newFailures - heartbeatFailed,
        errorLog: failures,
        totalRows: lastRowSeen + 1,
        finished: true,
      });
      // A pause requested in the final moments loses the race with completion.
      // Clear it, or the finished job keeps reporting "Pausing…" forever.
      await this.clearPauseRequest(jobId);
      const warningTotal = failures.filter((f) => f.severity === 'warning').length;
      const errorTotal = failures.length - warningTotal;
      this.logger.log(
        `Job ${jobId} COMPLETED (${newProcessed} imported in final chunk; ` +
          `${errorTotal} failed, ${warningTotal} imported-with-unresolved-refs)`,
      );
      return;
    }

    // More rows remain. Honour an operator pause request HERE, at the chunk
    // boundary: the cursor and the per-row records for this chunk are already
    // flushed, so stopping now loses nothing and Continue picks up exactly
    // where we left off. Re-read the flag rather than trusting the snapshot
    // taken at the top of the chunk, since the request usually arrives while
    // this chunk was draining.
    const pauseRequested = await this.isPauseRequested(jobId);

    await this.persistProgress(jobId, {
      status: pauseRequested ? 'PAUSED' : 'PENDING',
      cursor: nextCursor,
      // Only the delta since the last heartbeat (which already wrote its share).
      addProcessed: newProcessed - heartbeatProcessed,
      addFailed: newFailures - heartbeatFailed,
      errorLog: failures,
    });
    if (newWarnings > 0) {
      this.logger.log(`Job ${jobId} chunk: ${newWarnings} row(s) imported with unresolved refs`);
    }
    if (pauseRequested) {
      // Consume the request so Continue doesn't immediately re-pause.
      await this.clearPauseRequest(jobId);
      this.logger.log(`Job ${jobId} PAUSED by operator at row ${nextCursor}`);
      return;
    }
    // Continue draining without waiting for the next 30s tick.
    if (processedInChunk > 0) void this.tick();
  }

  /**
   * Upsert this chunk's per-row outcomes into import_job_rows. Keyed by
   * (job_id, row_index) so resume/retry re-stamps the same row instead of
   * duplicating. Best-effort: a failure here must NOT fail the chunk (the row
   * list is a convenience view, not the source of truth), so we log and move on.
   * Batched in one INSERT ... ON CONFLICT to keep it to a single round-trip.
   */
  /**
   * Has the operator asked to stop this job? Read at the chunk boundary only —
   * a fresh read, because the request typically lands while the chunk drains.
   * Best-effort: on a read failure we keep going (the next boundary re-checks)
   * rather than stalling an import on a transient DB blip.
   */
  private async isPauseRequested(jobId: string): Promise<boolean> {
    try {
      const rows = await this.db
        .select({ pauseRequested: schema.importJobs.pauseRequested })
        .from(schema.importJobs)
        .where(eq(schema.importJobs.id, jobId))
        .limit(1);
      return rows[0]?.pauseRequested === true;
    } catch {
      return false;
    }
  }

  /** Consume a honoured pause request so Continue starts cleanly. */
  private async clearPauseRequest(jobId: string): Promise<void> {
    try {
      await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
        await tx
          .update(schema.importJobs)
          .set({ pauseRequested: false, updatedAt: sql`now()` })
          .where(eq(schema.importJobs.id, jobId));
      });
    } catch (err) {
      // Non-fatal: resume() also clears the flag, so a miss here self-heals.
      this.logger.warn(
        `Job ${jobId}: failed to clear pause flag: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Lightweight mid-chunk progress heartbeat. Writes ABSOLUTE processed/failed
   * counts + cursor directly (the boundary persistProgress is add-based and
   * remains the authoritative write). Keeps `status='PROCESSING'` so a reaper
   * can't mistake an actively-draining job for a crashed one. Best-effort: a
   * failed heartbeat must not fail the chunk — the next one (or the boundary
   * write) corrects it.
   */
  private async heartbeatProgress(
    jobId: string,
    p: { processedRows: number; failedRows: number; cursor: number },
  ): Promise<void> {
    try {
      await this.db
        .update(schema.importJobs)
        .set({
          processedRows: p.processedRows,
          failedRows: p.failedRows,
          cursor: p.cursor,
          updatedAt: sql`now()`,
        })
        .where(and(eq(schema.importJobs.id, jobId), eq(schema.importJobs.status, 'PROCESSING')));
    } catch (err) {
      this.logger.warn(
        `heartbeatProgress failed for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async flushRowRecords(
    jobId: string,
    rows: Array<{
      rowIndex: number;
      status: schema.ImportRowStatus;
      externalId: string | null;
      reason: string | null;
      /** Source cells, FAILED rows only — powers fix-and-resubmit on the job page. */
      rawData?: Record<string, string> | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.db
        .insert(schema.importJobRows)
        .values(
          rows.map((r) => ({
            jobId,
            rowIndex: r.rowIndex,
            status: r.status,
            externalId: r.externalId,
            reason: r.reason,
            rawData: r.rawData ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.importJobRows.jobId, schema.importJobRows.rowIndex],
          set: {
            status: sql`excluded.status`,
            externalId: sql`excluded.external_id`,
            reason: sql`excluded.reason`,
            // A row that now IMPORTS clears its stale failure snapshot.
            rawData: sql`excluded.raw_data`,
          },
        });
    } catch (err) {
      this.logger.warn(
        `flushRowRecords failed for job ${jobId} (${rows.length} rows): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── Display-code resolution ──────────────────────────────────────────────────

  /**
   * Build the code→UUID lookup maps for a job, scoped to the job's company.
   *
   * The company (group) comes from the job config (`groupId`, stamped from the
   * creator's active company at createJob time). For legacy jobs without it we
   * fall back to the group of the job's explicit branch, else NULL (single
   * company / global install).
   *
   * ALWAYS runs now (not gated on code columns), because branch is DERIVED from
   * each row's media buyer / CS closer primary branch, so we always need the
   * user→primary-branch map and the company fallback branch. Still one query per
   * entity per chunk — never per row.
   */
  private async loadCodeMaps(config: ImportJobConfig): Promise<CodeMaps> {
    // Resolve the company group: prefer the stamped groupId, else the explicit
    // branch's group (backward-compat for jobs created before groupId existed).
    let groupId: string | null = config.groupId ?? null;
    if (!groupId && config.branchId) {
      const branchRows = await this.db
        .select({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(eq(schema.branches.id, config.branchId))
        .limit(1);
      groupId = branchRows[0]?.groupId ?? null;
    }

    const maps: CodeMaps = {
      users: new Map(),
      userPrimaryBranch: new Map(),
      products: new Map(),
      fallbackBranchId: null,
      currencyByKey: new Map(),
      userCurrencies: new Map(),
      baseCurrencyCode: 'NGN',
    };

    // Active currencies for this company: key by BOTH code and country name so a
    // sheet can say "GHS" or "Ghana". Also capture the base (default) currency.
    {
      const rows = await this.db
        .select({
          code: schema.currencies.code,
          countryName: schema.currencies.countryName,
          isDefault: schema.currencies.isDefault,
        })
        .from(schema.currencies)
        .where(
          groupId
            ? and(eq(schema.currencies.groupId, groupId), eq(schema.currencies.active, true))
            : eq(schema.currencies.active, true),
        );
      for (const r of rows) {
        const code = r.code.toUpperCase();
        maps.currencyByKey.set(code, code);
        if (r.countryName) maps.currencyByKey.set(r.countryName.toUpperCase(), code);
        if (r.isDefault) maps.baseCurrencyCode = code;
      }
    }

    // Per-user assigned countries (user_countries) for the currency fallback.
    {
      const rows = groupId
        ? await this.db
            .selectDistinct({
              userId: schema.userCountries.userId,
              currencyCode: schema.userCountries.currencyCode,
            })
            .from(schema.userCountries)
            .innerJoin(schema.userBranches, eq(schema.userBranches.userId, schema.userCountries.userId))
            .innerJoin(schema.branches, eq(schema.branches.id, schema.userBranches.branchId))
            .where(eq(schema.branches.groupId, groupId))
        : await this.db
            .select({
              userId: schema.userCountries.userId,
              currencyCode: schema.userCountries.currencyCode,
            })
            .from(schema.userCountries);
      for (const r of rows) {
        const list = maps.userCurrencies.get(r.userId) ?? [];
        list.push(r.currencyCode.toUpperCase());
        maps.userCurrencies.set(r.userId, list);
      }
    }

    // Products in this company (PDT-N → id).
    {
      const rows = await this.db
        .select({ id: schema.products.id, num: schema.products.productNumber })
        .from(schema.products)
        .where(groupId ? eq(schema.products.groupId, groupId) : isNull(schema.products.groupId));
      for (const r of rows) if (r.num != null) maps.products.set(String(r.num), r.id);
    }

    // Branches in this company: we only need the fallback (first by creation).
    // Branch is never taken from the sheet, so no code→id map is built.
    {
      const rows = await this.db
        .select({ id: schema.branches.id, createdAt: schema.branches.createdAt })
        .from(schema.branches)
        .where(groupId ? eq(schema.branches.groupId, groupId) : isNull(schema.branches.groupId))
        .orderBy(schema.branches.createdAt, schema.branches.id);
      // First branch in the group (ordered by creation) is the fallback.
      maps.fallbackBranchId = rows[0]?.id ?? config.branchId ?? null;
    }

    // Users in this company: USR-N → id AND id → primary branch (for derivation).
    // Scoped via user_branches membership; for a global/legacy job load all.
    {
      const rows = groupId
        ? await this.db
            .selectDistinct({
              id: schema.users.id,
              num: schema.users.userNumber,
              primaryBranchId: schema.users.primaryBranchId,
            })
            .from(schema.users)
            .innerJoin(schema.userBranches, eq(schema.userBranches.userId, schema.users.id))
            .innerJoin(schema.branches, eq(schema.branches.id, schema.userBranches.branchId))
            .where(eq(schema.branches.groupId, groupId))
        : await this.db
            .select({
              id: schema.users.id,
              num: schema.users.userNumber,
              primaryBranchId: schema.users.primaryBranchId,
            })
            .from(schema.users);
      for (const r of rows) {
        if (r.num != null) maps.users.set(String(r.num), r.id);
        if (r.primaryBranchId) maps.userPrimaryBranch.set(r.id, r.primaryBranchId);
      }
    }

    return maps;
  }

  // ── Row mapping ─────────────────────────────────────────────────────────────

  /** Read a cell by header name, coerced to a trimmed string. */
  private readCell(record: Record<string, unknown>, key: string): string | undefined {
    if (!(key in record)) return undefined;
    const v = record[key];
    if (v == null) return undefined;
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
      return String(v).trim();
    }
    try {
      return JSON.stringify(v).trim();
    } catch {
      return undefined;
    }
  }

  /**
   * Turn one raw spreadsheet record into an idempotent upsert input.
   *
   * Throws on invalid rows (missing external id / name / phone / product, or an
   * unknown product / media-buyer / CS code) — the caller catches and records
   * these as 'error' failures so the user fixes the code or record and re-imports.
   *
   * Display codes resolve against the pre-loaded `maps`:
   *  - product code   → REQUIRED to yield a product; falls back to
   *    defaultProductId, else throws (a line needs a product).
   *  - MB / CS codes  → if present and they don't resolve, the row HARD-FAILS.
   *    A blank cell is fine (the reference is simply left unset).
   *  - branch         → never on the sheet; derived from the MB / CS user.
   *
   * `unresolved` is retained in the return shape (the caller's warning path) but
   * is currently always empty — code mismatches now hard-fail instead.
   */
  private mapRow(
    record: Record<string, unknown>,
    config: ImportJobConfig,
    maps: CodeMaps,
  ): { input: ImportOrderInput & { importExternalId: string }; unresolved: UnresolvedRef[] } {
    const externalId = this.readCell(record, config.externalIdColumn);
    if (!externalId) {
      throw new Error(`Missing external id (column "${config.externalIdColumn}")`);
    }

    const m = config.columnMap;
    const customerName = this.readCell(record, m.customerName);
    const customerPhone = this.readCell(record, m.customerPhone);
    if (!customerName) throw new Error('Missing customer name');
    if (!customerPhone) throw new Error('Missing customer phone');

    // Product line: a product CODE (PDT-N) resolved via the map, then a raw
    // productId column, then the default. A line with no product can't exist, so
    // an unresolvable product code is a hard error for the row.
    let productId: string | undefined;
    const productCodeRaw = m.productCode ? this.readCell(record, m.productCode) : undefined;
    if (productCodeRaw) {
      const key = normalizeNumericCode(productCodeRaw);
      productId = (key && maps?.products.get(key)) || undefined;
      if (!productId && !config.defaultProductId) {
        throw new Error(`Unknown product code "${productCodeRaw}"`);
      }
    }
    if (!productId) {
      productId = (m.productId && this.readCell(record, m.productId)) || config.defaultProductId;
    }
    if (!productId) throw new Error('No product (missing product code/column and no default product)');

    const quantity =
      (m.quantity && Number(this.readCell(record, m.quantity))) || config.defaultQuantity || 1;
    const offerLabel = m.offerLabel ? this.readCell(record, m.offerLabel) : undefined;

    const totalAmountRaw = m.totalAmount ? this.readCell(record, m.totalAmount) : undefined;
    const totalAmount = totalAmountRaw != null && totalAmountRaw !== '' ? Number(totalAmountRaw) : undefined;

    // Line price. NOTE `unitPrice` is the OFFER/LINE TOTAL, not a per-unit rate
    // (see orders.service.ts: the order total sums line unitPrices directly, and
    // MEMORY offer_price_is_line_total). So it must NOT be multiplied by qty.
    //
    // Precedence:
    //   1. an explicit unit-price column, when the file has one;
    //   2. the order's Cost column — the usual case. A typical CRM export has a
    //      single money column ("Cost") and no per-unit column, so without this
    //      the line stored at 0 while the order total was stamped from Cost:
    //      the order read ₦175,000 but its item and invoice both read ₦0,
    //      because the invoice is built from the LINE ITEMS, not the header total;
    //   3. the job's configured default;
    //   4. 0 — only when the file carries no money at all.
    const unitPriceRaw = m.unitPrice ? this.readCell(record, m.unitPrice) : undefined;
    let unitPrice: number;
    if (unitPriceRaw != null && unitPriceRaw !== '') {
      unitPrice = Number(unitPriceRaw);
    } else if (totalAmount != null && Number.isFinite(totalAmount)) {
      unitPrice = totalAmount;
    } else {
      unitPrice = config.defaultUnitPrice ?? 0;
    }

    const createdAtOverride = m.createdAt ? this.readCell(record, m.createdAt) : undefined;

    // Per-row status from the sheet's Status column.
    //
    // STRICT BY DIRECTIVE (CEO, 2026-09-01): the sheet's status must match a
    // status the app actually has. So when a Status column is mapped, the cell
    // must resolve EXACTLY (see IMPORT_STATUS_LABELS) — a blank cell and an
    // unrecognised label both HARD-FAIL the row. Nothing is inferred: a blank no
    // longer silently inherits the job's default status.
    //
    // The job default (config.targetStatus) now applies ONLY when the file has
    // no Status column mapped at all, i.e. the user explicitly chose one status
    // for the whole import.
    let rowStatus = config.targetStatus;
    if (m.status) {
      const statusRaw = this.readCell(record, m.status);
      if (!statusRaw || !statusRaw.trim()) {
        throw new Error(
          `Status is required. Accepted: ${IMPORT_STATUS_OPTIONS.map((o) => o.label).join(', ')}`,
        );
      }
      const parsed = parseRowStatus(statusRaw);
      if (!parsed) {
        throw new Error(
          `Status "${statusRaw}" does not match a status in the app. ` +
            `Accepted: ${IMPORT_STATUS_OPTIONS.map((o) => o.label).join(', ')}`,
        );
      }
      rowStatus = parsed;
    }

    // ── References: MB / CS resolved from codes; BRANCH derived from them ──────
    const unresolved: UnresolvedRef[] = [];

    // Media buyer: per-row code wins. An unknown code HARD-FAILS the row (same as
    // an unknown product code) so the user fixes the code or the record instead of
    // the order silently importing unattributed. A blank cell is fine (optional).
    let mediaBuyerId: string | undefined = config.mediaBuyerId ?? undefined;
    const mbCodeRaw = m.mediaBuyerCode ? this.readCell(record, m.mediaBuyerCode) : undefined;
    if (mbCodeRaw) {
      const key = normalizeNumericCode(mbCodeRaw);
      const resolved = (key && maps.users.get(key)) || undefined;
      if (!resolved) throw new Error(`Unknown media buyer code "${mbCodeRaw}"`);
      mediaBuyerId = resolved;
    }

    // CS closer: same treatment — unknown code hard-fails the row.
    let assignedCsId: string | undefined = config.assignedCsId ?? undefined;
    const csCodeRaw = m.closerCode ? this.readCell(record, m.closerCode) : undefined;
    if (csCodeRaw) {
      const key = normalizeNumericCode(csCodeRaw);
      const resolved = (key && maps.users.get(key)) || undefined;
      if (!resolved) throw new Error(`Unknown CS code "${csCodeRaw}"`);
      assignedCsId = resolved;
    }

    // Branch derivation. Branch is NEVER supplied on the sheet — it is always
    // derived from the order's people. Precedence:
    //   1. the media buyer's primary branch
    //   2. the CS closer's primary branch
    //   3. the company's fallback (first) branch — and in THIS case the order is
    //      left unattributed (System), because we couldn't tie it to a real user.
    // Every order must have a branch; if even the fallback is missing, hard-fail.
    let branchId: string | undefined;
    if (mediaBuyerId) branchId = maps.userPrimaryBranch.get(mediaBuyerId);
    if (!branchId && assignedCsId) branchId = maps.userPrimaryBranch.get(assignedCsId);
    if (!branchId) {
      // Fallback to the company's first branch, unattributed (System).
      branchId = maps.fallbackBranchId ?? config.branchId ?? undefined;
      if (branchId) {
        mediaBuyerId = undefined; // assign to System when branch couldn't be user-derived
      }
    }
    if (!branchId) {
      throw new Error('No branch could be derived (no user branch and company has no branches)');
    }

    // ── Currency (multi-country): stamps orders.currency_code. Precedence:
    //   1. explicit currency column (code or country name) — HARD error if it's
    //      not an active currency in this company (never stamp a bad currency).
    //   2. the media buyer's assigned country, if unambiguous (exactly one).
    //   3. the CS closer's assigned country, if unambiguous.
    //   4. the country selected in the top-bar switcher at import time.
    //   5. the company's base currency.
    // Single-currency installs: the column is absent and users map to base, so
    // this resolves to base and behaves exactly as before.
    let currencyCode: string | undefined;
    const currencyRaw = m.currency ? this.readCell(record, m.currency) : undefined;
    if (currencyRaw) {
      const resolved = maps.currencyByKey.get(currencyRaw.toUpperCase());
      if (!resolved) {
        throw new Error(`Unknown or inactive currency "${currencyRaw}"`);
      }
      currencyCode = resolved;
    }
    if (!currencyCode && mediaBuyerId) {
      const mbCur = maps.userCurrencies.get(mediaBuyerId);
      if (mbCur && mbCur.length === 1) currencyCode = mbCur[0];
    }
    if (!currencyCode && assignedCsId) {
      const csCur = maps.userCurrencies.get(assignedCsId);
      if (csCur && csCur.length === 1) currencyCode = csCur[0];
    }
    // Default un-specified rows to the country selected in the top-bar switcher
    // at import time, so a Nigeria-scoped import stamps NGN (not base).
    if (!currencyCode && config.selectedCurrencyCode) {
      currencyCode = config.selectedCurrencyCode.toUpperCase();
    }
    if (!currencyCode) currencyCode = maps.baseCurrencyCode;

    // Country scope (hard gate): the caller may only import into countries they
    // are permitted to see. A row whose resolved currency falls outside
    // `allowedCurrencyCodes` HARD-FAILS — an import can never write an order
    // outside the creator's country permission. `null` = all-countries caller.
    const allowed = config.allowedCurrencyCodes;
    if (allowed && allowed.length > 0 && !allowed.includes(currencyCode)) {
      throw new Error(
        `Currency "${currencyCode}" is outside your country scope (${allowed.join(', ')})`,
      );
    }

    return {
      input: {
        customerName,
        customerPhone,
        customerAddress: m.customerAddress ? this.readCell(record, m.customerAddress) : undefined,
        deliveryState: m.deliveryState ? this.readCell(record, m.deliveryState) : undefined,
        items: [{ productId, quantity, unitPrice, offerLabel }],
        totalAmount,
        targetStatus: rowStatus,
        createdAtOverride,
        mediaBuyerId,
        assignedCsId,
        branchId,
        currencyCode,
        importExternalId: externalId,
        // Content fingerprint, so a re-import whose Order IDs changed still
        // matches this order instead of creating a second one.
        importIdentityKey: buildImportIdentityKey({
          phone: customerPhone,
          productId,
          createdAtOverride,
        }),
      },
      unresolved,
    };
  }

  // ── Progress persistence ────────────────────────────────────────────────────

  private async persistProgress(
    jobId: string,
    args: {
      status: ImportJobStatus;
      cursor: number;
      addProcessed: number;
      addFailed: number;
      errorLog: ImportRowFailure[];
      totalRows?: number;
      lastError?: string;
      finished?: boolean;
    },
  ): Promise<void> {
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.importJobs)
        .set({
          status: args.status,
          cursor: args.cursor,
          processedRows: sql`${schema.importJobs.processedRows} + ${args.addProcessed}`,
          failedRows: sql`${schema.importJobs.failedRows} + ${args.addFailed}`,
          errorLog: args.errorLog,
          ...(args.totalRows != null ? { totalRows: args.totalRows } : {}),
          ...(args.lastError != null ? { lastError: args.lastError } : {}),
          ...(args.finished ? { finishedAt: sql`now()` } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(schema.importJobs.id, jobId));
    });
  }

  private async markFailed(jobId: string, reason: string): Promise<void> {
    this.logger.error(`Job ${jobId} FAILED: ${reason}`);
    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx
        .update(schema.importJobs)
        .set({
          status: 'FAILED',
          lastError: reason,
          // A job that dies while a pause was pending must not keep reporting
          // "Pausing…" — the request can never be honoured now.
          pauseRequested: false,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.importJobs.id, jobId));
    });
  }
}
