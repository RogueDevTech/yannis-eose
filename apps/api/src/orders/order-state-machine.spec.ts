import { describe, it, expect } from 'vitest';
import {
  isTransitionAllowed,
  getAllowedNextStatuses,
  getTransitionRule,
  TERMINAL_STATUSES,
  TRANSITION_TIMESTAMPS,
} from './order-state-machine';
import type { OrderStatus } from '@yannis/shared';

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

describe('isTransitionAllowed — valid transitions', () => {
  const validTransitions: [OrderStatus, OrderStatus][] = [
    ['UNPROCESSED', 'CS_ASSIGNED'],
    ['UNPROCESSED', 'CS_ENGAGED'],
    ['UNPROCESSED', 'CANCELLED'],
    ['CS_ASSIGNED', 'CS_ENGAGED'],
    ['CS_ASSIGNED', 'CANCELLED'],
    ['CS_ENGAGED', 'CONFIRMED'],
    ['CS_ENGAGED', 'CANCELLED'],
    ['CONFIRMED', 'AGENT_ASSIGNED'],
    ['AGENT_ASSIGNED', 'AGENT_ASSIGNED'],
    ['AGENT_ASSIGNED', 'DISPATCHED'],
    // CS rider-proxy path: CS / HoLogistics can mark delivered or returned directly from
    // ALLOCATED while 3PL isn't in-app (DISPATCHED + IN_TRANSIT happen offline).
    ['AGENT_ASSIGNED', 'DELIVERED'],
    ['AGENT_ASSIGNED', 'RETURNED'],
    ['DISPATCHED', 'IN_TRANSIT'],
    ['IN_TRANSIT', 'DELIVERED'],
    ['IN_TRANSIT', 'PARTIALLY_DELIVERED'],
    ['IN_TRANSIT', 'RETURNED'],
    ['DELIVERED', 'REMITTED'],
    ['RETURNED', 'RESTOCKED'],
    ['RETURNED', 'WRITTEN_OFF'],
    ['PARTIALLY_DELIVERED', 'REMITTED'],
  ];

  it.each(validTransitions)('%s → %s should be allowed', (from, to) => {
    expect(isTransitionAllowed(from, to)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Forbidden skip transitions (state machine integrity)
// ---------------------------------------------------------------------------

describe('isTransitionAllowed — forbidden skips', () => {
  const forbiddenTransitions: [OrderStatus, OrderStatus][] = [
    // Skip states forward
    ['UNPROCESSED', 'CONFIRMED'],
    ['UNPROCESSED', 'AGENT_ASSIGNED'],
    ['UNPROCESSED', 'DISPATCHED'],
    ['UNPROCESSED', 'IN_TRANSIT'],
    ['UNPROCESSED', 'DELIVERED'],
    ['UNPROCESSED', 'REMITTED'],
    ['CS_ASSIGNED', 'CONFIRMED'],
    ['CS_ASSIGNED', 'AGENT_ASSIGNED'],
    ['CS_ENGAGED', 'AGENT_ASSIGNED'],
    ['CS_ENGAGED', 'DISPATCHED'],
    ['CONFIRMED', 'DISPATCHED'],
    ['CONFIRMED', 'IN_TRANSIT'],
    ['CONFIRMED', 'DELIVERED'],
    ['AGENT_ASSIGNED', 'IN_TRANSIT'],
    ['DISPATCHED', 'DELIVERED'],
    // Backward transitions
    ['DELIVERED', 'UNPROCESSED'],
    ['REMITTED', 'UNPROCESSED'],
    ['CONFIRMED', 'CS_ENGAGED'],
    ['AGENT_ASSIGNED', 'CONFIRMED'],
    ['DISPATCHED', 'AGENT_ASSIGNED'],
    ['IN_TRANSIT', 'DISPATCHED'],
    // Terminal → anything
    ['REMITTED', 'AGENT_ASSIGNED'],
    ['REMITTED', 'DISPATCHED'],
    ['WRITTEN_OFF', 'RETURNED'],
    ['RESTOCKED', 'DISPATCHED'],
    // Cross-branch invalid
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'AGENT_ASSIGNED'],
    ['RETURNED', 'DELIVERED'],
  ];

  it.each(forbiddenTransitions)('%s → %s should NOT be allowed', (from, to) => {
    expect(isTransitionAllowed(from, to)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TERMINAL_STATUSES
// ---------------------------------------------------------------------------

describe('TERMINAL_STATUSES', () => {
  it('contains exactly COMPLETED, WRITTEN_OFF, RESTOCKED', () => {
    expect(TERMINAL_STATUSES).toHaveLength(3);
    expect(TERMINAL_STATUSES).toContain('REMITTED');
    expect(TERMINAL_STATUSES).toContain('WRITTEN_OFF');
    expect(TERMINAL_STATUSES).toContain('RESTOCKED');
  });

  it('returns empty array of next statuses for every terminal state', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(getAllowedNextStatuses(status)).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getAllowedNextStatuses
// ---------------------------------------------------------------------------

describe('getAllowedNextStatuses', () => {
  it('returns correct options from UNPROCESSED', () => {
    const result = getAllowedNextStatuses('UNPROCESSED');
    expect(result).toContain('CS_ASSIGNED');
    expect(result).toContain('CS_ENGAGED');
    expect(result).toContain('CANCELLED');
    expect(result).not.toContain('CONFIRMED');
    expect(result).not.toContain('DELIVERED');
  });

  it('returns correct options from CS_ENGAGED', () => {
    const result = getAllowedNextStatuses('CS_ENGAGED');
    expect(result).toContain('CONFIRMED');
    expect(result).toContain('CANCELLED');
    expect(result).not.toContain('AGENT_ASSIGNED');
  });

  it('returns correct options from IN_TRANSIT', () => {
    const result = getAllowedNextStatuses('IN_TRANSIT');
    expect(result).toContain('DELIVERED');
    expect(result).toContain('PARTIALLY_DELIVERED');
    expect(result).toContain('RETURNED');
    expect(result).not.toContain('CONFIRMED');
  });

  it('returns correct options from RETURNED', () => {
    const result = getAllowedNextStatuses('RETURNED');
    expect(result).toContain('RESTOCKED');
    expect(result).toContain('WRITTEN_OFF');
    expect(result).not.toContain('DELIVERED');
  });

  it('returns empty array for CANCELLED (no forward path)', () => {
    expect(getAllowedNextStatuses('CANCELLED')).toHaveLength(0);
  });

  it('returns ALLOCATED from ALLOCATED (reallocate to another 3PL)', () => {
    const result = getAllowedNextStatuses('AGENT_ASSIGNED');
    expect(result).toContain('AGENT_ASSIGNED');
  });
});

// ---------------------------------------------------------------------------
// getTransitionRule — gate descriptions
// ---------------------------------------------------------------------------

describe('getTransitionRule', () => {
  it('returns rule with gate for CS_ENGAGED → CONFIRMED', () => {
    const rule = getTransitionRule('CS_ENGAGED', 'CONFIRMED');
    expect(rule).toBeDefined();
    expect(rule?.gate).toMatch(/voip|call_duration|15/i);
  });

  it('returns rule with gate for cancel requiring reason note', () => {
    const rule = getTransitionRule('CS_ENGAGED', 'CANCELLED');
    expect(rule).toBeDefined();
    expect(rule?.gate).toMatch(/reason/i);
  });

  it('returns undefined for a forbidden transition', () => {
    const rule = getTransitionRule('UNPROCESSED', 'DELIVERED');
    expect(rule).toBeUndefined();
  });

  it('returns rule with OTP gate for IN_TRANSIT → DELIVERED', () => {
    const rule = getTransitionRule('IN_TRANSIT', 'DELIVERED');
    expect(rule).toBeDefined();
    expect(rule?.gate).toMatch(/otp|signature|override/i);
  });
});

// ---------------------------------------------------------------------------
// TRANSITION_TIMESTAMPS
// ---------------------------------------------------------------------------

describe('TRANSITION_TIMESTAMPS', () => {
  it('maps CONFIRMED to confirmedAt', () => {
    expect(TRANSITION_TIMESTAMPS['CONFIRMED']).toBe('confirmedAt');
  });

  it('maps ALLOCATED to allocatedAt', () => {
    expect(TRANSITION_TIMESTAMPS['AGENT_ASSIGNED']).toBe('allocatedAt');
  });

  it('maps DISPATCHED to dispatchedAt', () => {
    expect(TRANSITION_TIMESTAMPS['DISPATCHED']).toBe('dispatchedAt');
  });

  it('maps DELIVERED to deliveredAt', () => {
    expect(TRANSITION_TIMESTAMPS['DELIVERED']).toBe('deliveredAt');
  });

  it('does not have a timestamp for terminal-only states (RESTOCKED, WRITTEN_OFF)', () => {
    expect(TRANSITION_TIMESTAMPS['RESTOCKED']).toBeUndefined();
    expect(TRANSITION_TIMESTAMPS['WRITTEN_OFF']).toBeUndefined();
  });
});
