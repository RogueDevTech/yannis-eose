/**
 * Country data-scope resolution in `createContext`.
 *
 * The regression this locks down: a user who could see every country but had
 * not touched the top-bar switcher was narrowed to the base country ('NGN'),
 * so every operational surface silently hid every non-Nigerian row. On prod
 * that hid 48 KES + 48 ZMW orders (plus cart and follow-up rows) that were
 * being created daily, across three live products, while the countries were
 * correctly configured with FX rates and staff assigned to each.
 *
 * "No selection" must mean "everything you are permitted to see" (null), the
 * way the branch switcher's "All branches" already does.
 */
import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { createContext } from './context';
import type { SessionUser } from '../common/decorators/current-user.decorator';

function ctxFor(user: Partial<SessionUser> | null) {
  const req = { user: user ?? undefined } as unknown as Request;
  return createContext(req, {} as Response);
}

const baseUser = {
  id: '3f1a0b2c-0000-4000-8000-000000000001',
  email: 'u@yannis.test',
  name: 'User',
  logisticsLocationId: null,
  permissions: [] as string[],
  currentBranchId: null,
  mirroredBy: null,
  mirrorSessionId: null,
};

describe('effectiveCurrencyCodes', () => {
  it('is null (all countries) for an admin with no switcher selection', () => {
    const ctx = ctxFor({ ...baseUser, role: 'SUPER_ADMIN' });
    expect(ctx.effectiveCurrencyCodes).toBeNull();
  });

  it('is null for a MEDIA_BUYER, who is cross-country by design', () => {
    const ctx = ctxFor({ ...baseUser, role: 'MEDIA_BUYER' });
    expect(ctx.effectiveCurrencyCodes).toBeNull();
  });

  it('is null for a scoped role holding countries.view_all', () => {
    const ctx = ctxFor({
      ...baseUser,
      role: 'FINANCE_OFFICER',
      permissions: ['countries.view_all'],
    });
    expect(ctx.effectiveCurrencyCodes).toBeNull();
  });

  it('narrows to the switcher selection when one is set', () => {
    const ctx = ctxFor({ ...baseUser, role: 'SUPER_ADMIN', currentCurrencyCode: 'KES' });
    expect(ctx.effectiveCurrencyCodes).toEqual(['KES']);
  });

  it('upper-cases a selection so casing cannot silently miss', () => {
    const ctx = ctxFor({
      ...baseUser,
      role: 'SUPER_ADMIN',
      currentCurrencyCode: 'kes' as string,
    });
    expect(ctx.effectiveCurrencyCodes).toEqual(['KES']);
  });

  it('restricts a country-scoped user to exactly their grants', () => {
    const ctx = ctxFor({
      ...baseUser,
      role: 'FINANCE_OFFICER',
      currencyCodes: ['KES', 'ZMW'],
    });
    expect(ctx.effectiveCurrencyCodes).toEqual(['KES', 'ZMW']);
  });

  it('falls back to the base country for a scoped user with no grant', () => {
    // Rollout safety: a working app rather than a blank one.
    const ctx = ctxFor({ ...baseUser, role: 'FINANCE_OFFICER', currencyCodes: [] });
    expect(ctx.effectiveCurrencyCodes).toEqual(['NGN']);
  });

  it('ignores a selection the user is not permitted to see', () => {
    // Stale selection after a revoke must never widen access.
    const ctx = ctxFor({
      ...baseUser,
      role: 'FINANCE_OFFICER',
      currencyCodes: ['KES'],
      currentCurrencyCode: 'ZMW',
    });
    expect(ctx.effectiveCurrencyCodes).toEqual(['KES']);
  });
});

describe('permittedCurrencyCodes', () => {
  // The switcher builds its options from this. Using effectiveCurrencyCodes
  // would leave a user who picked one country able to see only that country in
  // the list, with no way to pick another.
  it('keeps the full permission set even while a selection narrows the view', () => {
    const ctx = ctxFor({
      ...baseUser,
      role: 'FINANCE_OFFICER',
      currencyCodes: ['KES', 'ZMW'],
      currentCurrencyCode: 'KES',
    });
    expect(ctx.effectiveCurrencyCodes).toEqual(['KES']);
    expect(ctx.permittedCurrencyCodes).toEqual(['KES', 'ZMW']);
  });

  it('is null for an all-countries user with a selection active', () => {
    const ctx = ctxFor({ ...baseUser, role: 'SUPER_ADMIN', currentCurrencyCode: 'ZMW' });
    expect(ctx.effectiveCurrencyCodes).toEqual(['ZMW']);
    expect(ctx.permittedCurrencyCodes).toBeNull();
  });
});
