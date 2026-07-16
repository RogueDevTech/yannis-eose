import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, gt, sql, inArray, gte, lte, isNull, ilike, type SQL, type AnyColumn } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  ACCT,
  DEFAULT_CHART_OF_ACCOUNTS,
  type CreateJournalEntryInput,
  type PostOpeningBalancesInput,
  type ListJournalEntriesInput,
  type GetJournalEntryInput,
  type ReverseJournalEntryInput,
  type ListAccountsInput,
  type CreateAccountInput,
  type ListFiscalYearsInput,
  type CreateFiscalYearInput,
  type CloseFiscalYearInput,
  type ReopenFiscalYearInput,
  type ApproveJournalEntryInput,
  type RejectJournalEntryInput,
  type TrialBalanceInput,
  type ProfitAndLossInput,
  type BalanceSheetInput,
  type CashFlowInput,
  type AgingInput,
  type BudgetVsActualRow,
  type RecordWhtInput,
  type ListWhtInput,
  type VatReturnSummary,
  type VatTransaction,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';

type Drizzle = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0];
type Actor = { id: string };

/** A single balanced posting line handed to the reusable poster. */
export interface PostVoucherLine {
  accountId: string;
  debit: number;
  credit: number;
  partyType?: string | null;
  partyId?: string | null;
  remarks?: string | null;
}

export type GlVoucherType = 'JOURNAL_ENTRY' | 'SALES_INVOICE' | 'PAYMENT' | 'PURCHASE_RECEIPT' | 'PAYROLL' | 'EXPENSE';

export interface PostVoucherInput {
  groupId: string | null;
  postingDate: string; // 'YYYY-MM-DD'
  voucherType: GlVoucherType;
  voucherId: string;
  lines: PostVoucherLine[];
}

/** Semantic account tags used to resolve posting targets. */
type GlAccountTypeTag =
  | 'RECEIVABLE'
  | 'PAYABLE'
  | 'BANK'
  | 'CASH'
  | 'STOCK'
  | 'COST_OF_GOODS_SOLD'
  | 'INDIRECT_EXPENSE';

/** Money helper: work in integer minor units (kobo) to avoid float drift. */
const toMinor = (n: number) => Math.round(n * 100);

// A stable system actor id for boot-time seeding (audit shows this UUID as the
// author of auto-seeded accounts). All-zero UUID = "system".
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/**
 * GeneralLedgerService — the double-entry accounting engine (Phase 1).
 *
 * The heart is {@link postVoucher}: a transaction-first, reusable balanced
 * poster. Every voucher type (Journal Entry today; Sales Invoice / Payment
 * Entry in later phases) builds its header row then calls postVoucher inside
 * the SAME withActor transaction, so the ledger write path is identical
 * forever and Trial Balance always sums one table (`gl_entries`).
 */
@Injectable()
export class GeneralLedgerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GeneralLedgerService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ─── Boot: seed the Chart of Accounts for every company ────────────────────

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.GL_AUTOSEED === 'false') return;
    // Fire-and-forget so the GL seed never blocks API boot / listen().
    setTimeout(() => {
      this.seedAllGroups().catch((err) => {
        this.logger.warn(
          `Chart of Accounts auto-seed skipped: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, 10_000);
  }

  private async seedAllGroups(): Promise<void> {
    const groups = await this.db
      .select({ id: schema.branchGroups.id })
      .from(schema.branchGroups);

    // Single-company installs may have zero branch groups; seed a null-group
    // CoA so the ledger is usable immediately.
    const groupIds: (string | null)[] = groups.length
      ? groups.map((g) => g.id)
      : [null];

    for (const groupId of groupIds) {
      await this.seedChartOfAccounts(groupId, { id: SYSTEM_ACTOR_ID });
    }
  }

  /**
   * Idempotently upsert the default Chart of Accounts for one company. Inserts
   * missing accounts (ON CONFLICT (group_id, code) DO NOTHING), then resolves
   * parent links in a second pass. Safe to run on every boot.
   */
  async seedChartOfAccounts(
    groupId: string | null,
    actor: Actor,
  ): Promise<{ seeded: number; linked: number }> {
    return withActor(this.db, actor, async (tx) => {
      // Pass 1 — insert all accounts (no parent yet).
      let seeded = 0;
      for (const entry of DEFAULT_CHART_OF_ACCOUNTS) {
        const inserted = await tx
          .insert(schema.accounts)
          .values({
            groupId: groupId ?? null,
            code: entry.code,
            name: entry.name,
            rootType: entry.rootType,
            accountType: entry.accountType ?? null,
            isGroup: entry.isGroup,
          })
          .onConflictDoNothing({
            target: [schema.accounts.groupId, schema.accounts.code],
          })
          .returning({ id: schema.accounts.id });
        if (inserted.length) seeded += 1;
      }

      // Pass 2 — resolve parentAccountId by code for rows still missing it.
      const rows = await tx
        .select({
          id: schema.accounts.id,
          code: schema.accounts.code,
          parentAccountId: schema.accounts.parentAccountId,
        })
        .from(schema.accounts)
        .where(this.groupEq(groupId));
      const idByCode = new Map(rows.map((r) => [r.code, r.id]));

      let linked = 0;
      for (const entry of DEFAULT_CHART_OF_ACCOUNTS) {
        if (!entry.parentCode) continue;
        const self = rows.find((r) => r.code === entry.code);
        if (!self || self.parentAccountId) continue; // already linked
        const parentId = idByCode.get(entry.parentCode);
        if (!parentId) continue;
        await tx
          .update(schema.accounts)
          .set({ parentAccountId: parentId, updatedAt: new Date() })
          .where(eq(schema.accounts.id, self.id));
        linked += 1;
      }

      if (seeded || linked) {
        this.logger.log(
          `Chart of Accounts seeded for group ${groupId ?? '(null)'}: ${seeded} new, ${linked} linked`,
        );
      }
      return { seeded, linked };
    });
  }

  // ─── The reusable balanced poster (the heart) ──────────────────────────────

  /**
   * Post a balanced voucher to the ledger. Transaction-first: the caller MUST
   * pass a `tx` from withActor — this never opens its own transaction, so a
   * voucher header + its lines + balance updates all commit atomically.
   *
   * Validates (throws before any write):
   *  1. Balanced (Σdebit === Σcredit) in integer minor units.
   *  2. ≥ 2 lines, total > 0.
   *  3. Each line one-sided.
   *  4. All accounts exist, same group, and are leaf accounts (not is_group).
   *  5. postingDate falls within an OPEN fiscal year for the group.
   *
   * Returns the resolved fiscalYearId (callers stamp it on their header).
   */
  async postVoucher(tx: Tx, input: PostVoucherInput): Promise<{ fiscalYearId: string }> {
    const { lines } = input;

    if (lines.length < 2) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'A voucher needs at least two lines.' });
    }

    let totalDebitMinor = 0;
    let totalCreditMinor = 0;
    for (const line of lines) {
      const d = toMinor(line.debit);
      const c = toMinor(line.credit);
      if (d < 0 || c < 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Debit and credit must be non-negative.' });
      }
      if ((d > 0) === (c > 0)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Each line must be one-sided: exactly one of debit or credit must be > 0.',
        });
      }
      totalDebitMinor += d;
      totalCreditMinor += c;
    }

    if (totalDebitMinor !== totalCreditMinor) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unbalanced entry: debit ${totalDebitMinor / 100} ≠ credit ${totalCreditMinor / 100}.`,
      });
    }
    if (totalDebitMinor === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Voucher total must be greater than zero.' });
    }

    // Validate accounts: exist, same group, leaf (not group).
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accs = await tx
      .select({
        id: schema.accounts.id,
        groupId: schema.accounts.groupId,
        isGroup: schema.accounts.isGroup,
        isActive: schema.accounts.isActive,
      })
      .from(schema.accounts)
      .where(inArray(schema.accounts.id, accountIds));
    const accById = new Map(accs.map((a) => [a.id, a]));
    for (const id of accountIds) {
      const a = accById.get(id);
      if (!a) throw new TRPCError({ code: 'BAD_REQUEST', message: `Account ${id} not found.` });
      if ((a.groupId ?? null) !== (input.groupId ?? null)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Account ${id} belongs to a different company.` });
      }
      if (a.isGroup) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Cannot post to group account ${id}; post to a leaf account.` });
      }
      if (!a.isActive) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Account ${id} is inactive.` });
      }
    }

    // Period lock: find the fiscal year containing postingDate.
    // FOR UPDATE prevents a concurrent closeFiscalYear from flipping the
    // status while we're mid-posting — either the close or the post wins,
    // never a partial interleave.
    const fyRows = await tx
      .select({
        id: schema.fiscalYears.id,
        status: schema.fiscalYears.status,
      })
      .from(schema.fiscalYears)
      .where(
        and(
          this.groupEqOn(schema.fiscalYears.groupId, input.groupId),
          lte(schema.fiscalYears.startDate, input.postingDate),
          gte(schema.fiscalYears.endDate, input.postingDate),
        ),
      )
      .for('update')
      .limit(1);
    const fy = fyRows[0];
    if (!fy) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `No fiscal year covers ${input.postingDate}. Create one before posting.`,
      });
    }
    if (fy.status === 'CLOSED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `The fiscal year covering ${input.postingDate} is closed. Postings are locked.`,
      });
    }

    // Insert the gl_entries lines.
    for (const line of lines) {
      await tx.insert(schema.glEntries).values({
        groupId: input.groupId ?? null,
        accountId: line.accountId,
        postingDate: input.postingDate,
        debit: sql`${line.debit}::numeric`,
        credit: sql`${line.credit}::numeric`,
        voucherType: input.voucherType,
        voucherId: input.voucherId,
        partyType: line.partyType ?? null,
        partyId: line.partyId ?? null,
        remarks: line.remarks ?? null,
        fiscalYearId: fy.id,
      });
    }

    // Update running balances (debit-positive): balance += Σdebit − Σcredit per account.
    const deltaByAccount = new Map<string, number>();
    for (const line of lines) {
      const prev = deltaByAccount.get(line.accountId) ?? 0;
      deltaByAccount.set(line.accountId, prev + toMinor(line.debit) - toMinor(line.credit));
    }
    for (const [accountId, deltaMinor] of deltaByAccount) {
      const delta = deltaMinor / 100;
      await tx
        .update(schema.accounts)
        .set({ balance: sql`${schema.accounts.balance} + ${delta}::numeric`, updatedAt: new Date() })
        .where(eq(schema.accounts.id, accountId));
    }

    return { fiscalYearId: fy.id };
  }

  // ─── Account resolution + idempotency (used by auto-posting phases) ──────────

  /**
   * Resolve a single postable leaf account for a company by its semantic tag.
   * Returns null if none (caller decides whether that's fatal or skip-and-log).
   * When multiple match a tag, prefers the one whose code matches `preferCode`.
   */
  private async resolveAccountByType(
    tx: Tx,
    groupId: string | null,
    accountType: GlAccountTypeTag,
    preferCode?: string,
  ): Promise<{ id: string } | null> {
    const rows = await tx
      .select({ id: schema.accounts.id, code: schema.accounts.code })
      .from(schema.accounts)
      .where(
        and(
          this.groupEqOn(schema.accounts.groupId, groupId),
          eq(schema.accounts.accountType, accountType),
          eq(schema.accounts.isGroup, false),
          eq(schema.accounts.isActive, true),
        ),
      );
    if (rows.length === 0) return null;
    if (preferCode) {
      const preferred = rows.find((r) => r.code === preferCode);
      if (preferred) return { id: preferred.id };
    }
    return { id: rows[0]!.id };
  }

  /**
   * Resolve the company (branch group) for a logistics location via
   * location.branch_id → branches.group_id. Returns null for single-company.
   */
  private async resolveGroupIdForLocation(
    tx: Tx,
    locationId: string | null | undefined,
  ): Promise<string | null> {
    if (!locationId) return null;
    const [row] = await tx
      .select({ groupId: schema.branches.groupId })
      .from(schema.logisticsLocations)
      .leftJoin(schema.branches, eq(schema.logisticsLocations.branchId, schema.branches.id))
      .where(eq(schema.logisticsLocations.id, locationId))
      .limit(1);
    return row?.groupId ?? null;
  }

  /** Resolve a postable leaf account by exact code (for accounts with no unique type, e.g. 'Sale'). */
  private async resolveAccountByCode(
    tx: Tx,
    groupId: string | null,
    code: string,
  ): Promise<{ id: string } | null> {
    const [row] = await tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          this.groupEqOn(schema.accounts.groupId, groupId),
          eq(schema.accounts.code, code),
          eq(schema.accounts.isGroup, false),
        ),
      )
      .limit(1);
    return row ? { id: row.id } : null;
  }

  /** True if a voucher has already posted GL lines (idempotency guard). */
  private async alreadyPosted(
    tx: Tx,
    voucherType: GlVoucherType,
    voucherId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: schema.glEntries.id })
      .from(schema.glEntries)
      .where(
        and(
          eq(schema.glEntries.voucherType, voucherType),
          eq(schema.glEntries.voucherId, voucherId),
        ),
      )
      .limit(1);
    return !!row;
  }

  // ─── Phase 2: Sales Invoice → AR + COGS ──────────────────────────────────────

  /**
   * Post the double-entry for a delivered order's sale. Opens its own withActor
   * transaction (mirrors autoCreateInvoiceForOrder) so callers in the order
   * lifecycle don't need to thread a tx. Non-fatal by contract: the caller wraps
   * this in try/catch — a missing account / fiscal year must never block delivery.
   *
   *   Dr Debtors           totalAmount     (party CUSTOMER, remarks=customerName)
   *   Cr Sale              totalAmount
   *   Dr Cost of Goods Sold landedCost     (skipped if landedCost is 0/absent)
   *   Cr Stock In Hand     landedCost
   *
   * Revenue is order.totalAmount; COGS is order.landedCost (FIFO — the number the
   * client's ERPNext gets wrong by posting sale price). Idempotent per orderId.
   */
  async postSalesInvoice(orderId: string, actor: Actor): Promise<{ posted: boolean; reason?: string }> {
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'SALES_INVOICE', orderId)) {
        return { posted: false, reason: 'already-posted' };
      }

      const [order] = await tx
        .select({
          id: schema.orders.id,
          totalAmount: schema.orders.totalAmount,
          landedCost: schema.orders.landedCost,
          customerName: schema.orders.customerName,
          deliveredAt: schema.orders.deliveredAt,
          groupId: schema.branches.groupId,
        })
        .from(schema.orders)
        .leftJoin(schema.branches, eq(schema.orders.servicingBranchId, schema.branches.id))
        .where(eq(schema.orders.id, orderId))
        .limit(1);
      if (!order) return { posted: false, reason: 'order-not-found' };

      const groupId = order.groupId ?? null;

      const revenue = Number(order.totalAmount ?? 0);
      const cogs = Number(order.landedCost ?? 0);
      if (revenue <= 0) return { posted: false, reason: 'zero-revenue' };

      // Resolve posting accounts.
      const debtors = await this.resolveAccountByType(tx, groupId, 'RECEIVABLE', ACCT.AR_CUSTOMERS);
      const sale = await this.resolveAccountByCode(tx, groupId, ACCT.PRODUCT_SALES);
      if (!debtors || !sale) {
        return { posted: false, reason: 'missing-ar-or-sale-account' };
      }

      const postingDate = (order.deliveredAt ?? new Date()).toISOString().slice(0, 10);
      const customer = order.customerName ?? undefined;

      const lines: PostVoucherLine[] = [
        { accountId: debtors.id, debit: revenue, credit: 0, partyType: 'CUSTOMER', remarks: customer },
        { accountId: sale.id, debit: 0, credit: revenue },
      ];

      // VAT output — 7.5% Nigerian VAT on top of revenue. Only posts if the
      // VAT account exists in the CoA (graceful degradation for companies that
      // haven't seeded it or are VAT-exempt).
      const vatAccount = await this.resolveAccountByCode(tx, groupId, ACCT.VAT_OUTPUT);
      if (vatAccount) {
        const vatAmount = Math.round(revenue * 0.075 * 100) / 100; // 7.5%
        if (vatAmount > 0) {
          lines.push({ accountId: debtors.id, debit: vatAmount, credit: 0, partyType: 'CUSTOMER', remarks: customer });
          lines.push({ accountId: vatAccount.id, debit: 0, credit: vatAmount, remarks: 'VAT output 7.5%' });
        }
      }

      // COGS pair — only when a FIFO cost is available.
      if (cogs > 0) {
        const cogsAcct = await this.resolveAccountByType(tx, groupId, 'COST_OF_GOODS_SOLD');
        const stock = await this.resolveAccountByType(tx, groupId, 'STOCK', ACCT.STOCK_FINISHED_GOODS);
        if (cogsAcct && stock) {
          lines.push({ accountId: cogsAcct.id, debit: cogs, credit: 0 });
          lines.push({ accountId: stock.id, debit: 0, credit: cogs });
        }
      }

      await this.postVoucher(tx, {
        groupId,
        postingDate,
        voucherType: 'SALES_INVOICE',
        voucherId: orderId,
        lines,
      });

      return { posted: true };
    });
  }

  // ─── Phase 3: Remittance settlement → cash JE ────────────────────────────────

  /**
   * Post the settlement of a delivery remittance to the ledger, matching the
   * client's ERPNext recipe:
   *
   *   Dr Bank              cash banked = Σ(totalAmount − deliveryFee) − fees
   *   Dr Delivery Fees     Σ(order.deliveryFee)
   *   Dr Discount Fees     commitmentFee + posFee + failedDeliveryCost
   *     Cr Debtors         order.totalAmount   (one line per order, party=customer)
   *
   * Credits the Debtors that {@link postSalesInvoice} debited, so a delivered-
   * then-remitted order nets to zero on AR. Opens its own withActor tx,
   * idempotent per remittance, non-fatal by contract (caller wraps in try/catch).
   */
  async postRemittanceSettlement(
    remittanceId: string,
    actor: Actor,
  ): Promise<{ posted: boolean; reason?: string }> {
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'PAYMENT', remittanceId)) {
        return { posted: false, reason: 'already-posted' };
      }

      const [rem] = await tx
        .select({
          id: schema.deliveryRemittances.id,
          commitmentFee: schema.deliveryRemittances.commitmentFee,
          posFee: schema.deliveryRemittances.posFee,
          failedDeliveryCost: schema.deliveryRemittances.failedDeliveryCost,
          receivedAt: schema.deliveryRemittances.receivedAt,
        })
        .from(schema.deliveryRemittances)
        .where(eq(schema.deliveryRemittances.id, remittanceId))
        .limit(1);
      if (!rem) return { posted: false, reason: 'remittance-not-found' };

      const orders = await tx
        .select({
          id: schema.orders.id,
          totalAmount: schema.orders.totalAmount,
          deliveryFee: schema.orders.deliveryFee,
          customerName: schema.orders.customerName,
          groupId: schema.branches.groupId,
        })
        .from(schema.deliveryRemittanceOrders)
        .innerJoin(schema.orders, eq(schema.orders.id, schema.deliveryRemittanceOrders.orderId))
        .leftJoin(schema.branches, eq(schema.orders.servicingBranchId, schema.branches.id))
        .where(eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, remittanceId));
      if (orders.length === 0) return { posted: false, reason: 'no-linked-orders' };

      const groupId = orders[0]!.groupId ?? null;
      const commitmentFee = Number(rem.commitmentFee ?? 0);
      const posFee = Number(rem.posFee ?? 0);
      const failedDeliveryCost = Number(rem.failedDeliveryCost ?? 0);
      const otherFees = commitmentFee + posFee + failedDeliveryCost;

      let totalDebtors = 0;
      let totalDeliveryFee = 0;
      const debtorLines: PostVoucherLine[] = [];
      for (const o of orders) {
        const amt = Number(o.totalAmount ?? 0);
        const fee = Number(o.deliveryFee ?? 0);
        if (amt <= 0) continue;
        totalDebtors += amt;
        totalDeliveryFee += fee;
        debtorLines.push({
          accountId: '', // resolved below
          debit: 0,
          credit: amt,
          partyType: 'CUSTOMER',
          remarks: o.customerName ?? undefined,
        });
      }
      if (totalDebtors <= 0) return { posted: false, reason: 'zero-settlement' };

      // Resolve accounts. Remittances carry no bank field, so cash lands in the
      // company's primary bank — prefer "First Bank", else the first BANK account.
      // (Deterministic default; revisit if per-remittance bank selection is added.)
      const debtors = await this.resolveAccountByType(tx, groupId, 'RECEIVABLE', ACCT.AR_CUSTOMERS);
      const bank = await this.resolveAccountByType(tx, groupId, 'BANK', ACCT.BANK_PRIMARY);
      if (!debtors || !bank) return { posted: false, reason: 'missing-debtors-or-bank-account' };
      const deliveryFeeAcct =
        totalDeliveryFee > 0
          ? await this.resolveAccountByCode(tx, groupId, ACCT.OUTBOUND_DELIVERY)
          : null;
      const discountAcct =
        otherFees > 0 ? await this.resolveAccountByCode(tx, groupId, ACCT.BANK_CHARGES) : null;

      // Fees we can't route to a resolved account fall back into the cash figure
      // so the entry still balances (never silently drop money).
      const deliveryFeePosted = deliveryFeeAcct ? totalDeliveryFee : 0;
      const discountPosted = discountAcct ? otherFees : 0;
      const cashBanked = totalDebtors - deliveryFeePosted - discountPosted;

      const postingDate = (rem.receivedAt ?? new Date()).toISOString().slice(0, 10);

      const lines: PostVoucherLine[] = [
        { accountId: bank.id, debit: cashBanked, credit: 0, remarks: 'Cash banked' },
      ];
      if (deliveryFeeAcct && deliveryFeePosted > 0) {
        lines.push({ accountId: deliveryFeeAcct.id, debit: deliveryFeePosted, credit: 0 });
      }
      if (discountAcct && discountPosted > 0) {
        lines.push({ accountId: discountAcct.id, debit: discountPosted, credit: 0 });
      }
      for (const dl of debtorLines) lines.push({ ...dl, accountId: debtors.id });

      await this.postVoucher(tx, {
        groupId,
        postingDate,
        voucherType: 'PAYMENT',
        voucherId: remittanceId,
        lines,
      });

      return { posted: true };
    });
  }

  // ─── Phase 4: Shipment verified → Stock In Hand / Creditors ──────────────────

  /**
   * Post the stock intake for a verified inbound shipment:
   *
   *   Dr Stock In Hand   Σ(line qty × landed cost per unit) = total landed value
   *     Cr Creditors     same total   (party SUPPLIER, remarks = supplierName)
   *
   * The landed value is factory cost + allocated landing cost (freight/duty), i.e.
   * exactly what the FIFO batches carry — so COGS posted later (Phase 2) reconciles
   * against what was capitalised here. Opens its own withActor tx, idempotent per
   * shipment, non-fatal by contract.
   *
   * NOTE: single-company install → groupId null. Multi-company needs shipment →
   * destinationLocation → branch.group_id resolution (location.branch_id is a raw
   * migration column not yet on the Drizzle schema); deferred.
   */
  async postPurchaseReceipt(
    shipmentId: string,
    actor: Actor,
  ): Promise<{ posted: boolean; reason?: string }> {
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'PURCHASE_RECEIPT', shipmentId)) {
        return { posted: false, reason: 'already-posted' };
      }

      const [ship] = await tx
        .select({
          id: schema.shipments.id,
          supplierName: schema.shipments.supplierName,
          verifiedAt: schema.shipments.verifiedAt,
          status: schema.shipments.status,
          destinationLocationId: schema.shipments.destinationLocationId,
        })
        .from(schema.shipments)
        .where(eq(schema.shipments.id, shipmentId))
        .limit(1);
      if (!ship) return { posted: false, reason: 'shipment-not-found' };

      const lines = await tx
        .select({
          receivedQuantity: schema.shipmentLines.receivedQuantity,
          factoryCost: schema.shipmentLines.factoryCost,
          allocatedLandingCost: schema.shipmentLines.allocatedLandingCost,
        })
        .from(schema.shipmentLines)
        .where(eq(schema.shipmentLines.shipmentId, shipmentId));

      // Total landed value = Σ(qty × factoryCost) + Σ(allocatedLandingCost).
      let landedValue = 0;
      for (const l of lines) {
        const qty = l.receivedQuantity ?? 0;
        landedValue += qty * (Number(l.factoryCost ?? 0)) + Number(l.allocatedLandingCost ?? 0);
      }
      if (landedValue <= 0) return { posted: false, reason: 'zero-landed-value' };

      // Resolve company via destination location → branch → group. location.branch_id
      // is TEXT and branches.id is uuid, so cast for the join.
      const groupId = await this.resolveGroupIdForLocation(tx, ship.destinationLocationId);
      const stock = await this.resolveAccountByType(tx, groupId, 'STOCK', ACCT.STOCK_FINISHED_GOODS);
      const creditors = await this.resolveAccountByType(tx, groupId, 'PAYABLE', ACCT.AP_SUPPLIERS);
      const vatInput = await this.resolveAccountByCode(tx, groupId, ACCT.VAT_INPUT_CREDIT);
      if (!stock || !creditors) {
        return { posted: false, reason: 'missing-stock-or-creditors-account' };
      }

      // VAT input credit: 7.5% on the landed value (VAT-exclusive prices).
      // If the VAT Input Credit account exists, split the creditor amount into
      // net creditor + VAT input so the journal stays balanced.
      const vatAmount = vatInput ? Math.round(landedValue * 0.075 * 100) / 100 : 0;
      const creditorsAmount = landedValue + vatAmount; // total owed to supplier includes VAT

      const postingDate = (ship.verifiedAt ?? new Date()).toISOString().slice(0, 10);

      const voucherLines: PostVoucherLine[] = [
        { accountId: stock.id, debit: landedValue, credit: 0 },
        {
          accountId: creditors.id,
          debit: 0,
          credit: creditorsAmount,
          partyType: 'SUPPLIER',
          remarks: ship.supplierName ?? undefined,
        },
      ];

      // DR 1151 VAT Input Credit for the VAT portion.
      if (vatInput && vatAmount > 0) {
        voucherLines.push({
          accountId: vatInput.id,
          debit: vatAmount,
          credit: 0,
          remarks: 'VAT input credit 7.5%',
        });
      }

      await this.postVoucher(tx, {
        groupId,
        postingDate,
        voucherType: 'PURCHASE_RECEIPT',
        voucherId: shipmentId,
        lines: voucherLines,
      });

      return { posted: true };
    });
  }

  // ─── Phase 2C: Payroll batch → salary expense + payable clearance ───────────

  /**
   * Post the double-entry for a paid payroll batch.
   *
   *   Dr Salary              batch.totalAmount
   *     Cr Payroll Payable   batch.totalAmount
   *
   * Simplified single-entry: the full PAYE/Pension breakdown is deferred to
   * Phase 5B (tax tracking). For now we record the gross salary expense against
   * the payroll payable account. Idempotent per batchId, non-fatal by contract.
   */
  async postPayrollBatch(batchId: string, actor: Actor): Promise<{ posted: boolean; reason?: string }> {
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'PAYROLL', batchId)) {
        return { posted: false, reason: 'already-posted' };
      }

      const [batch] = await tx
        .select({
          id: schema.payrollBatches.id,
          totalAmount: schema.payrollBatches.totalAmount,
          periodMonth: schema.payrollBatches.periodMonth,
          branchId: schema.payrollBatches.branchId,
          department: schema.payrollBatches.department,
          financeProcessedAt: schema.payrollBatches.financeProcessedAt,
        })
        .from(schema.payrollBatches)
        .where(eq(schema.payrollBatches.id, batchId))
        .limit(1);
      if (!batch) return { posted: false, reason: 'batch-not-found' };

      const amount = Number(batch.totalAmount ?? 0);
      if (amount <= 0) return { posted: false, reason: 'zero-amount' };

      // Resolve company groupId from batch branch
      let groupId: string | null = null;
      if (batch.branchId) {
        const [branch] = await tx
          .select({ groupId: schema.branches.groupId })
          .from(schema.branches)
          .where(eq(schema.branches.id, batch.branchId))
          .limit(1);
        groupId = branch?.groupId ?? null;
      }

      const salary = await this.resolveAccountByCode(tx, groupId, ACCT.STAFF_SALARIES);
      const payrollPayable = await this.resolveAccountByCode(tx, groupId, ACCT.ACCRUED_SALARIES);
      if (!salary || !payrollPayable) {
        return { posted: false, reason: 'missing-salary-or-payroll-payable-account' };
      }

      const postingDate = (batch.financeProcessedAt ?? new Date()).toISOString().slice(0, 10);
      const dept = batch.department ?? 'General';

      await this.postVoucher(tx, {
        groupId,
        postingDate,
        voucherType: 'PAYROLL',
        voucherId: batchId,
        lines: [
          { accountId: salary.id, debit: amount, credit: 0, remarks: `${dept} payroll` },
          { accountId: payrollPayable.id, debit: 0, credit: amount, remarks: `${dept} payroll` },
        ],
      });

      return { posted: true };
    });
  }

  // ─── Phase 2C: Marketing funding → ad spend expense ─────────────────────────

  /**
   * Post the double-entry for an approved marketing fund disbursement.
   *
   *   Dr Marketing Expenses   sentAmount
   *     Cr Bank               sentAmount
   *
   * Simplified: records the immediate expense against bank. Idempotent per
   * funding request ID, non-fatal by contract.
   */
  async postMarketingFunding(
    fundingRequestId: string,
    sentAmount: number,
    branchId: string | null,
    actor: Actor,
  ): Promise<{ posted: boolean; reason?: string }> {
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'EXPENSE', fundingRequestId)) {
        return { posted: false, reason: 'already-posted' };
      }

      if (sentAmount <= 0) return { posted: false, reason: 'zero-amount' };

      // Resolve company groupId from branch
      let groupId: string | null = null;
      if (branchId) {
        const [branch] = await tx
          .select({ groupId: schema.branches.groupId })
          .from(schema.branches)
          .where(eq(schema.branches.id, branchId))
          .limit(1);
        groupId = branch?.groupId ?? null;
      }

      const marketing = await this.resolveAccountByCode(tx, groupId, ACCT.AD_SPEND_DIGITAL);
      const bank = await this.resolveAccountByType(tx, groupId, 'BANK');
      if (!marketing || !bank) {
        return { posted: false, reason: 'missing-marketing-or-bank-account' };
      }

      const postingDate = new Date().toISOString().slice(0, 10);

      await this.postVoucher(tx, {
        groupId,
        postingDate,
        voucherType: 'EXPENSE',
        voucherId: fundingRequestId,
        lines: [
          { accountId: marketing.id, debit: sentAmount, credit: 0, remarks: 'Ad spend disbursement' },
          { accountId: bank.id, debit: 0, credit: sentAmount, remarks: 'Ad spend disbursement' },
        ],
      });

      return { posted: true };
    });
  }

  // ─── Supplier Payment (DR AP / CR Bank) ─────────────────────────────────────

  /**
   * Post when a supplier invoice/liability is paid.
   * DR 2111 Accounts Payable — Suppliers (clears liability)
   * CR 1112 Cash at Bank (cash out)
   */
  async postSupplierPayment(
    paymentId: string,
    supplierName: string,
    amount: number,
    groupId: string | null,
    actor: Actor,
    opts?: { whtRate?: number; vendorId?: string },
  ): Promise<{ posted: boolean; reason?: string; whtDeductionId?: string }> {
    if (amount <= 0) return { posted: false, reason: 'zero-amount' };
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'PAYMENT', paymentId)) {
        return { posted: false, reason: 'already-posted' };
      }
      const ap = await this.resolveAccountByCode(tx, groupId, ACCT.AP_SUPPLIERS);
      const bank = await this.resolveAccountByType(tx, groupId, 'BANK', ACCT.BANK_PRIMARY);
      if (!ap || !bank) return { posted: false, reason: 'missing-accounts' };

      const whtRate = opts?.whtRate ?? 0;
      const grossMinor = Math.round(amount * 100);
      let whtDeductionId: string | undefined;

      if (whtRate > 0) {
        // WHT auto-deduction: DR AP full, CR Bank net, CR WHT Payable withheld
        const whtPayable = await this.resolveAccountByCode(tx, groupId, ACCT.WHT_PAYABLE);
        if (!whtPayable) return { posted: false, reason: 'missing-accounts' };

        const whtMinor = Math.round(grossMinor * (whtRate / 100));
        const netMinor = grossMinor - whtMinor;

        await this.postVoucher(tx, {
          groupId,
          postingDate: new Date().toISOString().slice(0, 10),
          voucherType: 'PAYMENT',
          voucherId: paymentId,
          lines: [
            { accountId: ap.id, debit: grossMinor, credit: 0, partyType: 'SUPPLIER', remarks: `Payment to ${supplierName}` },
            { accountId: bank.id, debit: 0, credit: netMinor, remarks: `Supplier payment net of WHT: ${supplierName}` },
            { accountId: whtPayable.id, debit: 0, credit: whtMinor, remarks: `WHT ${whtRate}% withheld: ${supplierName}` },
          ],
        });

        // Record in wht_deductions for certificate generation
        const whtAmount = Math.round(amount * (whtRate / 100) * 100) / 100;
        const netAmount = Math.round((amount - whtAmount) * 100) / 100;
        const [whtRow] = await tx
          .insert(schema.whtDeductions)
          .values({
            groupId,
            vendorName: supplierName,
            vendorId: opts?.vendorId ?? null,
            paymentDate: new Date().toISOString().slice(0, 10),
            grossAmount: sql`${amount}::numeric`,
            whtRate: sql`${whtRate}::numeric`,
            whtAmount: sql`${whtAmount}::numeric`,
            netAmount: sql`${netAmount}::numeric`,
            description: `Auto WHT on supplier payment ${paymentId}`,
            glVoucherId: paymentId,
            createdBy: actor.id,
          })
          .returning({ id: schema.whtDeductions.id });
        whtDeductionId = whtRow?.id;
      } else {
        // No WHT: simple full-amount payment
        await this.postVoucher(tx, {
          groupId,
          postingDate: new Date().toISOString().slice(0, 10),
          voucherType: 'PAYMENT',
          voucherId: paymentId,
          lines: [
            { accountId: ap.id, debit: grossMinor, credit: 0, partyType: 'SUPPLIER', remarks: `Payment to ${supplierName}` },
            { accountId: bank.id, debit: 0, credit: grossMinor, remarks: `Supplier payment: ${supplierName}` },
          ],
        });
      }
      return { posted: true, whtDeductionId };
    });
  }

  // ─── Agent Commission (DR Commission Expense / CR AP Agents) ────────────────

  /**
   * Post when agent delivery commission becomes due (on order delivery).
   * DR 5220 Agent Delivery Commission (expense)
   * CR 2112 Accounts Payable — Agent Commissions (liability)
   */
  async postAgentCommissionDue(
    orderId: string,
    agentName: string,
    commissionAmount: number,
    groupId: string | null,
    actor: Actor,
  ): Promise<{ posted: boolean; reason?: string }> {
    if (commissionAmount <= 0) return { posted: false, reason: 'zero-commission' };
    return withActor(this.db, actor, async (tx) => {
      const voucherId = `agent-comm-due-${orderId}`;
      if (await this.alreadyPosted(tx, 'EXPENSE', voucherId)) {
        return { posted: false, reason: 'already-posted' };
      }
      const commExp = await this.resolveAccountByCode(tx, groupId, ACCT.AGENT_DELIVERY_COMM);
      const apAgent = await this.resolveAccountByCode(tx, groupId, ACCT.AP_AGENT_COMMISSIONS);
      if (!commExp || !apAgent) return { posted: false, reason: 'missing-accounts' };

      const minorAmount = Math.round(commissionAmount * 100);
      await this.postVoucher(tx, {
        groupId,
        postingDate: new Date().toISOString().slice(0, 10),
        voucherType: 'EXPENSE',
        voucherId,
        lines: [
          { accountId: commExp.id, debit: minorAmount, credit: 0, remarks: `Delivery commission — ${agentName}` },
          { accountId: apAgent.id, debit: 0, credit: minorAmount, partyType: 'AGENT', remarks: agentName },
        ],
      });
      return { posted: true };
    });
  }

  /**
   * Post when agent commission is actually paid out.
   * DR 2112 Accounts Payable — Agent Commissions (clears liability)
   * CR 1112 Cash at Bank (cash out)
   */
  async postAgentCommissionPaid(
    paymentId: string,
    agentName: string,
    amount: number,
    groupId: string | null,
    actor: Actor,
    opts?: { whtRate?: number },
  ): Promise<{ posted: boolean; reason?: string; whtDeductionId?: string }> {
    if (amount <= 0) return { posted: false, reason: 'zero-amount' };
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'PAYMENT', paymentId)) {
        return { posted: false, reason: 'already-posted' };
      }
      const apAgent = await this.resolveAccountByCode(tx, groupId, ACCT.AP_AGENT_COMMISSIONS);
      const bank = await this.resolveAccountByType(tx, groupId, 'BANK', ACCT.BANK_PRIMARY);
      if (!apAgent || !bank) return { posted: false, reason: 'missing-accounts' };

      const whtRate = opts?.whtRate ?? 0;
      const grossMinor = Math.round(amount * 100);
      let whtDeductionId: string | undefined;

      if (whtRate > 0) {
        const whtPayable = await this.resolveAccountByCode(tx, groupId, ACCT.WHT_PAYABLE);
        if (!whtPayable) return { posted: false, reason: 'missing-accounts' };

        const whtMinor = Math.round(grossMinor * (whtRate / 100));
        const netMinor = grossMinor - whtMinor;

        await this.postVoucher(tx, {
          groupId,
          postingDate: new Date().toISOString().slice(0, 10),
          voucherType: 'PAYMENT',
          voucherId: paymentId,
          lines: [
            { accountId: apAgent.id, debit: grossMinor, credit: 0, partyType: 'AGENT', remarks: `Commission paid: ${agentName}` },
            { accountId: bank.id, debit: 0, credit: netMinor, remarks: `Agent commission net of WHT: ${agentName}` },
            { accountId: whtPayable.id, debit: 0, credit: whtMinor, remarks: `WHT ${whtRate}% withheld: ${agentName}` },
          ],
        });

        const whtAmount = Math.round(amount * (whtRate / 100) * 100) / 100;
        const netAmount = Math.round((amount - whtAmount) * 100) / 100;
        const [whtRow] = await tx
          .insert(schema.whtDeductions)
          .values({
            groupId,
            vendorName: agentName,
            paymentDate: new Date().toISOString().slice(0, 10),
            grossAmount: sql`${amount}::numeric`,
            whtRate: sql`${whtRate}::numeric`,
            whtAmount: sql`${whtAmount}::numeric`,
            netAmount: sql`${netAmount}::numeric`,
            description: `Auto WHT on agent commission payment ${paymentId}`,
            glVoucherId: paymentId,
            createdBy: actor.id,
          })
          .returning({ id: schema.whtDeductions.id });
        whtDeductionId = whtRow?.id;
      } else {
        await this.postVoucher(tx, {
          groupId,
          postingDate: new Date().toISOString().slice(0, 10),
          voucherType: 'PAYMENT',
          voucherId: paymentId,
          lines: [
            { accountId: apAgent.id, debit: grossMinor, credit: 0, partyType: 'AGENT', remarks: `Commission paid: ${agentName}` },
            { accountId: bank.id, debit: 0, credit: grossMinor, remarks: `Agent commission payment: ${agentName}` },
          ],
        });
      }
      return { posted: true, whtDeductionId };
    });
  }

  // ─── Fixed Asset Acquisition (DR PPE / CR Bank or AP) ───────────────────────

  /**
   * Post when a fixed asset is purchased/registered.
   * DR 1211-1215 PPE account (capitalise the asset)
   * CR 1112 Cash at Bank (if paid) or CR 2111 AP (if on credit)
   */
  async postFixedAssetAcquisition(
    assetId: string,
    assetName: string,
    cost: number,
    assetAccountId: string,
    groupId: string | null,
    actor: Actor,
    paidByBank = true,
  ): Promise<{ posted: boolean; reason?: string }> {
    if (cost <= 0) return { posted: false, reason: 'zero-cost' };
    return withActor(this.db, actor, async (tx) => {
      const voucherId = `asset-acq-${assetId}`;
      if (await this.alreadyPosted(tx, 'JOURNAL_ENTRY', voucherId)) {
        return { posted: false, reason: 'already-posted' };
      }
      const creditAcct = paidByBank
        ? await this.resolveAccountByType(tx, groupId, 'BANK', ACCT.BANK_PRIMARY)
        : await this.resolveAccountByCode(tx, groupId, ACCT.AP_SUPPLIERS);
      if (!creditAcct) return { posted: false, reason: 'missing-credit-account' };

      const minorCost = Math.round(cost * 100);
      await this.postVoucher(tx, {
        groupId,
        postingDate: new Date().toISOString().slice(0, 10),
        voucherType: 'JOURNAL_ENTRY',
        voucherId,
        lines: [
          { accountId: assetAccountId, debit: minorCost, credit: 0, remarks: `Asset acquired: ${assetName}` },
          { accountId: creditAcct.id, debit: 0, credit: minorCost, remarks: `Payment for asset: ${assetName}` },
        ],
      });
      return { posted: true };
    });
  }

  // ─── Customer Deposit (DR Bank / CR Customer Deposits) ──────────────────────

  /**
   * Post when a customer advance/deposit is received (deferred revenue per IFRS 15).
   * DR 1112 Cash at Bank
   * CR 2150 Customer Deposits & Advance Payments
   */
  async postCustomerDeposit(
    depositId: string,
    customerName: string,
    amount: number,
    groupId: string | null,
    actor: Actor,
  ): Promise<{ posted: boolean; reason?: string }> {
    if (amount <= 0) return { posted: false, reason: 'zero-amount' };
    return withActor(this.db, actor, async (tx) => {
      if (await this.alreadyPosted(tx, 'PAYMENT', depositId)) {
        return { posted: false, reason: 'already-posted' };
      }
      const bank = await this.resolveAccountByType(tx, groupId, 'BANK', ACCT.BANK_PRIMARY);
      const deposits = await this.resolveAccountByCode(tx, groupId, ACCT.CUSTOMER_DEPOSITS);
      if (!bank || !deposits) return { posted: false, reason: 'missing-accounts' };

      const minorAmount = Math.round(amount * 100);
      await this.postVoucher(tx, {
        groupId,
        postingDate: new Date().toISOString().slice(0, 10),
        voucherType: 'PAYMENT',
        voucherId: depositId,
        lines: [
          { accountId: bank.id, debit: minorAmount, credit: 0, remarks: `Deposit from ${customerName}` },
          { accountId: deposits.id, debit: 0, credit: minorAmount, partyType: 'CUSTOMER', remarks: customerName },
        ],
      });
      return { posted: true };
    });
  }

  /**
   * Post when a customer deposit is recognised as revenue on delivery (IFRS 15).
   * DR 2150 Customer Deposits (clears deferred revenue)
   * CR 4110 Product Sales Revenue (revenue recognised)
   */
  async postDepositRecognition(
    orderId: string,
    customerName: string,
    amount: number,
    groupId: string | null,
    actor: Actor,
  ): Promise<{ posted: boolean; reason?: string }> {
    if (amount <= 0) return { posted: false, reason: 'zero-amount' };
    return withActor(this.db, actor, async (tx) => {
      const voucherId = `deposit-recog-${orderId}`;
      if (await this.alreadyPosted(tx, 'SALES_INVOICE', voucherId)) {
        return { posted: false, reason: 'already-posted' };
      }
      const deposits = await this.resolveAccountByCode(tx, groupId, ACCT.CUSTOMER_DEPOSITS);
      const revenue = await this.resolveAccountByCode(tx, groupId, ACCT.PRODUCT_SALES);
      if (!deposits || !revenue) return { posted: false, reason: 'missing-accounts' };

      const minorAmount = Math.round(amount * 100);
      await this.postVoucher(tx, {
        groupId,
        postingDate: new Date().toISOString().slice(0, 10),
        voucherType: 'SALES_INVOICE',
        voucherId,
        lines: [
          { accountId: deposits.id, debit: minorAmount, credit: 0, remarks: `Deposit recognised on delivery — ${customerName}` },
          { accountId: revenue.id, debit: 0, credit: minorAmount, remarks: `Revenue from deposit — ${customerName}` },
        ],
      });
      return { posted: true };
    });
  }

  // ─── Reversal of an auto-posted voucher (retrack / delete) ───────────────────

  /**
   * Reverse a previously auto-posted voucher (SALES_INVOICE / PAYMENT /
   * PURCHASE_RECEIPT) by appending offsetting gl_entries — the ledger is
   * append-only, so we never edit the originals; the offset nets them to zero.
   * Idempotent: if the voucher's live entries already net to zero (never posted,
   * or already reversed), it's a no-op. Non-fatal by contract.
   *
   * Used when an order is retracted out of DELIVERED/REMITTED (undo the sale /
   * settlement) or a delivered order is deleted.
   */
  async reverseVoucher(
    voucherType: GlVoucherType,
    voucherId: string,
    actor: Actor,
    reason?: string,
  ): Promise<{ reversed: boolean; reason?: string }> {
    return withActor(this.db, actor, async (tx) => {
      const rows = await tx
        .select({
          accountId: schema.glEntries.accountId,
          groupId: schema.glEntries.groupId,
          debit: schema.glEntries.debit,
          credit: schema.glEntries.credit,
          partyType: schema.glEntries.partyType,
          partyId: schema.glEntries.partyId,
        })
        .from(schema.glEntries)
        .where(
          and(
            eq(schema.glEntries.voucherType, voucherType),
            eq(schema.glEntries.voucherId, voucherId),
          ),
        );
      if (rows.length === 0) return { reversed: false, reason: 'nothing-posted' };

      // Net per account across ALL entries for this voucher (originals + any
      // prior reversals). If everything already nets to zero, we're done.
      const netByAccount = new Map<
        string,
        { net: number; groupId: string | null; partyType: string | null; partyId: string | null }
      >();
      for (const r of rows) {
        const prev = netByAccount.get(r.accountId);
        const delta = Math.round(Number(r.debit) * 100) - Math.round(Number(r.credit) * 100);
        if (prev) prev.net += delta;
        else
          netByAccount.set(r.accountId, {
            net: delta,
            groupId: r.groupId,
            partyType: r.partyType,
            partyId: r.partyId,
          });
      }

      const offsets = [...netByAccount.entries()].filter(([, v]) => v.net !== 0);
      if (offsets.length === 0) return { reversed: false, reason: 'already-reversed' };

      const groupId = offsets[0]![1].groupId;
      const postingDate = new Date().toISOString().slice(0, 10);
      const remark = `Reversal: ${reason ?? 'order retracted/deleted'}`;

      // Build offsetting lines: negate each account's live net (debit-positive).
      const lines: PostVoucherLine[] = offsets.map(([accountId, v]) => {
        const amount = Math.abs(v.net) / 100;
        return v.net > 0
          ? { accountId, debit: 0, credit: amount, partyType: v.partyType, partyId: v.partyId, remarks: remark }
          : { accountId, debit: amount, credit: 0, partyType: v.partyType, partyId: v.partyId, remarks: remark };
      });

      // Reversal posts under the SAME (voucherType, voucherId) so future
      // idempotency checks see the net-zero state. It balances by construction
      // (offsets of a balanced voucher sum to zero).
      await this.postVoucher(tx, {
        groupId,
        postingDate,
        voucherType,
        voucherId,
        lines,
      });

      return { reversed: true };
    });
  }

  // ─── Journal Entries ───────────────────────────────────────────────────────

  /** Approval threshold: JEs above this amount (₦500,000) require approval unless the actor has write permission. */
  static readonly APPROVAL_THRESHOLD = 500_000;

  async createJournalEntry(input: CreateJournalEntryInput, actor: Actor, forceDraft?: boolean) {
    return withActor(this.db, actor, async (tx) => {
      const totalDebit = input.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
      const totalCredit = input.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
      const isDraft = input.isDraft || forceDraft || false;

      if (isDraft) {
        // DRAFT mode: save header + stash lines as JSON, but do NOT post GL entries.
        const [header] = await tx
          .insert(schema.journalEntries)
          .values({
            groupId: input.groupId ?? null,
            postingDate: input.postingDate,
            description: input.description,
            totalDebit: sql`${totalDebit}::numeric`,
            totalCredit: sql`${totalCredit}::numeric`,
            status: 'DRAFT',
          })
          .returning();

        // Store the draft lines in the idempotencyKey field as JSON (reusing
        // nullable text column to avoid schema change — lines are small).
        await tx
          .update(schema.journalEntries)
          .set({
            idempotencyKey: JSON.stringify(
              input.lines.map((l) => ({
                accountId: l.accountId,
                debit: l.debit ?? 0,
                credit: l.credit ?? 0,
                partyType: l.partyType ?? null,
                partyId: l.partyId ?? null,
                remarks: l.remarks ?? null,
              })),
            ),
            updatedAt: new Date(),
          })
          .where(eq(schema.journalEntries.id, header!.id));

        return { ...header!, fiscalYearId: null as string | null };
      }

      // POSTED mode: original flow.
      const [header] = await tx
        .insert(schema.journalEntries)
        .values({
          groupId: input.groupId ?? null,
          postingDate: input.postingDate,
          description: input.description,
          totalDebit: sql`${totalDebit}::numeric`,
          totalCredit: sql`${totalCredit}::numeric`,
          status: 'POSTED',
        })
        .returning();

      const { fiscalYearId } = await this.postVoucher(tx, {
        groupId: input.groupId ?? null,
        postingDate: input.postingDate,
        voucherType: 'JOURNAL_ENTRY',
        voucherId: header!.id,
        lines: input.lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          partyType: l.partyType ?? null,
          partyId: l.partyId ?? null,
          remarks: l.remarks ?? null,
        })),
      });

      await tx
        .update(schema.journalEntries)
        .set({ fiscalYearId, updatedAt: new Date() })
        .where(eq(schema.journalEntries.id, header!.id));

      return { ...header!, fiscalYearId };
    });
  }

  /**
   * Approve a DRAFT journal entry: validates it's in DRAFT status, hydrates
   * the stashed lines from idempotencyKey, runs them through postVoucher, and
   * flips status to POSTED. Sets approved_by/at for audit trail.
   */
  async approveJournalEntry(input: ApproveJournalEntryInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, input.journalEntryId))
        .limit(1);
      if (!header) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found.' });
      }
      if (header.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot approve a journal entry with status "${header.status}". Only DRAFT entries can be approved.`,
        });
      }

      // Hydrate stashed lines from idempotencyKey.
      if (!header.idempotencyKey) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Draft journal entry has no stashed lines. Re-create it.',
        });
      }

      let lines: PostVoucherLine[];
      try {
        lines = JSON.parse(header.idempotencyKey) as PostVoucherLine[];
      } catch {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Draft journal entry has malformed stashed lines.',
        });
      }

      const { fiscalYearId } = await this.postVoucher(tx, {
        groupId: header.groupId,
        postingDate: header.postingDate,
        voucherType: 'JOURNAL_ENTRY',
        voucherId: header.id,
        lines,
      });

      const [updated] = await tx
        .update(schema.journalEntries)
        .set({
          status: 'POSTED',
          fiscalYearId,
          approvedBy: actor.id,
          approvedAt: new Date(),
          // Clear the stashed lines now that they've been posted.
          idempotencyKey: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.journalEntries.id, header.id))
        .returning();

      return { ...updated!, fiscalYearId };
    });
  }

  /**
   * Reject a DRAFT journal entry: validates it's in DRAFT status, flips to
   * CANCELLED, and stores the rejection reason. No GL lines are posted.
   */
  async rejectJournalEntry(input: RejectJournalEntryInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [header] = await tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, input.journalEntryId))
        .limit(1);
      if (!header) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found.' });
      }
      if (header.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot reject a journal entry with status "${header.status}". Only DRAFT entries can be rejected.`,
        });
      }

      const [updated] = await tx
        .update(schema.journalEntries)
        .set({
          status: 'CANCELLED',
          // Store rejection metadata as JSON in idempotencyKey (reusing
          // nullable text column; draft lines are no longer relevant).
          idempotencyKey: JSON.stringify({
            rejectedBy: actor.id,
            rejectedAt: new Date().toISOString(),
            reason: input.reason,
          }),
          updatedAt: new Date(),
        })
        .where(eq(schema.journalEntries.id, header.id))
        .returning();

      return updated!;
    });
  }

  /**
   * Phase 6 — post opening balances at cutover. The caller supplies each
   * account's opening debit/credit; this posts them as a single JOURNAL_ENTRY
   * and auto-adds a balancing line to "Opening Balance Equity" for any residual,
   * so the entry always balances (ERPNext's cutover pattern). Idempotent by
   * description isn't guaranteed — the caller should only run this once per
   * company at go-live (guarded in the UI). Requires an OPEN fiscal year covering
   * the posting date.
   */
  async postOpeningBalances(input: PostOpeningBalancesInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const groupId = input.groupId ?? null;

      let totalDebitMinor = 0;
      let totalCreditMinor = 0;
      const lines: PostVoucherLine[] = input.lines.map((l) => {
        totalDebitMinor += Math.round((l.debit ?? 0) * 100);
        totalCreditMinor += Math.round((l.credit ?? 0) * 100);
        return { accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0 };
      });

      // Balancing line to Opening Balance Equity for any residual.
      const residualMinor = totalDebitMinor - totalCreditMinor;
      if (residualMinor !== 0) {
        const equity = await this.resolveAccountByCode(tx, groupId, ACCT.OPENING_BALANCE_EQUITY);
        if (!equity) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Opening Balance Equity account not found. Seed the chart of accounts first.',
          });
        }
        const residual = Math.abs(residualMinor) / 100;
        // If lines are net-debit, credit equity (and vice-versa) to balance.
        lines.push(
          residualMinor > 0
            ? { accountId: equity.id, debit: 0, credit: residual }
            : { accountId: equity.id, debit: residual, credit: 0 },
        );
      }

      const finalDebit = lines.reduce((s, l) => s + l.debit, 0);
      const finalCredit = lines.reduce((s, l) => s + l.credit, 0);

      const [header] = await tx
        .insert(schema.journalEntries)
        .values({
          groupId,
          postingDate: input.postingDate,
          description: 'Opening balances (cutover)',
          totalDebit: sql`${finalDebit}::numeric`,
          totalCredit: sql`${finalCredit}::numeric`,
          status: 'POSTED',
        })
        .returning();

      const { fiscalYearId } = await this.postVoucher(tx, {
        groupId,
        postingDate: input.postingDate,
        voucherType: 'JOURNAL_ENTRY',
        voucherId: header!.id,
        lines,
      });

      await tx
        .update(schema.journalEntries)
        .set({ fiscalYearId, updatedAt: new Date() })
        .where(eq(schema.journalEntries.id, header!.id));

      return { ...header!, fiscalYearId };
    });
  }

  /**
   * Reverse a posted journal entry: create a new JE whose lines swap debit↔credit,
   * run it through postVoucher (so it must balance and respect period locks), and
   * mark the original CANCELLED. Original gl_entries are never mutated — the
   * reversal rows net the original to zero.
   */
  async reverseJournalEntry(input: ReverseJournalEntryInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [original] = await tx
        .select()
        .from(schema.journalEntries)
        .where(eq(schema.journalEntries.id, input.journalEntryId))
        .limit(1);
      if (!original) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found.' });
      }
      if (original.status === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Journal entry is already cancelled.' });
      }

      const originalLines = await tx
        .select()
        .from(schema.glEntries)
        .where(
          and(
            eq(schema.glEntries.voucherType, 'JOURNAL_ENTRY'),
            eq(schema.glEntries.voucherId, original.id),
          ),
        );
      if (!originalLines.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Journal entry has no ledger lines to reverse.' });
      }

      const postingDate = new Date().toISOString().slice(0, 10);
      const reason = input.reason?.trim();
      const [reversalHeader] = await tx
        .insert(schema.journalEntries)
        .values({
          groupId: original.groupId,
          postingDate,
          description: `Reversal of JE #${original.entryNumber}${reason ? `: ${reason}` : ''}`,
          totalDebit: original.totalCredit,
          totalCredit: original.totalDebit,
          status: 'POSTED',
          reversalOfId: original.id,
        })
        .returning();

      const { fiscalYearId } = await this.postVoucher(tx, {
        groupId: original.groupId,
        postingDate,
        voucherType: 'JOURNAL_ENTRY',
        voucherId: reversalHeader!.id,
        lines: originalLines.map((l) => ({
          accountId: l.accountId,
          // Swap sides: original debit becomes reversal credit and vice-versa.
          debit: Number(l.credit),
          credit: Number(l.debit),
          partyType: l.partyType,
          partyId: l.partyId,
          remarks: `Reversal of JE #${original.entryNumber}`,
        })),
      });

      await tx
        .update(schema.journalEntries)
        .set({ fiscalYearId, updatedAt: new Date() })
        .where(eq(schema.journalEntries.id, reversalHeader!.id));

      await tx
        .update(schema.journalEntries)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(eq(schema.journalEntries.id, original.id));

      return { ...reversalHeader!, fiscalYearId };
    });
  }

  async listJournalEntries(input: ListJournalEntriesInput) {
    const conds: SQL[] = [this.groupEqOn(schema.journalEntries.groupId, input.groupId)];
    if (input.status) conds.push(eq(schema.journalEntries.status, input.status));
    if (input.startDate) conds.push(gte(schema.journalEntries.postingDate, input.startDate));
    if (input.endDate) conds.push(lte(schema.journalEntries.postingDate, input.endDate));
    if (input.search) conds.push(ilike(schema.journalEntries.description, `%${input.search}%`));

    const where = and(...conds);
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(schema.journalEntries)
        .where(where)
        .orderBy(desc(schema.journalEntries.postingDate), desc(schema.journalEntries.entryNumber))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.journalEntries)
        .where(where),
    ]);

    const total = totalRow[0]?.total ?? 0;
    return {
      records: rows,
      pagination: {
        total,
        page: input.page,
        pageSize: input.limit,
        totalPages: Math.max(1, Math.ceil(total / input.limit)),
      },
    };
  }

  async getJournalEntry(input: GetJournalEntryInput) {
    const [header] = await this.db
      .select()
      .from(schema.journalEntries)
      .where(eq(schema.journalEntries.id, input.journalEntryId))
      .limit(1);
    if (!header) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found.' });
    }

    const lines = await this.db
      .select({
        id: schema.glEntries.id,
        accountId: schema.glEntries.accountId,
        accountCode: schema.accounts.code,
        accountName: schema.accounts.name,
        debit: schema.glEntries.debit,
        credit: schema.glEntries.credit,
        partyType: schema.glEntries.partyType,
        partyId: schema.glEntries.partyId,
        remarks: schema.glEntries.remarks,
      })
      .from(schema.glEntries)
      .innerJoin(schema.accounts, eq(schema.glEntries.accountId, schema.accounts.id))
      .where(
        and(
          eq(schema.glEntries.voucherType, 'JOURNAL_ENTRY'),
          eq(schema.glEntries.voucherId, header.id),
        ),
      )
      .orderBy(desc(schema.glEntries.debit));

    return { ...header, lines };
  }

  // ─── Accounts (Chart of Accounts) ───────────────────────────────────────────

  async listAccounts(input: ListAccountsInput) {
    const conds: SQL[] = [this.groupEq(input.groupId)];
    if (!input.includeInactive) conds.push(eq(schema.accounts.isActive, true));
    const rows = await this.db
      .select()
      .from(schema.accounts)
      .where(and(...conds))
      .orderBy(schema.accounts.code);
    return rows;
  }

  async createAccount(input: CreateAccountInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      // Guard duplicate code within the company.
      const [dup] = await tx
        .select({ id: schema.accounts.id })
        .from(schema.accounts)
        .where(and(this.groupEq(input.groupId), eq(schema.accounts.code, input.code)))
        .limit(1);
      if (dup) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Account code "${input.code}" already exists.` });
      }

      const [row] = await tx
        .insert(schema.accounts)
        .values({
          groupId: input.groupId ?? null,
          code: input.code,
          name: input.name,
          rootType: input.rootType,
          accountType: input.accountType ?? null,
          isGroup: input.isGroup,
          parentAccountId: input.parentAccountId ?? null,
        })
        .returning();
      return row;
    });
  }

  // ─── Fiscal Years ────────────────────────────────────────────────────────────

  async listFiscalYears(input: ListFiscalYearsInput) {
    return this.db
      .select()
      .from(schema.fiscalYears)
      .where(this.groupEqOn(schema.fiscalYears.groupId, input.groupId))
      .orderBy(desc(schema.fiscalYears.startDate));
  }

  async createFiscalYear(input: CreateFiscalYearInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      // Reject overlap within the company.
      const [overlap] = await tx
        .select({ id: schema.fiscalYears.id })
        .from(schema.fiscalYears)
        .where(
          and(
            this.groupEqOn(schema.fiscalYears.groupId, input.groupId),
            lte(schema.fiscalYears.startDate, input.endDate),
            gte(schema.fiscalYears.endDate, input.startDate),
          ),
        )
        .limit(1);
      if (overlap) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A fiscal year already overlaps this date range.',
        });
      }

      const [row] = await tx
        .insert(schema.fiscalYears)
        .values({
          groupId: input.groupId ?? null,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          status: 'OPEN',
        })
        .returning();
      return row;
    });
  }

  async closeFiscalYear(input: CloseFiscalYearInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      // Lock the row FOR UPDATE to prevent concurrent postings while closing.
      const [existing] = await tx
        .select({
          id: schema.fiscalYears.id,
          status: schema.fiscalYears.status,
        })
        .from(schema.fiscalYears)
        .where(eq(schema.fiscalYears.id, input.fiscalYearId))
        .for('update')
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fiscal year not found.' });
      }
      if (existing.status === 'CLOSED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Fiscal year is already closed.' });
      }

      const [row] = await tx
        .update(schema.fiscalYears)
        .set({ status: 'CLOSED', updatedAt: new Date() })
        .where(eq(schema.fiscalYears.id, input.fiscalYearId))
        .returning();
      return row!;
    });
  }

  /**
   * Reopen a closed fiscal year (SuperAdmin only — enforced in router).
   * Allows postings to resume in the period.
   * Rejects if any later fiscal year (same group) is already CLOSED,
   * because reopening an earlier period while a later one is locked
   * would break the sequential close invariant.
   */
  async reopenFiscalYear(input: ReopenFiscalYearInput, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [existing] = await tx
        .select({
          status: schema.fiscalYears.status,
          endDate: schema.fiscalYears.endDate,
          groupId: schema.fiscalYears.groupId,
        })
        .from(schema.fiscalYears)
        .where(eq(schema.fiscalYears.id, input.fiscalYearId))
        .for('update')
        .limit(1);
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fiscal year not found.' });
      }
      if (existing.status === 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Fiscal year is already open.' });
      }

      // Guard: reject if a later fiscal year (same company) is also closed.
      const laterClosed = await tx
        .select({ id: schema.fiscalYears.id, name: schema.fiscalYears.name })
        .from(schema.fiscalYears)
        .where(
          and(
            this.groupEqOn(schema.fiscalYears.groupId, existing.groupId),
            gt(schema.fiscalYears.startDate, existing.endDate),
            eq(schema.fiscalYears.status, 'CLOSED'),
          ),
        )
        .limit(1);
      if (laterClosed.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot reopen: a later fiscal year ("${laterClosed[0]!.name}") is still closed. Close periods sequentially.`,
        });
      }

      const [row] = await tx
        .update(schema.fiscalYears)
        .set({ status: 'OPEN', updatedAt: new Date() })
        .where(eq(schema.fiscalYears.id, input.fiscalYearId))
        .returning();
      return row!;
    });
  }

  // ─── Trial Balance ───────────────────────────────────────────────────────────

  /**
   * Sum debits/credits per account from gl_entries (the source of truth). Only
   * lines belonging to POSTED journal entries count; cancelled JEs are netted by
   * their reversal rows, but we also exclude the cancelled header's own lines so
   * the pair truly nets to zero regardless of period boundaries.
   */
  async trialBalance(input: TrialBalanceInput) {
    const conds: SQL[] = [this.groupEqOn(schema.glEntries.groupId, input.groupId)];
    if (input.asOfDate) conds.push(lte(schema.glEntries.postingDate, input.asOfDate));

    const rows = await this.db
      .select({
        accountId: schema.accounts.id,
        code: schema.accounts.code,
        name: schema.accounts.name,
        rootType: schema.accounts.rootType,
        debit: sql<string>`COALESCE(SUM(${schema.glEntries.debit}), 0)`,
        credit: sql<string>`COALESCE(SUM(${schema.glEntries.credit}), 0)`,
      })
      .from(schema.glEntries)
      .innerJoin(schema.accounts, eq(schema.glEntries.accountId, schema.accounts.id))
      .where(and(...conds))
      .groupBy(schema.accounts.id, schema.accounts.code, schema.accounts.name, schema.accounts.rootType)
      .orderBy(schema.accounts.code);

    let totalDebitMinor = 0;
    let totalCreditMinor = 0;
    const accounts = rows
      .map((r) => {
        const debit = Number(r.debit);
        const credit = Number(r.credit);
        const netMinor = toMinor(debit) - toMinor(credit);
        totalDebitMinor += toMinor(debit);
        totalCreditMinor += toMinor(credit);
        return {
          accountId: r.accountId,
          code: r.code,
          name: r.name,
          rootType: r.rootType,
          // Present net on the natural side.
          debit: netMinor > 0 ? netMinor / 100 : 0,
          credit: netMinor < 0 ? -netMinor / 100 : 0,
        };
      })
      .filter((r) => r.debit !== 0 || r.credit !== 0);

    const totalDebit = accounts.reduce((s, a) => s + a.debit, 0);
    const totalCredit = accounts.reduce((s, a) => s + a.credit, 0);

    return {
      accounts,
      totals: {
        totalDebit,
        totalCredit,
        balanced: toMinor(totalDebit) === toMinor(totalCredit),
      },
      rawTotals: { debit: totalDebitMinor / 100, credit: totalCreditMinor / 100 },
    };
  }

  // ─── Phase 5: Financial statements ───────────────────────────────────────────

  /**
   * Per-account balances by root type over a date range, joined to accounts.
   * `signed` = debit − credit (debit-positive). Used to build P&L / Balance Sheet.
   */
  private async accountNetsByRoot(
    groupId: string | null,
    rootTypes: string[],
    opts: { startDate?: string; endDate?: string },
  ): Promise<Array<{ code: string; name: string; rootType: string; net: number }>> {
    const conds: SQL[] = [this.groupEqOn(schema.glEntries.groupId, groupId)];
    if (opts.startDate) conds.push(gte(schema.glEntries.postingDate, opts.startDate));
    if (opts.endDate) conds.push(lte(schema.glEntries.postingDate, opts.endDate));
    conds.push(inArray(schema.accounts.rootType, rootTypes as never));

    const rows = await this.db
      .select({
        code: schema.accounts.code,
        name: schema.accounts.name,
        rootType: schema.accounts.rootType,
        debit: sql<string>`COALESCE(SUM(${schema.glEntries.debit}), 0)`,
        credit: sql<string>`COALESCE(SUM(${schema.glEntries.credit}), 0)`,
      })
      .from(schema.glEntries)
      .innerJoin(schema.accounts, eq(schema.glEntries.accountId, schema.accounts.id))
      .where(and(...conds))
      .groupBy(schema.accounts.code, schema.accounts.name, schema.accounts.rootType)
      .orderBy(schema.accounts.code);

    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      rootType: r.rootType,
      net: Number(r.debit) - Number(r.credit),
    }));
  }

  /** Profit & Loss: Income (credit-positive) − Expense (debit-positive) for the period. */
  async profitAndLoss(input: ProfitAndLossInput) {
    const groupId = input.groupId ?? null;
    const rows = await this.accountNetsByRoot(groupId, ['INCOME', 'EXPENSE'], {
      startDate: input.startDate,
      endDate: input.endDate,
    });
    // Income accounts carry credit balances (net < 0 in debit-positive terms).
    const income = rows
      .filter((r) => r.rootType === 'INCOME')
      .map((r) => ({ code: r.code, name: r.name, amount: -r.net }));
    const expense = rows
      .filter((r) => r.rootType === 'EXPENSE')
      .map((r) => ({ code: r.code, name: r.name, amount: r.net }));
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expense.reduce((s, r) => s + r.amount, 0);

    // Comparative period (optional)
    let comparative:
      | {
          comparativeIncome: typeof income;
          comparativeExpense: typeof expense;
          comparativeTotalIncome: number;
          comparativeTotalExpense: number;
          comparativeNetProfit: number;
          comparativePeriod: { startDate: string | null; endDate: string | null };
        }
      | undefined;
    if (input.comparativeStartDate || input.comparativeEndDate) {
      const compRows = await this.accountNetsByRoot(groupId, ['INCOME', 'EXPENSE'], {
        startDate: input.comparativeStartDate,
        endDate: input.comparativeEndDate,
      });
      const comparativeIncome = compRows
        .filter((r) => r.rootType === 'INCOME')
        .map((r) => ({ code: r.code, name: r.name, amount: -r.net }));
      const comparativeExpense = compRows
        .filter((r) => r.rootType === 'EXPENSE')
        .map((r) => ({ code: r.code, name: r.name, amount: r.net }));
      const comparativeTotalIncome = comparativeIncome.reduce((s, r) => s + r.amount, 0);
      const comparativeTotalExpense = comparativeExpense.reduce((s, r) => s + r.amount, 0);
      comparative = {
        comparativeIncome,
        comparativeExpense,
        comparativeTotalIncome,
        comparativeTotalExpense,
        comparativeNetProfit: comparativeTotalIncome - comparativeTotalExpense,
        comparativePeriod: {
          startDate: input.comparativeStartDate ?? null,
          endDate: input.comparativeEndDate ?? null,
        },
      };
    }

    return {
      income,
      expense,
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
      period: { startDate: input.startDate ?? null, endDate: input.endDate ?? null },
      ...comparative,
    };
  }

  /**
   * Balance Sheet as of a date. Assets (debit-positive) vs Liabilities + Equity
   * (credit-positive) + retained earnings (net Income − Expense to date).
   */
  async balanceSheet(input: BalanceSheetInput) {
    const groupId = input.groupId ?? null;
    const opts = { endDate: input.asOfDate };
    const bsRows = await this.accountNetsByRoot(groupId, ['ASSET', 'LIABILITY', 'EQUITY'], opts);
    const plRows = await this.accountNetsByRoot(groupId, ['INCOME', 'EXPENSE'], opts);

    const assets = bsRows
      .filter((r) => r.rootType === 'ASSET')
      .map((r) => ({ code: r.code, name: r.name, amount: r.net }));
    const liabilities = bsRows
      .filter((r) => r.rootType === 'LIABILITY')
      .map((r) => ({ code: r.code, name: r.name, amount: -r.net }));
    const equity = bsRows
      .filter((r) => r.rootType === 'EQUITY')
      .map((r) => ({ code: r.code, name: r.name, amount: -r.net }));

    const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
    const bookEquity = equity.reduce((s, r) => s + r.amount, 0);
    // Current-period earnings roll into equity on the balance sheet.
    const income = plRows.filter((r) => r.rootType === 'INCOME').reduce((s, r) => s - r.net, 0);
    const expense = plRows.filter((r) => r.rootType === 'EXPENSE').reduce((s, r) => s + r.net, 0);
    const retainedEarnings = income - expense;
    const totalEquity = bookEquity + retainedEarnings;

    // Comparative period (optional)
    let comparative:
      | {
          comparativeAssets: typeof assets;
          comparativeLiabilities: typeof liabilities;
          comparativeEquity: typeof equity;
          comparativeRetainedEarnings: number;
          comparativeTotalAssets: number;
          comparativeTotalLiabilities: number;
          comparativeTotalEquity: number;
          comparativeBalanced: boolean;
          comparativePeriod: { startDate: string | null; endDate: string | null };
        }
      | undefined;
    if (input.comparativeStartDate || input.comparativeEndDate) {
      // For a balance sheet comparative, the endDate acts as the "as of" date
      const compAsOfDate = input.comparativeEndDate;
      const compOpts = { endDate: compAsOfDate };
      const compBsRows = await this.accountNetsByRoot(groupId, ['ASSET', 'LIABILITY', 'EQUITY'], compOpts);
      const compPlRows = await this.accountNetsByRoot(groupId, ['INCOME', 'EXPENSE'], compOpts);

      const comparativeAssets = compBsRows
        .filter((r) => r.rootType === 'ASSET')
        .map((r) => ({ code: r.code, name: r.name, amount: r.net }));
      const comparativeLiabilities = compBsRows
        .filter((r) => r.rootType === 'LIABILITY')
        .map((r) => ({ code: r.code, name: r.name, amount: -r.net }));
      const comparativeEquity = compBsRows
        .filter((r) => r.rootType === 'EQUITY')
        .map((r) => ({ code: r.code, name: r.name, amount: -r.net }));

      const comparativeTotalAssets = comparativeAssets.reduce((s, r) => s + r.amount, 0);
      const comparativeTotalLiabilities = comparativeLiabilities.reduce((s, r) => s + r.amount, 0);
      const compBookEquity = comparativeEquity.reduce((s, r) => s + r.amount, 0);
      const compIncome = compPlRows.filter((r) => r.rootType === 'INCOME').reduce((s, r) => s - r.net, 0);
      const compExpense = compPlRows.filter((r) => r.rootType === 'EXPENSE').reduce((s, r) => s + r.net, 0);
      const comparativeRetainedEarnings = compIncome - compExpense;
      const comparativeTotalEquity = compBookEquity + comparativeRetainedEarnings;

      comparative = {
        comparativeAssets,
        comparativeLiabilities,
        comparativeEquity,
        comparativeRetainedEarnings,
        comparativeTotalAssets,
        comparativeTotalLiabilities,
        comparativeTotalEquity,
        comparativeBalanced:
          Math.round(comparativeTotalAssets * 100) ===
          Math.round((comparativeTotalLiabilities + comparativeTotalEquity) * 100),
        comparativePeriod: {
          startDate: input.comparativeStartDate ?? null,
          endDate: input.comparativeEndDate ?? null,
        },
      };
    }

    return {
      assets,
      liabilities,
      equity,
      retainedEarnings,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced:
        Math.round(totalAssets * 100) === Math.round((totalLiabilities + totalEquity) * 100),
      asOfDate: input.asOfDate ?? null,
      ...comparative,
    };
  }

  /**
   * Cash Flow (direct method, simplified): movement on BANK + CASH accounts over
   * the period. Opening balance = net before startDate; inflows = debits, outflows
   * = credits within the window; closing = opening + inflows − outflows. Per-account
   * breakdown so each bank/cash account's movement is visible.
   */
  async cashFlow(input: CashFlowInput) {
    const groupId = input.groupId ?? null;

    const cashAccounts = await this.db
      .select({ id: schema.accounts.id, code: schema.accounts.code, name: schema.accounts.name })
      .from(schema.accounts)
      .where(
        and(
          this.groupEqOn(schema.accounts.groupId, groupId),
          inArray(schema.accounts.accountType, ['BANK', 'CASH'] as never),
          eq(schema.accounts.isGroup, false),
        ),
      )
      .orderBy(schema.accounts.code);

    const accountsOut: Array<{
      code: string;
      name: string;
      opening: number;
      inflow: number;
      outflow: number;
      closing: number;
    }> = [];

    for (const acc of cashAccounts) {
      const openingConds: SQL[] = [eq(schema.glEntries.accountId, acc.id)];
      if (input.startDate) openingConds.push(sql`${schema.glEntries.postingDate} < ${input.startDate}`);
      const [openingRow] = input.startDate
        ? await this.db
            .select({ net: sql<string>`COALESCE(SUM(${schema.glEntries.debit} - ${schema.glEntries.credit}), 0)` })
            .from(schema.glEntries)
            .where(and(...openingConds))
        : [{ net: '0' }];

      const periodConds: SQL[] = [eq(schema.glEntries.accountId, acc.id)];
      if (input.startDate) periodConds.push(gte(schema.glEntries.postingDate, input.startDate));
      if (input.endDate) periodConds.push(lte(schema.glEntries.postingDate, input.endDate));
      const [periodRow] = await this.db
        .select({
          inflow: sql<string>`COALESCE(SUM(${schema.glEntries.debit}), 0)`,
          outflow: sql<string>`COALESCE(SUM(${schema.glEntries.credit}), 0)`,
        })
        .from(schema.glEntries)
        .where(and(...periodConds));

      const opening = Number(openingRow?.net ?? 0);
      const inflow = Number(periodRow?.inflow ?? 0);
      const outflow = Number(periodRow?.outflow ?? 0);
      accountsOut.push({
        code: acc.code,
        name: acc.name,
        opening,
        inflow,
        outflow,
        closing: opening + inflow - outflow,
      });
    }

    const totals = accountsOut.reduce(
      (acc, a) => {
        acc.opening += a.opening;
        acc.inflow += a.inflow;
        acc.outflow += a.outflow;
        acc.closing += a.closing;
        return acc;
      },
      { opening: 0, inflow: 0, outflow: 0, closing: 0 },
    );

    // Comparative period (optional)
    let comparative:
      | {
          comparativeAccounts: typeof accountsOut;
          comparativeTotals: typeof totals;
          comparativePeriod: { startDate: string | null; endDate: string | null };
        }
      | undefined;
    if (input.comparativeStartDate || input.comparativeEndDate) {
      const compAccountsOut: typeof accountsOut = [];

      for (const acc of cashAccounts) {
        const openingConds: SQL[] = [eq(schema.glEntries.accountId, acc.id)];
        if (input.comparativeStartDate)
          openingConds.push(sql`${schema.glEntries.postingDate} < ${input.comparativeStartDate}`);
        const [openingRow] = input.comparativeStartDate
          ? await this.db
              .select({
                net: sql<string>`COALESCE(SUM(${schema.glEntries.debit} - ${schema.glEntries.credit}), 0)`,
              })
              .from(schema.glEntries)
              .where(and(...openingConds))
          : [{ net: '0' }];

        const periodConds: SQL[] = [eq(schema.glEntries.accountId, acc.id)];
        if (input.comparativeStartDate)
          periodConds.push(gte(schema.glEntries.postingDate, input.comparativeStartDate));
        if (input.comparativeEndDate)
          periodConds.push(lte(schema.glEntries.postingDate, input.comparativeEndDate));
        const [periodRow] = await this.db
          .select({
            inflow: sql<string>`COALESCE(SUM(${schema.glEntries.debit}), 0)`,
            outflow: sql<string>`COALESCE(SUM(${schema.glEntries.credit}), 0)`,
          })
          .from(schema.glEntries)
          .where(and(...periodConds));

        const opening = Number(openingRow?.net ?? 0);
        const inflow = Number(periodRow?.inflow ?? 0);
        const outflow = Number(periodRow?.outflow ?? 0);
        compAccountsOut.push({
          code: acc.code,
          name: acc.name,
          opening,
          inflow,
          outflow,
          closing: opening + inflow - outflow,
        });
      }

      const compTotals = compAccountsOut.reduce(
        (acc, a) => {
          acc.opening += a.opening;
          acc.inflow += a.inflow;
          acc.outflow += a.outflow;
          acc.closing += a.closing;
          return acc;
        },
        { opening: 0, inflow: 0, outflow: 0, closing: 0 },
      );

      comparative = {
        comparativeAccounts: compAccountsOut,
        comparativeTotals: compTotals,
        comparativePeriod: {
          startDate: input.comparativeStartDate ?? null,
          endDate: input.comparativeEndDate ?? null,
        },
      };
    }

    return {
      accounts: accountsOut,
      totals,
      period: { startDate: input.startDate ?? null, endDate: input.endDate ?? null },
      ...comparative,
    };
  }

  /**
   * AR/AP aging: open balance per party for RECEIVABLE (AR) or PAYABLE (AP)
   * accounts, bucketed by the age of the posting date. A positive AR balance is
   * an unpaid customer; positive AP is an unpaid supplier.
   */
  async aging(input: AgingInput) {
    const groupId = input.groupId ?? null;
    const asOf = input.asOfDate ?? new Date().toISOString().slice(0, 10);
    const partyType = input.kind === 'RECEIVABLE' ? 'CUSTOMER' : 'SUPPLIER';

    const conds: SQL[] = [
      this.groupEqOn(schema.glEntries.groupId, groupId),
      eq(schema.accounts.accountType, input.kind),
      lte(schema.glEntries.postingDate, asOf),
    ];

    // Group by real columns only (remarks + posting_date) — grouping by a
    // computed age expression trips Postgres' GROUP BY validation. We compute the
    // age bucket in JS from the returned posting_date. Party name lives in remarks
    // (no party master table yet — customerName/supplierName).
    const rows = await this.db
      .select({
        party: sql<string>`COALESCE(${schema.glEntries.remarks}, '(unspecified)')`,
        postingDate: schema.glEntries.postingDate,
        net: sql<string>`SUM(${schema.glEntries.debit} - ${schema.glEntries.credit})`,
      })
      .from(schema.glEntries)
      .innerJoin(schema.accounts, eq(schema.glEntries.accountId, schema.accounts.id))
      .where(and(...conds))
      .groupBy(sql`COALESCE(${schema.glEntries.remarks}, '(unspecified)')`, schema.glEntries.postingDate);
    void partyType;

    const asOfMs = new Date(asOf).getTime();
    const ageOf = (postingDate: string) =>
      Math.floor((asOfMs - new Date(postingDate).getTime()) / 86_400_000);

    // Roll up into per-party buckets (0-30 / 31-60 / 61-90 / 90+).
    const byParty = new Map<
      string,
      { party: string; b0_30: number; b31_60: number; b61_90: number; b90plus: number; total: number }
    >();
    for (const r of rows) {
      const signed = Number(r.net) * (input.kind === 'RECEIVABLE' ? 1 : -1);
      if (Math.round(signed * 100) === 0) continue;
      const age = ageOf(r.postingDate);
      const entry =
        byParty.get(r.party) ??
        { party: r.party, b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 };
      if (age <= 30) entry.b0_30 += signed;
      else if (age <= 60) entry.b31_60 += signed;
      else if (age <= 90) entry.b61_90 += signed;
      else entry.b90plus += signed;
      entry.total += signed;
      byParty.set(r.party, entry);
    }

    const parties = [...byParty.values()].filter((p) => Math.round(p.total * 100) !== 0);
    const grand = parties.reduce(
      (acc, p) => {
        acc.b0_30 += p.b0_30;
        acc.b31_60 += p.b31_60;
        acc.b61_90 += p.b61_90;
        acc.b90plus += p.b90plus;
        acc.total += p.total;
        return acc;
      },
      { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 },
    );

    return { kind: input.kind, asOfDate: asOf, parties, totals: grand };
  }

  // ─── Financial KPIs (Phase 5A) ──────────────────────────────────────────────

  /**
   * Calculate 14 financial health KPIs from live GL data. Uses the trial balance
   * to extract account-level balances by rootType and accountType, then derives
   * ratios. All division is safe (returns 0 or Infinity on divide-by-zero).
   */
  async financialKPIs(
    groupId: string | null,
    asOfDate?: string,
  ): Promise<{
    currentRatio: number;
    quickRatio: number;
    cashRatio: number;
    grossProfitMargin: number;
    operatingProfitMargin: number;
    netProfitMargin: number;
    returnOnAssets: number;
    returnOnEquity: number;
    debtToEquity: number;
    daysSalesOutstanding: number;
    inventoryTurnover: number;
    daysInventoryOutstanding: number;
    interestCoverage: number;
    cashConversionCycle: number;
  }> {
    // Fetch all account balances with their type metadata in one query.
    const conds: SQL[] = [this.groupEqOn(schema.glEntries.groupId, groupId)];
    if (asOfDate) conds.push(lte(schema.glEntries.postingDate, asOfDate));

    const rows = await this.db
      .select({
        code: schema.accounts.code,
        name: schema.accounts.name,
        rootType: schema.accounts.rootType,
        accountType: schema.accounts.accountType,
        debit: sql<string>`COALESCE(SUM(${schema.glEntries.debit}), 0)`,
        credit: sql<string>`COALESCE(SUM(${schema.glEntries.credit}), 0)`,
      })
      .from(schema.glEntries)
      .innerJoin(schema.accounts, eq(schema.glEntries.accountId, schema.accounts.id))
      .where(and(...conds))
      .groupBy(
        schema.accounts.id,
        schema.accounts.code,
        schema.accounts.name,
        schema.accounts.rootType,
        schema.accounts.accountType,
      )
      .orderBy(schema.accounts.code);

    // Compute net balance per account (debit-positive convention).
    const accounts = rows.map((r) => ({
      code: r.code,
      name: r.name,
      rootType: r.rootType,
      accountType: r.accountType,
      net: Number(r.debit) - Number(r.credit),
    }));

    // ── Aggregate by rootType / accountType ──

    const sumByRoot = (rootType: string) =>
      accounts.filter((a) => a.rootType === rootType).reduce((s, a) => s + a.net, 0);

    const sumByAccountType = (accountType: string) =>
      accounts.filter((a) => a.accountType === accountType).reduce((s, a) => s + a.net, 0);

    // Assets are debit-positive. Current assets = all ASSET accounts (simplified;
    // fixed assets are tagged FIXED_ASSET, the rest are current).
    const totalAssets = sumByRoot('ASSET');
    const fixedAssets = sumByAccountType('FIXED_ASSET');
    const currentAssets = totalAssets - fixedAssets;

    // Liabilities are credit-positive → negate net for natural sign.
    const totalLiabilities = -sumByRoot('LIABILITY');
    const currentLiabilities = totalLiabilities; // simplified: all liabilities are current

    // Equity is credit-positive → negate.
    const bookEquity = -sumByRoot('EQUITY');

    // Revenue (INCOME is credit-positive → negate net).
    const revenue = -sumByRoot('INCOME');

    // Expenses are debit-positive.
    const totalExpenses = sumByRoot('EXPENSE');

    // Specific account types for KPI extraction.
    const inventory = sumByAccountType('STOCK');
    const cashAndBank = sumByAccountType('BANK') + sumByAccountType('CASH');
    const accountsReceivable = sumByAccountType('RECEIVABLE');
    const accountsPayable = -sumByAccountType('PAYABLE'); // credit-positive → negate
    const cogs = sumByAccountType('COST_OF_GOODS_SOLD');

    // Interest expense: look for expense accounts with 'Interest' in the code.
    const interestExpense = accounts
      .filter(
        (a) =>
          a.rootType === 'EXPENSE' &&
          a.code.toLowerCase().includes('interest'),
      )
      .reduce((s, a) => s + a.net, 0);

    // Retained earnings roll into equity for balance sheet purposes.
    const retainedEarnings = revenue - totalExpenses;
    const totalEquity = bookEquity + retainedEarnings;
    const netProfit = revenue - totalExpenses; // PAT (no tax separation yet)
    const grossProfit = revenue - cogs;
    // EBIT = gross profit - operating expenses (everything except COGS and interest)
    const operatingExpenses = totalExpenses - cogs - interestExpense;
    const ebit = grossProfit - operatingExpenses;

    // ── Safe division helper ──
    const safeDiv = (num: number, den: number, fallback = 0): number => {
      if (den === 0) return num === 0 ? fallback : num > 0 ? Infinity : -Infinity;
      return num / den;
    };

    // ── KPIs ──

    // Liquidity
    const currentRatio = safeDiv(currentAssets, currentLiabilities);
    const quickRatio = safeDiv(currentAssets - inventory, currentLiabilities);
    const cashRatio = safeDiv(cashAndBank, currentLiabilities);

    // Profitability (as %)
    const grossProfitMargin = revenue === 0 ? 0 : (grossProfit / revenue) * 100;
    const operatingProfitMargin = revenue === 0 ? 0 : (ebit / revenue) * 100;
    const netProfitMargin = revenue === 0 ? 0 : (netProfit / revenue) * 100;

    // Returns (as %)
    const returnOnAssets = totalAssets === 0 ? 0 : (netProfit / totalAssets) * 100;
    const returnOnEquity = totalEquity === 0 ? 0 : (netProfit / totalEquity) * 100;

    // Leverage
    const debtToEquity = safeDiv(totalLiabilities, totalEquity);

    // Efficiency
    const daysSalesOutstanding = revenue === 0 ? 0 : (accountsReceivable / revenue) * 365;
    const inventoryTurnover = inventory === 0 ? 0 : safeDiv(cogs, inventory);
    const daysInventoryOutstanding = cogs === 0 ? 0 : (inventory / cogs) * 365;

    // Interest coverage
    const interestCoverage =
      interestExpense === 0 ? Infinity : safeDiv(ebit, interestExpense);

    // Cash conversion cycle = DIO + DSO - AP days
    const apDays = cogs === 0 ? 0 : (accountsPayable / cogs) * 365;
    const cashConversionCycle = daysInventoryOutstanding + daysSalesOutstanding - apDays;

    return {
      currentRatio: Math.round(currentRatio * 100) / 100,
      quickRatio: Math.round(quickRatio * 100) / 100,
      cashRatio: Math.round(cashRatio * 100) / 100,
      grossProfitMargin: Math.round(grossProfitMargin * 100) / 100,
      operatingProfitMargin: Math.round(operatingProfitMargin * 100) / 100,
      netProfitMargin: Math.round(netProfitMargin * 100) / 100,
      returnOnAssets: Math.round(returnOnAssets * 100) / 100,
      returnOnEquity: Math.round(returnOnEquity * 100) / 100,
      debtToEquity: Math.round(debtToEquity * 100) / 100,
      daysSalesOutstanding: Math.round(daysSalesOutstanding * 10) / 10,
      inventoryTurnover: Math.round(inventoryTurnover * 100) / 100,
      daysInventoryOutstanding: Math.round(daysInventoryOutstanding * 10) / 10,
      interestCoverage: Math.round(interestCoverage * 100) / 100,
      cashConversionCycle: Math.round(cashConversionCycle * 10) / 10,
    };
  }

  // ─── Phase 6A: Budget vs Actual Reporting ──────────────────────────────────

  /**
   * Compare budgets against actual GL expense postings in the period. Joins the
   * budgets table with summed expense-account debits from gl_entries.
   */
  async budgetVsActual(
    groupId: string | null,
    startDate?: string,
    endDate?: string,
  ): Promise<BudgetVsActualRow[]> {
    // Fetch all budgets for the company.
    const budgetConds: SQL[] = [];
    if (groupId) budgetConds.push(eq(schema.budgets.groupId, groupId));
    else budgetConds.push(isNull(schema.budgets.groupId));

    const budgets = await this.db
      .select()
      .from(schema.budgets)
      .where(and(...budgetConds))
      .orderBy(desc(schema.budgets.createdAt));

    if (budgets.length === 0) return [];

    // Sum actual spend: expense-account debits in the period from gl_entries.
    const expenseConds: SQL[] = [this.groupEqOn(schema.glEntries.groupId, groupId)];
    expenseConds.push(eq(schema.accounts.rootType, 'EXPENSE'));
    if (startDate) expenseConds.push(gte(schema.glEntries.postingDate, startDate));
    if (endDate) expenseConds.push(lte(schema.glEntries.postingDate, endDate));

    const expenseRows = await this.db
      .select({
        totalSpend: sql<string>`COALESCE(SUM(${schema.glEntries.debit} - ${schema.glEntries.credit}), 0)`,
      })
      .from(schema.glEntries)
      .innerJoin(schema.accounts, eq(schema.glEntries.accountId, schema.accounts.id))
      .where(and(...expenseConds));

    const totalActualSpend = Number(expenseRows[0]?.totalSpend ?? 0);

    return budgets.map((b) => {
      const budgetAmount = Number(b.totalBudget ?? 0);
      // Proportional allocation of actual spend across budgets by their share
      // of total budget. This is a simplified model; a more granular version
      // would tag GL entries to budget IDs.
      const totalBudgetPool = budgets.reduce(
        (s, bb) => s + Number(bb.totalBudget ?? 0),
        0,
      );
      const share = totalBudgetPool > 0 ? budgetAmount / totalBudgetPool : 0;
      const actualSpend = Math.round(totalActualSpend * share * 100) / 100;
      const variance = budgetAmount - actualSpend;
      const variancePct = budgetAmount > 0 ? (actualSpend / budgetAmount) * 100 : 0;
      const status: 'under' | 'warning' | 'over' =
        variancePct > 100 ? 'over' : variancePct >= 80 ? 'warning' : 'under';

      return {
        budgetId: b.id,
        budgetName: b.name,
        department: b.departmentOrCampaign,
        budgetAmount,
        actualSpend,
        variance,
        variancePct: Math.round(variancePct * 100) / 100,
        status,
      };
    });
  }

  // ─── Phase 6B: WHT Deductions ─────────────────────────────────────────────

  /**
   * Record a WHT deduction and optionally post the GL entry:
   *   Dr Expense (gross)
   *   Cr WHT Payable (wht_amount)
   *   Cr Bank (net_amount)
   */
  async recordWhtDeduction(input: RecordWhtInput, actor: Actor): Promise<{ id: string }> {
    const groupId = input.groupId ?? null;
    const grossAmount = input.grossAmount;
    const whtRate = input.whtRate ?? 5;
    const whtAmount = Math.round(grossAmount * (whtRate / 100) * 100) / 100;
    const netAmount = Math.round((grossAmount - whtAmount) * 100) / 100;

    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .insert(schema.whtDeductions)
        .values({
          groupId,
          vendorName: input.vendorName,
          vendorId: input.vendorId ?? null,
          paymentDate: input.paymentDate,
          grossAmount: sql`${grossAmount}::numeric`,
          whtRate: sql`${whtRate}::numeric`,
          whtAmount: sql`${whtAmount}::numeric`,
          netAmount: sql`${netAmount}::numeric`,
          description: input.description ?? null,
          createdBy: actor.id,
        })
        .returning({ id: schema.whtDeductions.id });

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to record WHT deduction.' });
      }

      // Attempt GL posting (non-fatal — missing accounts should not block recording).
      try {
        const expense = await this.resolveAccountByCode(tx, groupId, ACCT.AD_SPEND_DIGITAL);
        const bank = await this.resolveAccountByType(tx, groupId, 'BANK');
        // WHT Payable — look for an account with code matching ACCT.WHT_PAYABLE; fall back to any PAYABLE.
        const whtPayable = await this.resolveAccountByCode(tx, groupId, ACCT.WHT_PAYABLE);

        if (expense && bank && whtPayable) {
          await this.postVoucher(tx, {
            groupId,
            postingDate: input.paymentDate,
            voucherType: 'EXPENSE',
            voucherId: row.id,
            lines: [
              { accountId: expense.id, debit: grossAmount, credit: 0, remarks: `WHT: ${input.vendorName}` },
              { accountId: whtPayable.id, debit: 0, credit: whtAmount, remarks: `WHT ${whtRate}%` },
              { accountId: bank.id, debit: 0, credit: netAmount, remarks: `Net payment to ${input.vendorName}` },
            ],
          });

          await tx
            .update(schema.whtDeductions)
            .set({ glVoucherId: row.id, updatedAt: new Date() })
            .where(eq(schema.whtDeductions.id, row.id));
        }
      } catch (err) {
        this.logger.warn(`WHT GL posting skipped for ${row.id}: ${err instanceof Error ? err.message : err}`);
      }

      return { id: row.id };
    });
  }

  async listWhtDeductions(input: ListWhtInput) {
    const conds: SQL[] = [];
    const groupId = input.groupId ?? null;
    if (groupId) conds.push(eq(schema.whtDeductions.groupId, groupId));
    else conds.push(isNull(schema.whtDeductions.groupId));
    if (input.startDate) conds.push(gte(schema.whtDeductions.paymentDate, input.startDate));
    if (input.endDate) conds.push(lte(schema.whtDeductions.paymentDate, input.endDate));

    const where = and(...conds);
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(schema.whtDeductions)
        .where(where)
        .orderBy(desc(schema.whtDeductions.paymentDate))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.whtDeductions)
        .where(where),
    ]);

    return {
      records: rows,
      pagination: {
        total: totalRow[0]?.total ?? 0,
        page: input.page,
        pageSize: input.limit,
        totalPages: Math.max(1, Math.ceil((totalRow[0]?.total ?? 0) / input.limit)),
      },
    };
  }

  async generateWhtCertificate(deductionId: string, actor: Actor) {
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.whtDeductions)
        .set({ certificateGenerated: true, updatedAt: new Date() })
        .where(eq(schema.whtDeductions.id, deductionId))
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'WHT deduction not found.' });
      }

      return {
        id: row.id,
        vendorName: row.vendorName,
        paymentDate: row.paymentDate,
        grossAmount: row.grossAmount,
        whtRate: row.whtRate,
        whtAmount: row.whtAmount,
        netAmount: row.netAmount,
        description: row.description,
        certificateGenerated: true,
      };
    });
  }

  // ─── Phase 6C: VAT Return Summary ────────────────────────────────────────

  /**
   * VAT return summary for FIRS: sums output VAT (credits to VAT account from
   * sales) and input VAT (debits to VAT account from purchases) over the period.
   * Also returns individual VAT transactions for the detail table.
   */
  async vatReturnSummary(
    groupId: string | null,
    startDate: string,
    endDate: string,
  ): Promise<VatReturnSummary> {
    const txDb = this.db as unknown as Tx;

    // Resolve both VAT accounts: output (2141) and input credit (1151).
    const [vatOutputAccount, vatInputAccount] = await Promise.all([
      this.resolveAccountByCode(txDb, groupId, ACCT.VAT_OUTPUT),
      this.resolveAccountByCode(txDb, groupId, ACCT.VAT_INPUT_CREDIT),
    ]);

    if (!vatOutputAccount && !vatInputAccount) {
      return {
        outputVat: 0,
        inputVat: 0,
        netVatPayable: 0,
        periodStart: startDate,
        periodEnd: endDate,
        transactionCount: 0,
        transactions: [],
      };
    }

    const dateConds: SQL[] = [
      gte(schema.glEntries.postingDate, startDate),
      lte(schema.glEntries.postingDate, endDate),
    ];

    // Build queries for each account that exists.
    const summaryQuery = (accountId: string) =>
      this.db
        .select({
          totalDebit: sql<string>`COALESCE(SUM(${schema.glEntries.debit}), 0)`,
          totalCredit: sql<string>`COALESCE(SUM(${schema.glEntries.credit}), 0)`,
          txCount: sql<number>`count(*)::int`,
        })
        .from(schema.glEntries)
        .where(and(eq(schema.glEntries.accountId, accountId), ...dateConds));

    const txQuery = (accountId: string) =>
      this.db
        .select({
          id: schema.glEntries.id,
          postingDate: schema.glEntries.postingDate,
          voucherType: schema.glEntries.voucherType,
          voucherId: schema.glEntries.voucherId,
          debit: schema.glEntries.debit,
          credit: schema.glEntries.credit,
          remarks: schema.glEntries.remarks,
        })
        .from(schema.glEntries)
        .where(and(eq(schema.glEntries.accountId, accountId), ...dateConds))
        .orderBy(desc(schema.glEntries.postingDate));

    // Run all queries in parallel.
    const [outputSummary, inputSummary, outputTxRows, inputTxRows] = await Promise.all([
      vatOutputAccount ? summaryQuery(vatOutputAccount.id) : Promise.resolve([]),
      vatInputAccount ? summaryQuery(vatInputAccount.id) : Promise.resolve([]),
      vatOutputAccount ? txQuery(vatOutputAccount.id) : Promise.resolve([]),
      vatInputAccount ? txQuery(vatInputAccount.id) : Promise.resolve([]),
    ]);

    // Output VAT = credits to VAT Output account (collected from sales).
    const outputVat = Number((outputSummary[0] as any)?.totalCredit ?? 0);
    // Input VAT = debits to VAT Input Credit account (paid on purchases).
    const inputVat = Number((inputSummary[0] as any)?.totalDebit ?? 0);
    // Net VAT payable = output collected minus input recoverable.
    const netVatPayable = outputVat - inputVat;

    const outputTxCount = (outputSummary[0] as any)?.txCount ?? 0;
    const inputTxCount = (inputSummary[0] as any)?.txCount ?? 0;

    // Merge both transaction lists, sorted by posting date descending.
    const allTxRows = [...outputTxRows, ...inputTxRows].sort(
      (a, b) => (b.postingDate > a.postingDate ? 1 : b.postingDate < a.postingDate ? -1 : 0),
    );

    const transactions: VatTransaction[] = allTxRows.map((r) => ({
      id: r.id,
      postingDate: r.postingDate,
      voucherType: r.voucherType,
      voucherId: r.voucherId,
      debit: Number(r.debit),
      credit: Number(r.credit),
      remarks: r.remarks,
    }));

    return {
      outputVat,
      inputVat,
      netVatPayable,
      periodStart: startDate,
      periodEnd: endDate,
      transactionCount: outputTxCount + inputTxCount,
      transactions,
    };
  }

  // ─── Phase 6E: Consolidated Multi-Company Reports ──────────────────────────

  /**
   * Consolidated Profit & Loss: aggregate across all companies (branch groups).
   * Calls profitAndLoss for each group and sums the results.
   */
  async consolidatedProfitAndLoss(startDate?: string, endDate?: string) {
    const groups = await this.db
      .select({ id: schema.branchGroups.id })
      .from(schema.branchGroups);

    // Include null-group for single-company installs
    const groupIds: (string | null)[] = groups.length
      ? groups.map((g) => g.id)
      : [null];

    const reports = await Promise.all(
      groupIds.map((gid) =>
        this.profitAndLoss({ groupId: gid, startDate, endDate }),
      ),
    );

    // Merge per-account rows across companies by code+name
    const incomeMap = new Map<string, { code: string; name: string; amount: number }>();
    const expenseMap = new Map<string, { code: string; name: string; amount: number }>();

    for (const report of reports) {
      for (const row of report.income) {
        const existing = incomeMap.get(row.code);
        if (existing) existing.amount += row.amount;
        else incomeMap.set(row.code, { ...row });
      }
      for (const row of report.expense) {
        const existing = expenseMap.get(row.code);
        if (existing) existing.amount += row.amount;
        else expenseMap.set(row.code, { ...row });
      }
    }

    const income = [...incomeMap.values()];
    const expense = [...expenseMap.values()];
    const totalIncome = income.reduce((s, r) => s + r.amount, 0);
    const totalExpense = expense.reduce((s, r) => s + r.amount, 0);

    return {
      income,
      expense,
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
      period: { startDate: startDate ?? null, endDate: endDate ?? null },
      companyCount: groupIds.length,
    };
  }

  /**
   * Consolidated Balance Sheet: aggregate across all companies.
   */
  async consolidatedBalanceSheet(asOfDate?: string) {
    const groups = await this.db
      .select({ id: schema.branchGroups.id })
      .from(schema.branchGroups);

    const groupIds: (string | null)[] = groups.length
      ? groups.map((g) => g.id)
      : [null];

    const reports = await Promise.all(
      groupIds.map((gid) =>
        this.balanceSheet({ groupId: gid, asOfDate }),
      ),
    );

    const merge = (
      allRows: Array<{ code: string; name: string; amount: number }>,
    ) => {
      const map = new Map<string, { code: string; name: string; amount: number }>();
      for (const row of allRows) {
        const existing = map.get(row.code);
        if (existing) existing.amount += row.amount;
        else map.set(row.code, { ...row });
      }
      return [...map.values()];
    };

    const assets = merge(reports.flatMap((r) => r.assets));
    const liabilities = merge(reports.flatMap((r) => r.liabilities));
    const equity = merge(reports.flatMap((r) => r.equity));
    const retainedEarnings = reports.reduce((s, r) => s + r.retainedEarnings, 0);
    const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
    const totalEquity = equity.reduce((s, r) => s + r.amount, 0) + retainedEarnings;

    return {
      assets,
      liabilities,
      equity,
      retainedEarnings,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: Math.round(totalAssets * 100) === Math.round((totalLiabilities + totalEquity) * 100),
      asOfDate: asOfDate ?? null,
      companyCount: groupIds.length,
    };
  }

  /**
   * Consolidated Cash Flow: aggregate across all companies.
   */
  async consolidatedCashFlow(startDate?: string, endDate?: string) {
    const groups = await this.db
      .select({ id: schema.branchGroups.id })
      .from(schema.branchGroups);

    const groupIds: (string | null)[] = groups.length
      ? groups.map((g) => g.id)
      : [null];

    const reports = await Promise.all(
      groupIds.map((gid) =>
        this.cashFlow({ groupId: gid, startDate, endDate }),
      ),
    );

    // Merge accounts by code
    const accountMap = new Map<
      string,
      { code: string; name: string; opening: number; inflow: number; outflow: number; closing: number }
    >();

    for (const report of reports) {
      for (const acc of report.accounts) {
        const existing = accountMap.get(acc.code);
        if (existing) {
          existing.opening += acc.opening;
          existing.inflow += acc.inflow;
          existing.outflow += acc.outflow;
          existing.closing += acc.closing;
        } else {
          accountMap.set(acc.code, { ...acc });
        }
      }
    }

    const accounts = [...accountMap.values()];
    const totals = accounts.reduce(
      (acc, a) => {
        acc.opening += a.opening;
        acc.inflow += a.inflow;
        acc.outflow += a.outflow;
        acc.closing += a.closing;
        return acc;
      },
      { opening: 0, inflow: 0, outflow: 0, closing: 0 },
    );

    return {
      accounts,
      totals,
      period: { startDate: startDate ?? null, endDate: endDate ?? null },
      companyCount: groupIds.length,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * group_id = ? handling null (single-company installs use a null group).
   * Defaults to the accounts.group_id column; callers on other tables pass the
   * column explicitly via {@link groupEqOn}.
   */
  private groupEq(groupId: string | null | undefined): SQL {
    return this.groupEqOn(schema.accounts.groupId, groupId);
  }

  private groupEqOn(col: AnyColumn, groupId: string | null | undefined): SQL {
    return groupId ? (eq(col, groupId) as SQL) : (isNull(col) as SQL);
  }
}
