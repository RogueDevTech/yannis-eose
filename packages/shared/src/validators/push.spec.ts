import { describe, it, expect } from 'vitest';
import {
  broadcastPushSchema,
  createAutomationRuleSchema,
  pushAckSchema,
  savePushSubscriptionSchema,
  bulkResendPushSchema,
  toggleAutomationRuleSchema,
} from './push';

// ---------------------------------------------------------------------------
// broadcastPushSchema
// ---------------------------------------------------------------------------

describe('broadcastPushSchema', () => {
  it('accepts ALL target type without role or userId', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'ALL',
        title: 'Test',
        body: 'Test body',
      }),
    ).not.toThrow();
  });

  it('accepts ROLE target type with targetRole provided', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'ROLE',
        targetRole: 'CS_CLOSER',
        title: 'CS Notice',
        body: 'Hello CS team',
      }),
    ).not.toThrow();
  });

  it('rejects ROLE target type without targetRole', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'ROLE',
        title: 'Test',
        body: 'Test body',
      }),
    ).toThrow();
  });

  it('accepts USER target type with targetUserId provided', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'USER',
        targetUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        title: 'Hi User',
        body: 'Personal message',
      }),
    ).not.toThrow();
  });

  it('rejects USER target type without targetUserId', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'USER',
        title: 'Test',
        body: 'Test body',
      }),
    ).toThrow();
  });

  it('rejects empty title', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'ALL',
        title: '',
        body: 'Body text',
      }),
    ).toThrow();
  });

  it('rejects title longer than 80 chars', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'ALL',
        title: 'A'.repeat(81),
        body: 'Body text',
      }),
    ).toThrow();
  });

  it('rejects body longer than 120 chars', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'ALL',
        title: 'Test',
        body: 'A'.repeat(121),
      }),
    ).toThrow();
  });

  it('rejects invalid targetType', () => {
    expect(() =>
      broadcastPushSchema.parse({
        targetType: 'EVERYONE',
        title: 'Test',
        body: 'Body',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createAutomationRuleSchema
// ---------------------------------------------------------------------------

describe('createAutomationRuleSchema', () => {
  const baseValid = {
    name: 'Morning Digest',
    targetType: 'ALL' as const,
    titleTemplate: 'Good Morning',
    bodyTemplate: 'Here is your daily digest',
  };

  it('accepts CRON rule with cronExpr', () => {
    expect(() =>
      createAutomationRuleSchema.parse({
        ...baseValid,
        triggerType: 'CRON',
        cronExpr: '0 8 * * *',
      }),
    ).not.toThrow();
  });

  it('rejects CRON rule without cronExpr', () => {
    expect(() =>
      createAutomationRuleSchema.parse({
        ...baseValid,
        triggerType: 'CRON',
      }),
    ).toThrow();
  });

  it('accepts EVENT rule with eventKey', () => {
    expect(() =>
      createAutomationRuleSchema.parse({
        ...baseValid,
        triggerType: 'EVENT',
        eventKey: 'order_stuck',
      }),
    ).not.toThrow();
  });

  it('rejects EVENT rule without eventKey', () => {
    expect(() =>
      createAutomationRuleSchema.parse({
        ...baseValid,
        triggerType: 'EVENT',
      }),
    ).toThrow();
  });

  it('rejects rule with name longer than 100 chars', () => {
    expect(() =>
      createAutomationRuleSchema.parse({
        ...baseValid,
        triggerType: 'CRON',
        cronExpr: '0 8 * * *',
        name: 'A'.repeat(101),
      }),
    ).toThrow();
  });

  it('defaults isActive to true', () => {
    const result = createAutomationRuleSchema.parse({
      ...baseValid,
      triggerType: 'CRON',
      cronExpr: '0 8 * * *',
    });
    expect(result.isActive).toBe(true);
  });

  it('rejects titleTemplate longer than 80 chars', () => {
    expect(() =>
      createAutomationRuleSchema.parse({
        ...baseValid,
        triggerType: 'CRON',
        cronExpr: '0 8 * * *',
        titleTemplate: 'A'.repeat(81),
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// pushAckSchema
// ---------------------------------------------------------------------------

describe('pushAckSchema', () => {
  it('accepts shown event', () => {
    expect(() => pushAckSchema.parse({ logId: 'log-123', event: 'shown' })).not.toThrow();
  });

  it('accepts clicked event', () => {
    expect(() => pushAckSchema.parse({ logId: 'log-123', event: 'clicked' })).not.toThrow();
  });

  it('rejects unknown event type', () => {
    expect(() => pushAckSchema.parse({ logId: 'log-123', event: 'dismissed' })).toThrow();
  });

  it('rejects missing logId', () => {
    expect(() => pushAckSchema.parse({ event: 'shown' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// savePushSubscriptionSchema
// ---------------------------------------------------------------------------

describe('savePushSubscriptionSchema', () => {
  it('accepts valid subscription', () => {
    expect(() =>
      savePushSubscriptionSchema.parse({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        auth: 'auth-key',
        p256dh: 'p256dh-key',
      }),
    ).not.toThrow();
  });

  it('rejects non-URL endpoint', () => {
    expect(() =>
      savePushSubscriptionSchema.parse({
        endpoint: 'not-a-url',
        auth: 'auth-key',
        p256dh: 'p256dh-key',
      }),
    ).toThrow();
  });

  it('rejects missing auth', () => {
    expect(() =>
      savePushSubscriptionSchema.parse({
        endpoint: 'https://fcm.example.com/abc',
        p256dh: 'p256dh-key',
      }),
    ).toThrow();
  });

  it('accepts optional userAgent', () => {
    expect(() =>
      savePushSubscriptionSchema.parse({
        endpoint: 'https://fcm.example.com/abc',
        auth: 'auth-key',
        p256dh: 'p256dh-key',
        userAgent: 'Mozilla/5.0',
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// bulkResendPushSchema
// ---------------------------------------------------------------------------

describe('bulkResendPushSchema', () => {
  it('accepts array with one logId', () => {
    expect(() => bulkResendPushSchema.parse({ logIds: ['log-1'] })).not.toThrow();
  });

  it('rejects empty logIds array', () => {
    expect(() => bulkResendPushSchema.parse({ logIds: [] })).toThrow();
  });

  it('rejects array exceeding 200 entries', () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `log-${i}`);
    expect(() => bulkResendPushSchema.parse({ logIds: tooMany })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// toggleAutomationRuleSchema
// ---------------------------------------------------------------------------

describe('toggleAutomationRuleSchema', () => {
  it('accepts valid toggle on', () => {
    expect(() => toggleAutomationRuleSchema.parse({ id: 'rule-1', isActive: true })).not.toThrow();
  });

  it('accepts valid toggle off', () => {
    expect(() => toggleAutomationRuleSchema.parse({ id: 'rule-1', isActive: false })).not.toThrow();
  });

  it('rejects missing id', () => {
    expect(() => toggleAutomationRuleSchema.parse({ isActive: true })).toThrow();
  });
});
