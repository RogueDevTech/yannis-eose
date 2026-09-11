import { describe, it, expect } from 'vitest';
import { dedupExcludedStatuses } from './dedup-excluded-statuses';
import type { OrderStatus } from '@yannis/shared';

/**
 * The dedup guard serves two OPPOSING jobs off one query, and these tests pin
 * both. Collapsing them (the bug caught in review on 2026-09-11) either blocks
 * paying customers from reordering, or makes cart recovery create a second live
 * order and strand the cart as abandoned forever.
 */

// ---------------------------------------------------------------------------
// Duplicate rejection (every order-create path: edge form, offline, manual)
// ---------------------------------------------------------------------------

describe('dedupExcludedStatuses — duplicate rejection (default)', () => {
  const completed: OrderStatus[] = ['DELIVERED', 'PARTIALLY_DELIVERED', 'REMITTED'];

  it.each(completed)(
    'a %s order must NOT block a new order — the customer already received goods',
    (status) => {
      expect(dedupExcludedStatuses()).toContain(status);
    },
  );

  it('REMITTED is excluded — it was the single largest blocker on prod (665 attempts / 434 customers in 30 days)', () => {
    expect(dedupExcludedStatuses()).toContain('REMITTED');
  });

  const stillBlocks: OrderStatus[] = [
    'UNPROCESSED',
    'CS_ASSIGNED',
    'CS_ENGAGED',
    'CONFIRMED',
    'AGENT_ASSIGNED',
    'DISPATCHED',
    'IN_TRANSIT',
  ];

  it.each(stillBlocks)(
    'an in-flight %s order STILL blocks — this is the real double-submit protection',
    (status) => {
      expect(dedupExcludedStatuses()).not.toContain(status);
    },
  );

  it('CANCELLED and DELETED never block', () => {
    expect(dedupExcludedStatuses()).toEqual(
      expect.arrayContaining<OrderStatus>(['CANCELLED', 'DELETED']),
    );
  });
});

// ---------------------------------------------------------------------------
// Cart recovery ("which order did this abandoned cart become?")
// ---------------------------------------------------------------------------

describe('dedupExcludedStatuses — cart recovery (includeCompleted)', () => {
  const completed: OrderStatus[] = ['DELIVERED', 'PARTIALLY_DELIVERED', 'REMITTED'];

  it.each(completed)(
    'recovery MUST still match a %s order, or it creates a second live order and strands the cart',
    (status) => {
      expect(dedupExcludedStatuses(true)).not.toContain(status);
    },
  );

  it('only CANCELLED/DELETED are excluded — the pre-2026-09-11 behaviour, unchanged', () => {
    expect(dedupExcludedStatuses(true).sort()).toEqual(['CANCELLED', 'DELETED']);
  });
});

// ---------------------------------------------------------------------------
// The two modes must stay distinct
// ---------------------------------------------------------------------------

describe('dedupExcludedStatuses — the two modes are not interchangeable', () => {
  it('rejection excludes strictly more than recovery', () => {
    const rejection = dedupExcludedStatuses(false);
    const recovery = dedupExcludedStatuses(true);
    expect(rejection.length).toBeGreaterThan(recovery.length);
    for (const s of recovery) expect(rejection).toContain(s);
  });

  it('returns a fresh array each call — callers must not mutate shared state', () => {
    const a = dedupExcludedStatuses();
    a.push('CONFIRMED');
    expect(dedupExcludedStatuses()).not.toContain('CONFIRMED');
  });
});
