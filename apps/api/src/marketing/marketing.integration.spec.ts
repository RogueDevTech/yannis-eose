/**
 * Integration: approving a funding request creates a matching marketing_funding ledger row.
 * Requires DB migrations through 0070 (source_funding_request_id column).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser } from '../test/factories/order.factory';
import { MarketingService } from './marketing.service';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Marketing funding — approve creates ledger', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const eventsStub = {
    emitToUser: () => undefined,
    emitToRoom: () => undefined,
  } as unknown as EventsService;

  const notificationsStub = {
    create: async () => undefined,
    createForRole: async () => undefined,
  } as unknown as NotificationsService;

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  afterAll(async () => {
    await closeConnections();
  });

  it('inserts marketing_funding with source_funding_request_id when HoM approves MB request', async () => {
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await setSessionActor(pgClient, hom.id);

    const [req] = await db
      .insert(schema.marketingFundingRequests)
      .values({
        requesterId: mb.id,
        amount: '50000.00',
        status: 'PENDING',
        reason: 'Integration test request',
      })
      .returning({ id: schema.marketingFundingRequests.id });

    const requestId = req!.id;

    const svc = new MarketingService(db as any, eventsStub, notificationsStub);
    await svc.approveFundingRequest(requestId, 'https://example.com/receipt-test.png', hom.id);

    const [ledger] = await db
      .select({
        id: schema.marketingFunding.id,
        senderId: schema.marketingFunding.senderId,
        receiverId: schema.marketingFunding.receiverId,
        status: schema.marketingFunding.status,
        sourceFundingRequestId: schema.marketingFunding.sourceFundingRequestId,
      })
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.sourceFundingRequestId, requestId));

    expect(ledger).toBeDefined();
    expect(ledger!.senderId).toBe(hom.id);
    expect(ledger!.receiverId).toBe(mb.id);
    expect(ledger!.status).toBe('SENT');
    expect(ledger!.sourceFundingRequestId).toBe(requestId);

    const [reqAfter] = await db
      .select({ status: schema.marketingFundingRequests.status })
      .from(schema.marketingFundingRequests)
      .where(eq(schema.marketingFundingRequests.id, requestId));
    expect(reqAfter!.status).toBe('APPROVED');
  });
});
