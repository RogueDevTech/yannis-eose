/**
 * Integration test for reverseRemittanceOrderSlice (the multi-order-remittance
 * AR-imbalance fix).
 *
 * Unlike the other GL integration specs, this one COMMITS its seed + posts (no
 * outer BEGIN/ROLLBACK) so the service's own withActor() connection can see the
 * data — then cleans up by voucher/group at the end. It proves the accounting
 * invariant end-to-end: after reversing ONE order's settlement slice out of a
 * multi-order remittance, that customer's Debtors (AR) nets back to zero rather
 * than going negative.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getDb, getPgClient } from '../test/setup-integration';
import { GeneralLedgerService } from './general-ledger.service';

const SKIP = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP)('reverseRemittanceOrderSlice — multi-order remittance AR (Integration)', () => {
  const db = getDb();
  const pgClient = getPgClient();
  const svc = new GeneralLedgerService(db as never);

  // Deterministic ids for cleanup.
  const GROUP_ID = '00000000-0000-4000-8000-00000000f101';
  const ACTOR_ID = '00000000-0000-4000-8000-00000000f102';
  const REMITTANCE_ID = '00000000-0000-4000-8000-00000000f103';
  const acct = { debtors: '', bank: '' };
  const orderIds: string[] = [];
  let LOCATION_ID = '';
  let PROVIDER_ID = '';

  const AMOUNTS = [10000, 15000]; // two orders on one remittance

  beforeAll(async () => {
    // Clean any prior run.
    await cleanup();

    await pgClient`INSERT INTO branch_groups (id, name) VALUES (${GROUP_ID}, 'SliceTest Co') ON CONFLICT DO NOTHING`;
    await pgClient`INSERT INTO users (id, name, email, password_hash, role, scope_global)
      VALUES (${ACTOR_ID}, 'Slice Actor', ${'slice-' + ACTOR_ID + '@test.local'}, 'x', 'FINANCE_OFFICER', true)
      ON CONFLICT DO NOTHING`;

    // Fiscal year covering today (fiscal_years.id has no DB default).
    await pgClient`INSERT INTO fiscal_years (id, group_id, name, start_date, end_date, status)
      VALUES (gen_random_uuid(), ${GROUP_ID}, 'FY-slice', '2026-01-01', '2026-12-31', 'OPEN') ON CONFLICT DO NOTHING`;

    // Leaf accounts for this group.
    const [d] = await db.insert(schema.accounts).values({
      groupId: GROUP_ID, code: 'SLICE-Debtors', name: 'Debtors', rootType: 'ASSET', accountType: 'RECEIVABLE' as never, isGroup: false,
    }).returning({ id: schema.accounts.id });
    const [b] = await db.insert(schema.accounts).values({
      groupId: GROUP_ID, code: 'SLICE-Bank', name: 'Bank', rootType: 'ASSET', accountType: 'BANK' as never, isGroup: false,
    }).returning({ id: schema.accounts.id });
    acct.debtors = d!.id; acct.bank = b!.id;

    // A branch in this group so orders resolve group via servicing branch.
    const [branch] = await db.insert(schema.branches).values({
      name: 'SliceBranch', code: 'SLICE-BR', groupId: GROUP_ID,
    } as never).returning({ id: schema.branches.id });

    // Logistics provider + location (delivery_remittances requires a location).
    const [prov] = await db.insert(schema.logisticsProviders).values({ name: 'SliceProv' } as never)
      .returning({ id: schema.logisticsProviders.id });
    const [loc] = await db.insert(schema.logisticsLocations).values({
      providerId: (prov as { id: string }).id, name: 'SliceLoc', address: 'x',
    } as never).returning({ id: schema.logisticsLocations.id });
    LOCATION_ID = (loc as { id: string }).id;
    PROVIDER_ID = (prov as { id: string }).id;

    // Map BANK_PRIMARY + AR so resolveAccountForPosting / resolveAccountByType find them.
    await pgClient`INSERT INTO gl_account_mappings (group_id, mapping_key, account_id)
      VALUES (${GROUP_ID}, 'BANK_PRIMARY', ${acct.bank}) ON CONFLICT DO NOTHING`;

    // Two delivered orders + a remittance linking both.
    await pgClient`INSERT INTO delivery_remittances (id, status, received_at, logistics_location_id, sent_by)
      VALUES (${REMITTANCE_ID}, 'RECEIVED', now(), ${LOCATION_ID}, ${ACTOR_ID}) ON CONFLICT DO NOTHING`;
    for (const amt of AMOUNTS) {
      const [o] = await db.insert(schema.orders).values({
        status: 'REMITTED', totalAmount: String(amt), deliveryFee: '0',
        customerName: 'Cust', customerPhone: '0', customerPhoneHash: 'h', customerAddress: 'a',
        servicingBranchId: (branch as { id: string }).id, items: [],
      } as never).returning({ id: schema.orders.id });
      orderIds.push((o as { id: string }).id);
      await pgClient`INSERT INTO delivery_remittance_orders (delivery_remittance_id, order_id)
        VALUES (${REMITTANCE_ID}, ${(o as { id: string }).id})`;
    }
  });

  afterAll(async () => { await cleanup(); });

  async function acctNet(accountId: string): Promise<number> {
    const [row] = await db
      .select({ net: sql<string>`COALESCE(SUM(${schema.glEntries.debit} - ${schema.glEntries.credit}), 0)` })
      .from(schema.glEntries)
      .where(eq(schema.glEntries.accountId, accountId));
    return Number(row?.net ?? 0);
  }

  async function cleanup() {
    // gl_entries is append-only (enforced by trigger); bypass triggers for the
    // test teardown only.
    await pgClient`SET session_replication_role = replica`.catch(() => {});
    if (orderIds.length) {
      await pgClient`DELETE FROM gl_entries WHERE group_id = ${GROUP_ID}`.catch(() => {});
      await pgClient`DELETE FROM journal_entries WHERE group_id = ${GROUP_ID}`.catch(() => {});
      await pgClient`DELETE FROM delivery_remittance_orders WHERE delivery_remittance_id = ${REMITTANCE_ID}`.catch(() => {});
      await pgClient`DELETE FROM orders WHERE id = ANY(${orderIds})`.catch(() => {});
    }
    await pgClient`DELETE FROM delivery_remittances WHERE id = ${REMITTANCE_ID}`.catch(() => {});
    if (LOCATION_ID) await pgClient`DELETE FROM logistics_locations WHERE id = ${LOCATION_ID}`.catch(() => {});
    if (PROVIDER_ID) await pgClient`DELETE FROM logistics_providers WHERE id = ${PROVIDER_ID}`.catch(() => {});
    await pgClient`DELETE FROM gl_account_mappings WHERE group_id = ${GROUP_ID}`.catch(() => {});
    await pgClient`DELETE FROM accounts WHERE group_id = ${GROUP_ID}`.catch(() => {});
    await pgClient`DELETE FROM fiscal_years WHERE group_id = ${GROUP_ID}`.catch(() => {});
    await pgClient`DELETE FROM branches WHERE group_id = ${GROUP_ID}`.catch(() => {});
    await pgClient`DELETE FROM branch_groups WHERE id = ${GROUP_ID}`.catch(() => {});
    await pgClient`SET session_replication_role = origin`.catch(() => {});
  }

  it('post settlement then reverse ONE order slice → that order Debtors nets to zero, others untouched', async () => {
    const actor = { id: ACTOR_ID };

    // 1. Simulate the sale side for BOTH orders: Dr Debtors / Cr Sale isn't needed
    //    for this invariant — we test the settlement + slice-reversal interaction.
    //    Post the remittance settlement (single PAYMENT voucher, per-order Cr Debtors).
    const settled = await svc.postRemittanceSettlement(REMITTANCE_ID, actor);
    expect(settled.posted, `settlement declined: ${settled.reason}`).toBe(true);

    // After settlement: Debtors credited by total of both orders (25000).
    const debtorsAfterSettle = await acctNet(acct.debtors);
    expect(debtorsAfterSettle).toBe(-(AMOUNTS[0]! + AMOUNTS[1]!)); // Cr = negative net

    // 2. Reverse ONLY the first order's slice (as the retrack/delete flow now does
    //    for a multi-order remittance).
    const rev = await svc.reverseRemittanceOrderSlice(REMITTANCE_ID, orderIds[0]!, actor, 'test retract');
    expect(rev.reversed).toBe(true);

    // Debtors should now reflect only the SECOND order's settlement credit
    // (the first order's slice was reversed: Dr Debtors 10000 cancels its Cr).
    const debtorsAfterSlice = await acctNet(acct.debtors);
    expect(debtorsAfterSlice).toBe(-AMOUNTS[1]!); // only order 2's -15000 remains

    // 3. Idempotency: a second slice reversal must NOT double-apply.
    const again = await svc.reverseRemittanceOrderSlice(REMITTANCE_ID, orderIds[0]!, actor, 'test retract retry');
    expect(again.reversed).toBe(false);
    expect(again.reason).toBe('already-reversed');
    expect(await acctNet(acct.debtors)).toBe(-AMOUNTS[1]!); // unchanged
  });
});
