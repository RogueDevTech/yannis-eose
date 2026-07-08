/**
 * Integration tests: double-entry general ledger.
 *
 * Exercises the REAL GeneralLedgerService methods against a live Postgres
 * (yannis_test). Each test runs inside a BEGIN/ROLLBACK so nothing persists.
 *
 * Covers: balanced posting + rejection, account-type resolution, fiscal-year
 * period lock, sales-invoice posting (AR + FIFO COGS), remittance settlement
 * (AR loop closes), purchase receipt (Stock/Creditors), voucher reversal
 * (nets to zero + idempotent), trial balance, P&L, balance sheet, cash flow,
 * aging, and opening balances.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser } from '../test/factories/order.factory';
import { GeneralLedgerService } from './general-ledger.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('General Ledger — Integration', () => {
  const pgClient = getPgClient();
  const db = getDb();
  const svc = new GeneralLedgerService(db as never);

  // NOTE: this suite does NOT use BEGIN/ROLLBACK isolation. The services under
  // test open their own transactions (withActor → db.transaction()), which in
  // postgres.js run on a connection that can't see an outer manual BEGIN's
  // uncommitted rows. So we commit real rows and truncate between tests instead.
  async function truncateAll() {
    await pgClient.unsafe(
      `TRUNCATE TABLE
         gl_entries, journal_entries, fiscal_years, accounts,
         delivery_remittance_orders, delivery_remittances,
         shipment_lines, shipments,
         order_items, orders,
         logistics_locations, logistics_providers,
         products, branch_groups, users
       RESTART IDENTITY CASCADE`,
    );
  }

  beforeEach(async () => {
    await truncateAll();
  });
  afterAll(async () => {
    await truncateAll();
    await closeConnections();
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  type AcctSeed = {
    code: string;
    name: string;
    rootType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
    accountType?: string | null;
    isGroup?: boolean;
  };

  /** Insert a minimal set of leaf accounts and return a code→id map. */
  async function seedAccounts(seeds: AcctSeed[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const s of seeds) {
      const [row] = await db
        .insert(schema.accounts)
        .values({
          code: s.code,
          name: s.name,
          rootType: s.rootType,
          accountType: (s.accountType ?? null) as never,
          isGroup: s.isGroup ?? false,
        })
        .returning({ id: schema.accounts.id });
      map.set(s.code, row!.id);
    }
    return map;
  }

  async function seedFiscalYear(status: 'OPEN' | 'CLOSED' = 'OPEN') {
    await db.insert(schema.fiscalYears).values({
      name: '2026',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status,
    });
  }

  const DEFAULT_ACCOUNTS: AcctSeed[] = [
    { code: 'Debtors', name: 'Debtors', rootType: 'ASSET', accountType: 'RECEIVABLE' },
    { code: 'Sale', name: 'Sale', rootType: 'INCOME' },
    { code: 'Cost of Goods Sold', name: 'COGS', rootType: 'EXPENSE', accountType: 'COST_OF_GOODS_SOLD' },
    { code: 'Stock In Hand', name: 'Stock In Hand', rootType: 'ASSET', accountType: 'STOCK' },
    { code: 'First Bank', name: 'First Bank', rootType: 'ASSET', accountType: 'BANK' },
    { code: 'Delivery Fees', name: 'Delivery Fees', rootType: 'EXPENSE', accountType: 'INDIRECT_EXPENSE' },
    { code: 'Discount Fees', name: 'Discount Fees', rootType: 'EXPENSE', accountType: 'INDIRECT_EXPENSE' },
    { code: 'Creditors', name: 'Creditors', rootType: 'LIABILITY', accountType: 'PAYABLE' },
    { code: 'Opening Balance Equity', name: 'Opening Balance Equity', rootType: 'EQUITY', accountType: 'EQUITY' },
  ];

  async function acctNet(accountId: string): Promise<number> {
    const [row] = await db
      .select({
        net: sql<string>`COALESCE(SUM(${schema.glEntries.debit} - ${schema.glEntries.credit}), 0)`,
      })
      .from(schema.glEntries)
      .where(eq(schema.glEntries.accountId, accountId));
    return Number(row?.net ?? 0);
  }

  // ── Journal entries (postVoucher via createJournalEntry) ─────────────────────

  it('posts a balanced journal entry and updates account balances', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    const je = await svc.createJournalEntry(
      {
        groupId: null,
        postingDate: '2026-06-10',
        description: 'Test JE',
        lines: [
          { accountId: acc.get('First Bank')!, debit: 1000, credit: 0 },
          { accountId: acc.get('Sale')!, debit: 0, credit: 1000 },
        ],
      },
      { id: actor.id },
    );

    expect(je.status).toBe('POSTED');
    expect(await acctNet(acc.get('First Bank')!)).toBe(1000);
    expect(await acctNet(acc.get('Sale')!)).toBe(-1000);

    const [bank] = await db
      .select({ balance: schema.accounts.balance })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, acc.get('First Bank')!));
    expect(Number(bank!.balance)).toBe(1000);
  });

  it('rejects an unbalanced journal entry and writes nothing', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    await expect(
      svc.createJournalEntry(
        {
          groupId: null,
          postingDate: '2026-06-10',
          description: 'Bad JE',
          lines: [
            { accountId: acc.get('First Bank')!, debit: 100, credit: 0 },
            { accountId: acc.get('Sale')!, debit: 0, credit: 90 },
          ],
        },
        { id: actor.id },
      ),
    ).rejects.toThrow(/[Uu]nbalanced/);

    const countRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.glEntries);
    expect(countRows[0]?.n ?? 0).toBe(0);
  });

  it('rejects posting into a period with no fiscal year', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    // No fiscal year seeded.
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    await expect(
      svc.createJournalEntry(
        {
          groupId: null,
          postingDate: '2026-06-10',
          description: 'No FY',
          lines: [
            { accountId: acc.get('First Bank')!, debit: 100, credit: 0 },
            { accountId: acc.get('Sale')!, debit: 0, credit: 100 },
          ],
        },
        { id: actor.id },
      ),
    ).rejects.toThrow(/fiscal year/i);
  });

  it('rejects posting to a group (non-leaf) account', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts([
      ...DEFAULT_ACCOUNTS,
      { code: 'Income', name: 'Income', rootType: 'INCOME', isGroup: true },
    ]);

    await expect(
      svc.createJournalEntry(
        {
          groupId: null,
          postingDate: '2026-06-10',
          description: 'Group post',
          lines: [
            { accountId: acc.get('First Bank')!, debit: 100, credit: 0 },
            { accountId: acc.get('Income')!, debit: 0, credit: 100 },
          ],
        },
        { id: actor.id },
      ),
    ).rejects.toThrow(/group account/i);
  });

  // ── Phase 2: sales invoice posting ───────────────────────────────────────────

  it('posts sales invoice AR + FIFO COGS on a delivered order', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    // Delivered order: revenue 60000, landed cost 40000, no branch (group null).
    const [ord] = await db
      .insert(schema.orders)
      .values({
        customerName: 'Jane Doe',
        customerPhoneHash: `h-${randomUUID()}`,
        status: 'DELIVERED',
        totalAmount: '60000',
        landedCost: '40000',
        deliveredAt: new Date('2026-06-10'),
      })
      .returning({ id: schema.orders.id });

    const res = await svc.postSalesInvoice(ord!.id, { id: actor.id });
    expect(res.posted).toBe(true);

    expect(await acctNet(acc.get('Debtors')!)).toBe(60000);
    expect(await acctNet(acc.get('Sale')!)).toBe(-60000);
    expect(await acctNet(acc.get('Cost of Goods Sold')!)).toBe(40000);
    expect(await acctNet(acc.get('Stock In Hand')!)).toBe(-40000);
  });

  it('is idempotent — posting the same sale twice posts once', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    const [ord] = await db
      .insert(schema.orders)
      .values({
        customerName: 'Jane',
        customerPhoneHash: `h-${randomUUID()}`,
        status: 'DELIVERED',
        totalAmount: '60000',
        landedCost: '40000',
        deliveredAt: new Date('2026-06-10'),
      })
      .returning({ id: schema.orders.id });

    const first = await svc.postSalesInvoice(ord!.id, { id: actor.id });
    const second = await svc.postSalesInvoice(ord!.id, { id: actor.id });
    expect(first.posted).toBe(true);
    expect(second.posted).toBe(false);
    expect(second.reason).toBe('already-posted');
    expect(await acctNet(acc.get('Debtors')!)).toBe(60000);
  });

  // ── Phase 3: remittance settlement closes the AR loop ─────────────────────────

  it('remittance settlement nets the delivered order AR back to zero', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    const [ord] = await db
      .insert(schema.orders)
      .values({
        customerName: 'Jane',
        customerPhoneHash: `h-${randomUUID()}`,
        status: 'DELIVERED',
        totalAmount: '60000',
        landedCost: '40000',
        deliveryFee: '2000',
        deliveredAt: new Date('2026-06-10'),
      })
      .returning({ id: schema.orders.id });

    await svc.postSalesInvoice(ord!.id, { id: actor.id });
    expect(await acctNet(acc.get('Debtors')!)).toBe(60000);

    const [prov] = await db
      .insert(schema.logisticsProviders)
      .values({ name: `P-${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.logisticsProviders.id });
    const [loc] = await db
      .insert(schema.logisticsLocations)
      .values({ providerId: prov!.id, name: 'Loc', address: 'Lagos' })
      .returning({ id: schema.logisticsLocations.id });
    const [rem] = await db
      .insert(schema.deliveryRemittances)
      .values({
        logisticsLocationId: loc!.id,
        sentBy: actor.id,
        receiptUrls: [],
        status: 'RECEIVED',
        commitmentFee: '1000',
        receivedAt: new Date('2026-06-15'),
      })
      .returning({ id: schema.deliveryRemittances.id });
    await db.insert(schema.deliveryRemittanceOrders).values({
      deliveryRemittanceId: rem!.id,
      orderId: ord!.id,
    });

    const res = await svc.postRemittanceSettlement(rem!.id, { id: actor.id });
    expect(res.posted).toBe(true);

    // AR back to zero (sale debited 60k, settlement credited 60k).
    expect(await acctNet(acc.get('Debtors')!)).toBe(0);
    // Bank got cash = 60000 - deliveryFee 2000 - commitment 1000 = 57000.
    expect(await acctNet(acc.get('First Bank')!)).toBe(57000);
    expect(await acctNet(acc.get('Delivery Fees')!)).toBe(2000);
    expect(await acctNet(acc.get('Discount Fees')!)).toBe(1000);
  });

  // ── Phase 4: purchase receipt ────────────────────────────────────────────────

  it('purchase receipt debits Stock In Hand and credits Creditors', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    const [prov] = await db
      .insert(schema.logisticsProviders)
      .values({ name: `P-${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.logisticsProviders.id });
    const [loc] = await db
      .insert(schema.logisticsLocations)
      .values({ providerId: prov!.id, name: 'WH', address: 'Lagos' })
      .returning({ id: schema.logisticsLocations.id });
    const [ship] = await db
      .insert(schema.shipments)
      .values({
        destinationLocationId: loc!.id,
        supplierName: 'Acme',
        status: 'VERIFIED',
        totalLandingCost: '5000',
        verifiedAt: new Date('2026-06-01'),
      })
      .returning({ id: schema.shipments.id });
    // products.group_id is NOT NULL on a fully-migrated DB — seed a branch group.
    const [grp] = await db
      .insert(schema.branchGroups)
      .values({ name: `Grp-${randomUUID().slice(0, 8)}`, status: 'ACTIVE' })
      .returning({ id: schema.branchGroups.id });
    const [prod] = await db
      .insert(schema.products)
      .values({ name: `Prod-${randomUUID().slice(0, 8)}`, baseSalePrice: '10000', groupId: grp!.id })
      .returning({ id: schema.products.id });
    await db.insert(schema.shipmentLines).values({
      shipmentId: ship!.id,
      productId: prod!.id,
      expectedQuantity: 10,
      receivedQuantity: 10,
      factoryCost: '3500', // 10×3500 = 35000 + 5000 landing = 40000
      allocatedLandingCost: '5000',
    });

    const res = await svc.postPurchaseReceipt(ship!.id, { id: actor.id });
    expect(res.posted).toBe(true);
    expect(await acctNet(acc.get('Stock In Hand')!)).toBe(40000);
    expect(await acctNet(acc.get('Creditors')!)).toBe(-40000);
  });

  // ── Reversal ─────────────────────────────────────────────────────────────────

  it('reverseVoucher nets every account to zero and is idempotent', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    const [ord] = await db
      .insert(schema.orders)
      .values({
        customerName: 'Jane',
        customerPhoneHash: `h-${randomUUID()}`,
        status: 'DELIVERED',
        totalAmount: '60000',
        landedCost: '40000',
        deliveredAt: new Date('2026-06-10'),
      })
      .returning({ id: schema.orders.id });

    await svc.postSalesInvoice(ord!.id, { id: actor.id });
    const rev = await svc.reverseVoucher('SALES_INVOICE', ord!.id, { id: actor.id }, 'retract');
    expect(rev.reversed).toBe(true);

    for (const code of ['Debtors', 'Sale', 'Cost of Goods Sold', 'Stock In Hand']) {
      expect(await acctNet(acc.get(code)!)).toBe(0);
    }

    // Second reversal is a no-op.
    const again = await svc.reverseVoucher('SALES_INVOICE', ord!.id, { id: actor.id });
    expect(again.reversed).toBe(false);
    expect(again.reason).toBe('already-reversed');
  });

  // ── Statements ───────────────────────────────────────────────────────────────

  it('trial balance, P&L, and balance sheet reconcile after a sale', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    await seedAccounts(DEFAULT_ACCOUNTS);

    const [ord] = await db
      .insert(schema.orders)
      .values({
        customerName: 'Jane',
        customerPhoneHash: `h-${randomUUID()}`,
        status: 'DELIVERED',
        totalAmount: '60000',
        landedCost: '40000',
        deliveredAt: new Date('2026-06-10'),
      })
      .returning({ id: schema.orders.id });
    await svc.postSalesInvoice(ord!.id, { id: actor.id });

    const tb = await svc.trialBalance({ groupId: null });
    expect(tb.totals.balanced).toBe(true);

    const pl = await svc.profitAndLoss({ groupId: null, startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(pl.totalIncome).toBe(60000);
    expect(pl.totalExpense).toBe(40000); // COGS = FIFO landed cost, not sale price
    expect(pl.netProfit).toBe(20000);

    const bs = await svc.balanceSheet({ groupId: null, asOfDate: '2026-12-31' });
    expect(bs.balanced).toBe(true);
  });

  it('cash flow reflects bank inflow from a settlement', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    await svc.createJournalEntry(
      {
        groupId: null,
        postingDate: '2026-06-10',
        description: 'cash in',
        lines: [
          { accountId: acc.get('First Bank')!, debit: 5000, credit: 0 },
          { accountId: acc.get('Sale')!, debit: 0, credit: 5000 },
        ],
      },
      { id: actor.id },
    );

    const cf = await svc.cashFlow({ groupId: null, startDate: '2026-06-01', endDate: '2026-06-30' });
    expect(cf.totals.inflow).toBe(5000);
    expect(cf.totals.closing).toBe(5000);
  });

  it('AR aging buckets receivables by posting-date age', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    // Two AR postings at different ages relative to the as-of date.
    for (const [date, amount, party] of [
      ['2026-06-10', 5000, 'Recent Co'], // ~5 days before as-of
      ['2026-05-01', 8000, 'Old Co'], // ~45 days before as-of
    ] as const) {
      await svc.createJournalEntry(
        {
          groupId: null,
          postingDate: date,
          description: party,
          lines: [
            { accountId: acc.get('Debtors')!, debit: amount, credit: 0, partyType: 'CUSTOMER', remarks: party },
            { accountId: acc.get('Sale')!, debit: 0, credit: amount },
          ],
        },
        { id: actor.id },
      );
    }

    const aging = await svc.aging({ groupId: null, kind: 'RECEIVABLE', asOfDate: '2026-06-15' });
    expect(aging.parties.length).toBe(2);
    expect(aging.totals.total).toBe(13000);
    expect(aging.totals.b0_30).toBe(5000); // Recent Co
    expect(aging.totals.b31_60).toBe(8000); // Old Co
  });

  // ── Opening balances ─────────────────────────────────────────────────────────

  it('opening balances auto-plug the residual to Opening Balance Equity', async () => {
    const actor = await createTestUser(db as never, { role: 'FINANCE_OFFICER' });
    await setSessionActor(pgClient, actor.id);
    await seedFiscalYear();
    const acc = await seedAccounts(DEFAULT_ACCOUNTS);

    // Only a debit provided — residual should credit Opening Balance Equity.
    await svc.postOpeningBalances(
      {
        groupId: null,
        postingDate: '2026-01-01',
        lines: [{ accountId: acc.get('First Bank')!, debit: 250000, credit: 0 }],
      },
      { id: actor.id },
    );

    expect(await acctNet(acc.get('First Bank')!)).toBe(250000);
    expect(await acctNet(acc.get('Opening Balance Equity')!)).toBe(-250000);

    const tb = await svc.trialBalance({ groupId: null });
    expect(tb.totals.balanced).toBe(true);
  });
});
