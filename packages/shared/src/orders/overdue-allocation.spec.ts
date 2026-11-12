import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESERVATION_RELEASE_DAYS,
  OVERDUE_ALLOCATION_DAYS,
  daysSinceAllocation,
  isOverdueAllocation,
  resolveReservationReleaseDays,
} from './overdue-allocation';

const now = new Date('2026-11-12T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

describe('overdue allocation', () => {
  it('counts whole days since allocation', () => {
    expect(daysSinceAllocation(daysAgo(10), now)).toBe(10);
    expect(daysSinceAllocation(null, now)).toBeNull();
    expect(daysSinceAllocation('not a date', now)).toBeNull();
  });

  it('flags stock-holding orders allocated 30+ days ago', () => {
    expect(isOverdueAllocation('AGENT_ASSIGNED', daysAgo(OVERDUE_ALLOCATION_DAYS), now)).toBe(true);
    expect(isOverdueAllocation('DISPATCHED', daysAgo(90), now)).toBe(true);
    expect(isOverdueAllocation('IN_TRANSIT', daysAgo(45), now)).toBe(true);
  });

  it('does not flag recent allocations', () => {
    expect(isOverdueAllocation('AGENT_ASSIGNED', daysAgo(OVERDUE_ALLOCATION_DAYS - 1), now)).toBe(false);
  });

  it('does not flag orders that no longer hold stock or have no allocation date', () => {
    expect(isOverdueAllocation('DELIVERED', daysAgo(90), now)).toBe(false);
    expect(isOverdueAllocation('RETURNED', daysAgo(90), now)).toBe(false);
    expect(isOverdueAllocation('CONFIRMED', daysAgo(90), now)).toBe(false);
    expect(isOverdueAllocation('AGENT_ASSIGNED', null, now)).toBe(false);
  });
});

describe('reservation release rule', () => {
  it('defaults to 30 days when unset or malformed', () => {
    expect(resolveReservationReleaseDays(null)).toBe(DEFAULT_RESERVATION_RELEASE_DAYS);
    expect(resolveReservationReleaseDays({})).toBe(30);
    expect(resolveReservationReleaseDays({ days: '10' })).toBe(30);
    expect(resolveReservationReleaseDays({ days: 2.5 })).toBe(30);
    expect(resolveReservationReleaseDays({ days: -1 })).toBe(30);
    expect(resolveReservationReleaseDays({ days: 9999 })).toBe(30);
  });

  it('accepts a configured number of days, 0 meaning never', () => {
    expect(resolveReservationReleaseDays({ days: 14 })).toBe(14);
    expect(resolveReservationReleaseDays({ days: 0 })).toBe(0);
  });

  it('uses the configured threshold for overdue', () => {
    expect(isOverdueAllocation('AGENT_ASSIGNED', daysAgo(15), now, 14)).toBe(true);
    expect(isOverdueAllocation('AGENT_ASSIGNED', daysAgo(13), now, 14)).toBe(false);
  });
});
