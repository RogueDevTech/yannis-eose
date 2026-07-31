/**
 * Integration test for syncRemittedToSourceTables — the parent→child status
 * mirror that keeps cart_orders / follow_up_orders in step with their graduated
 * `orders` copy after remittance.
 *
 * Regression context: the sync-back used to carry a `status = 'DELIVERED'`-only
 * guard, so a child row lagging at CS_ENGAGED / AGENT_ASSIGNED was silently
 * skipped and drifted permanently (the graduated parent read REMITTED while its
 * cart_orders origin stayed pre-delivery). This surfaced as a dashboard mismatch
 * (Cart Orders "Remitted": 381 in the TOTAL breakdown vs 377 on the standalone
 * strip). The fix makes the child mirror the parent to REMITTED from ANY live
 * state, touching only non-REMITTED, non-deleted rows.
 *
 * Like the other logistics/finance integration specs, this COMMITS its seed (no
 * outer BEGIN/ROLLBACK) so the service's own connection sees the data, then
 * cleans up by deterministic id. FK triggers are bypassed for seed/teardown only
 * (session_replication_role = replica) to keep the fixture minimal.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getDb, getPgClient } from '../test/setup-integration';
import { syncRemittedToSourceTables } from './logistics.service';

const SKIP = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP)('syncRemittedToSourceTables — parent→child REMITTED mirror (Integration)', () => {
  const db = getDb();
  const pgClient = getPgClient();

  // Deterministic ids for cleanup.
  const GROUP_ID = '00000000-0000-4000-8000-00000000e200';
  const BRANCH_ID = '00000000-0000-4000-8000-00000000e201';
  const ABANDON_ID = '00000000-0000-4000-8000-00000000e202';
  const CART_ORDER_ID = '00000000-0000-4000-8000-00000000e204';
  const CART_PARENT_ID = '00000000-0000-4000-8000-00000000e205';
  const FU_ORDER_ID = '00000000-0000-4000-8000-00000000e206';
  const FU_PARENT_ID = '00000000-0000-4000-8000-00000000e207';
  const DELETED_CART_ORDER_ID = '00000000-0000-4000-8000-00000000e208';
  const DELETED_CART_PARENT_ID = '00000000-0000-4000-8000-00000000e209';

  beforeAll(async () => {
    await cleanup();
    await pgClient`SET session_replication_role = replica`.catch(() => {});
    // A group + branch (scopes the phone-hash fallback; FK targets don't matter here).
    await pgClient`INSERT INTO branch_groups (id, name) VALUES (${GROUP_ID}, 'SyncTest Co') ON CONFLICT DO NOTHING`;
    await pgClient`INSERT INTO branches (id, name, code, group_id) VALUES (${BRANCH_ID}, 'SyncTest Branch', 'SYNC-BR', ${GROUP_ID}) ON CONFLICT DO NOTHING`;
    // cart_abandonments parent (cart_orders.source_cart_id FK, notNull).
    await pgClient`INSERT INTO cart_abandonments (id, campaign_id, customer_name, customer_phone_hash, status)
      VALUES (${ABANDON_ID}, ${BRANCH_ID}, 'Cust', 'hash-sync', 'PENDING') ON CONFLICT DO NOTHING`;
    await pgClient`SET session_replication_role = origin`.catch(() => {});
  });

  afterAll(async () => { await cleanup(); });

  // Reset child + parent rows before each test so cases are independent.
  beforeEach(async () => {
    await pgClient`SET session_replication_role = replica`.catch(() => {});
    await pgClient`DELETE FROM cart_orders WHERE id = ANY(${[CART_ORDER_ID, DELETED_CART_ORDER_ID]})`.catch(() => {});
    await pgClient`DELETE FROM follow_up_orders WHERE id = ${FU_ORDER_ID}`.catch(() => {});
    await pgClient`DELETE FROM orders WHERE id = ANY(${[CART_PARENT_ID, FU_PARENT_ID, DELETED_CART_PARENT_ID]})`.catch(() => {});
    await pgClient`SET session_replication_role = origin`.catch(() => {});
  });

  async function seedCartChild(childStatus: string, deleted = false, id = CART_ORDER_ID) {
    await pgClient`SET session_replication_role = replica`.catch(() => {});
    await pgClient`INSERT INTO cart_orders
      (id, source_cart_id, customer_name, customer_phone_hash, status, servicing_branch_id, deleted_at)
      VALUES (${id}, ${ABANDON_ID}, 'Cust', 'hash-sync', ${childStatus}, ${BRANCH_ID}, ${deleted ? pgClient`now()` : null})`;
    await pgClient`SET session_replication_role = origin`.catch(() => {});
  }

  // Graduated parent order: REMITTED, order_source 'online', linked to the child.
  async function seedCartParent(parentId = CART_PARENT_ID, childId = CART_ORDER_ID) {
    await pgClient`SET session_replication_role = replica`.catch(() => {});
    await pgClient`INSERT INTO orders
      (id, status, order_source, is_follow_up, customer_name, customer_phone_hash, customer_address,
       servicing_branch_id, source_cart_order_id, total_amount, delivery_fee)
      VALUES (${parentId}, 'REMITTED', 'online', false, 'Cust', 'hash-sync', 'addr',
       ${BRANCH_ID}, ${childId}, '10000', '0')`;
    await pgClient`SET session_replication_role = origin`.catch(() => {});
  }

  function remittedRow(id: string, isFollowUp = false) {
    return {
      id,
      orderSource: isFollowUp ? null : 'online',
      isFollowUp,
      customerPhoneHash: 'hash-sync',
      servicingBranchId: BRANCH_ID,
    };
  }

  async function cartStatus(id = CART_ORDER_ID): Promise<string | undefined> {
    const [row] = await db
      .select({ status: schema.cartOrders.status })
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, id));
    return row?.status;
  }

  async function cleanup() {
    await pgClient`SET session_replication_role = replica`.catch(() => {});
    await pgClient`DELETE FROM cart_orders WHERE id = ANY(${[CART_ORDER_ID, DELETED_CART_ORDER_ID]})`.catch(() => {});
    await pgClient`DELETE FROM follow_up_orders WHERE id = ${FU_ORDER_ID}`.catch(() => {});
    await pgClient`DELETE FROM orders WHERE id = ANY(${[CART_PARENT_ID, FU_PARENT_ID, DELETED_CART_PARENT_ID]})`.catch(() => {});
    await pgClient`DELETE FROM cart_abandonments WHERE id = ${ABANDON_ID}`.catch(() => {});
    await pgClient`DELETE FROM branches WHERE id = ${BRANCH_ID}`.catch(() => {});
    await pgClient`DELETE FROM branch_groups WHERE id = ${GROUP_ID}`.catch(() => {});
    await pgClient`SET session_replication_role = origin`.catch(() => {});
  }

  it('syncs a DELIVERED child to REMITTED (the always-worked baseline)', async () => {
    await seedCartChild('DELIVERED');
    await seedCartParent();
    await syncRemittedToSourceTables(db as never, [remittedRow(CART_PARENT_ID)]);
    expect(await cartStatus()).toBe('REMITTED');
  });

  it('REGRESSION: syncs a child lagging at AGENT_ASSIGNED (was silently skipped by the DELIVERED-only guard)', async () => {
    await seedCartChild('AGENT_ASSIGNED');
    await seedCartParent();
    await syncRemittedToSourceTables(db as never, [remittedRow(CART_PARENT_ID)]);
    expect(await cartStatus()).toBe('REMITTED');
  });

  it('REGRESSION: syncs a child lagging even further back at CS_ENGAGED', async () => {
    await seedCartChild('CS_ENGAGED');
    await seedCartParent();
    await syncRemittedToSourceTables(db as never, [remittedRow(CART_PARENT_ID)]);
    expect(await cartStatus()).toBe('REMITTED');
  });

  it('does NOT touch a deleted child row (deleted_at guard preserved)', async () => {
    await seedCartChild('DELIVERED', /* deleted */ true, DELETED_CART_ORDER_ID);
    await seedCartParent(DELETED_CART_PARENT_ID, DELETED_CART_ORDER_ID);
    await syncRemittedToSourceTables(db as never, [remittedRow(DELETED_CART_PARENT_ID)]);
    // Still DELIVERED (untouched) — a remittance must not resurrect/relabel a deleted cart row.
    expect(await cartStatus(DELETED_CART_ORDER_ID)).toBe('DELIVERED');
  });

  it('is idempotent — re-running on an already-REMITTED child leaves it REMITTED', async () => {
    await seedCartChild('AGENT_ASSIGNED');
    await seedCartParent();
    await syncRemittedToSourceTables(db as never, [remittedRow(CART_PARENT_ID)]);
    await syncRemittedToSourceTables(db as never, [remittedRow(CART_PARENT_ID)]);
    expect(await cartStatus()).toBe('REMITTED');
  });

  it('mirrors a follow-up child lagging at CS_ENGAGED to REMITTED via the FK path', async () => {
    // Follow-up child stuck pre-delivery.
    await pgClient`SET session_replication_role = replica`.catch(() => {});
    await pgClient`INSERT INTO follow_up_orders
      (id, customer_name, customer_phone_hash, status, servicing_branch_id)
      VALUES (${FU_ORDER_ID}, 'Cust', 'hash-sync', 'CS_ENGAGED', ${BRANCH_ID})`;
    // Graduated follow-up parent: is_follow_up=true, linked via source_follow_up_order_id.
    await pgClient`INSERT INTO orders
      (id, status, is_follow_up, customer_name, customer_phone_hash, customer_address,
       servicing_branch_id, source_follow_up_order_id, total_amount, delivery_fee)
      VALUES (${FU_PARENT_ID}, 'REMITTED', true, 'Cust', 'hash-sync', 'addr',
       ${BRANCH_ID}, ${FU_ORDER_ID}, '10000', '0')`;
    await pgClient`SET session_replication_role = origin`.catch(() => {});

    await syncRemittedToSourceTables(db as never, [remittedRow(FU_PARENT_ID, /* isFollowUp */ true)]);

    const [row] = await db
      .select({ status: schema.followUpOrders.status })
      .from(schema.followUpOrders)
      .where(eq(schema.followUpOrders.id, FU_ORDER_ID));
    expect(row?.status).toBe('REMITTED');
  });
});
