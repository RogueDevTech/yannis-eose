/**
 * Test factories for creating minimal valid DB records in integration tests.
 * These call Drizzle insert directly — no service layer, no actor injection.
 * Use inside a transaction so rows are rolled back after each test.
 */

import { randomUUID } from 'crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { OrderStatus } from '@yannis/shared';

export type UserRole =
  | 'SUPER_ADMIN'
  | 'CS_AGENT'
  | 'HEAD_OF_CS'
  | 'MEDIA_BUYER'
  | 'HEAD_OF_MARKETING'
  | 'FINANCE_OFFICER'
  | 'HEAD_OF_LOGISTICS'
  | 'TPL_MANAGER'
  | 'TPL_RIDER'
  | 'HR_MANAGER'
  | 'WAREHOUSE_MANAGER';

export async function createTestUser(
  db: PostgresJsDatabase<typeof schema>,
  overrides: { role?: UserRole; branchId?: string } = {},
) {
  const id = randomUUID();
  const role = overrides.role ?? 'CS_AGENT';
  await db.insert(schema.users).values({
    id,
    name: `Test User ${id.slice(0, 8)}`,
    email: `test-${id}@yannis.test`,
    passwordHash: '$2b$10$testhashedpassword',
    role: role as (typeof schema.users.$inferInsert)['role'],
    status: 'ACTIVE',
  });
  return { id, role, email: `test-${id}@yannis.test` };
}

export async function createTestProduct(db: PostgresJsDatabase<typeof schema>) {
  const [inserted] = await db.insert(schema.products).values({
    name: `Test Product ${randomUUID().slice(0, 8)}`,
    baseSalePrice: '10000',
    costPrice: '5000',
  }).returning({ id: schema.products.id });

  const id = inserted!.id;
  return { id };
}

export async function createTestOrder(
  db: PostgresJsDatabase<typeof schema>,
  overrides: {
    status?: OrderStatus;
    assignedCsId?: string;
    mediaBuyerId?: string;
    branchId?: string;
    productId?: string;
  } = {},
) {
  const productId = overrides.productId ?? randomUUID();
  const status = overrides.status ?? 'UNPROCESSED';

  const [insertedOrder] = await db.insert(schema.orders).values({
    customerName: 'Integration Test Customer',
    customerPhoneHash: `hash-${randomUUID()}`,
    customerPhone: '08000000000',
    status: status as (typeof schema.orders.$inferInsert)['status'],
    assignedCsId: overrides.assignedCsId ?? null,
    mediaBuyerId: overrides.mediaBuyerId ?? null,
    branchId: overrides.branchId ?? null,
    totalAmount: '10000',
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

  return { orderId, productId };
}

export async function createTestBranch(db: PostgresJsDatabase<typeof schema>) {
  const id = randomUUID();
  await db.insert(schema.branches).values({
    id,
    name: `Test Branch ${id.slice(0, 8)}`,
    code: `TB${id.slice(0, 4).toUpperCase()}`,
    status: 'ACTIVE',
  });
  return { id };
}
