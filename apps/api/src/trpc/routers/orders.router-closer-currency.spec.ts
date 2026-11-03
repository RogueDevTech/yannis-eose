import { describe, expect, it } from 'vitest';
import { currencyScopeForCloserSelfQuery } from './orders.router';

// A closer must always see the orders assigned to them, whatever the currency
// (2026-11-03: Kenya closer assigned KES orders she had no KES grant for).
describe('currencyScopeForCloserSelfQuery', () => {
  const closer = { id: 'c1', role: 'CS_CLOSER' };

  it('drops the country scope for a closer querying their own orders', () => {
    expect(currencyScopeForCloserSelfQuery(closer, 'c1', ['NGN'])).toBeNull();
  });

  it('keeps the country scope when a closer queries someone else', () => {
    expect(currencyScopeForCloserSelfQuery(closer, 'c2', ['NGN'])).toEqual(['NGN']);
  });

  it('keeps the country scope when the query is not pinned to an assignee', () => {
    expect(currencyScopeForCloserSelfQuery(closer, undefined, ['NGN'])).toEqual(['NGN']);
  });

  it('keeps the country scope for every other role, even on a self id', () => {
    expect(currencyScopeForCloserSelfQuery({ id: 'h1', role: 'HEAD_OF_CS' }, 'h1', ['KES'])).toEqual(['KES']);
  });

  it('passes a null (see-all) scope through unchanged', () => {
    expect(currencyScopeForCloserSelfQuery({ id: 'h1', role: 'HEAD_OF_CS' }, undefined, null)).toBeNull();
  });
});
