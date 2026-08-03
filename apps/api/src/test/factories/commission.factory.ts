/**
 * Test factories for commission and HR integration tests.
 */

import { randomUUID } from 'crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { createTestProduct, createTestUser } from './order.factory';

export async function createTestCommissionPlan(
  db: PostgresJsDatabase<typeof schema>,
  overrides: {
    /** Omit for default CS_CLOSER — pass `null` for universal (per-user) templates. */
    role?: string | null;
    baseSalary?: number;
    baseThreshold?: number;
    perOrderRate?: number;
    deliveryRateThreshold?: number;
    bonusPerExtraOrder?: number;
    penaltyPerReturn?: number;
    createdBy?: string;
  } = {},
) {
  const rules = {
    baseSalary: overrides.baseSalary ?? 50000,
    baseThreshold: overrides.baseThreshold ?? 50,
    perOrderRate: overrides.perOrderRate ?? 1000,
    deliveryRateThreshold: overrides.deliveryRateThreshold ?? 80,
    bonusPerExtraOrder: overrides.bonusPerExtraOrder ?? 500,
    penaltyPerReturn: overrides.penaltyPerReturn ?? 200,
  };

  // commission_plans.created_by has an FK to users — a random UUID violates it.
  // Create a real HR user as the author when the caller doesn't supply one.
  const createdBy = overrides.createdBy ?? (await createTestUser(db, { role: 'HR_MANAGER' })).id;

  const [inserted] = await db.insert(schema.commissionPlans).values({
    role:
      overrides.role === undefined
        ? ('CS_CLOSER' as (typeof schema.commissionPlans.$inferInsert)['role'])
        : (overrides.role as (typeof schema.commissionPlans.$inferInsert)['role'] | null),
    planName: `Test Plan ${randomUUID().slice(0, 8)}`,
    rules,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    createdBy,
  }).returning({ id: schema.commissionPlans.id });

  const id = inserted!.id;
  return { id, rules };
}

export async function createTestDeliveredOrder(
  db: PostgresJsDatabase<typeof schema>,
  overrides: {
    assignedCsId?: string;
    mediaBuyerId?: string;
    branchId?: string;
    deliveredAt?: Date;
    productId?: string;
  } = {},
) {
  // order_items.product_id has an FK to products — a random UUID violates it.
  const productId = overrides.productId ?? (await createTestProduct(db)).id;
  const deliveredAt = overrides.deliveredAt ?? new Date();

  const [insertedOrder] = await db.insert(schema.orders).values({
    customerName: 'Delivered Order Customer',
    customerPhoneHash: `hash-${randomUUID()}`,
    customerPhone: '08000000000',
    status: 'DELIVERED',
    assignedCsId: overrides.assignedCsId ?? null,
    mediaBuyerId: overrides.mediaBuyerId ?? null,
    branchId: overrides.branchId ?? null,
    totalAmount: '10000',
    deliveredAt,
    orderSource: null,
  }).returning({ id: schema.orders.id });

  const orderId = insertedOrder!.id;

  await db.insert(schema.orderItems).values({
    id: randomUUID(),
    orderId,
    productId,
    quantity: 1,
    unitPrice: '10000',
  });

  return { orderId, productId, deliveredAt };
}
