import { describe, expect, it } from 'vitest';
import { mergeSearchParamsFromStorage, parseStoredFilters, pickAllowlisted } from './list-filter-persistence';

describe('pickAllowlisted', () => {
  it('omits page and empty values', () => {
    const sp = new URLSearchParams('status=CONFIRMED&page=2&search=');
    const out = pickAllowlisted(sp, ['status', 'page', 'search']);
    expect(out).toEqual({ status: 'CONFIRMED' });
  });
});

describe('mergeSearchParamsFromStorage', () => {
  it('fills only missing keys from stored', () => {
    const stored = { status: 'DELIVERED', startDate: '2026-05-01' };
    const { next, addedKeys } = mergeSearchParamsFromStorage('?status=CONFIRMED', stored, [
      'status',
      'startDate',
      'endDate',
    ]);
    expect(next.get('status')).toBe('CONFIRMED');
    expect(next.get('startDate')).toBe('2026-05-01');
    expect(addedKeys).toEqual(['startDate']);
  });

  it('returns empty addedKeys when stored null', () => {
    const { addedKeys } = mergeSearchParamsFromStorage('', null, ['status']);
    expect(addedKeys).toEqual([]);
  });
});

describe('parseStoredFilters', () => {
  it('parses valid JSON object of strings', () => {
    expect(parseStoredFilters(JSON.stringify({ a: '1', b: 'x' }))).toEqual({ a: '1', b: 'x' });
  });

  it('returns null for invalid JSON', () => {
    expect(parseStoredFilters('not-json')).toBeNull();
  });
});
