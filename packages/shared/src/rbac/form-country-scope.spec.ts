import { describe, expect, it } from 'vitest';
import { formCountryCurrencyCodes } from './form-country-scope';

describe('formCountryCurrencyCodes', () => {
  it('limits a Media Buyer to their assigned countries', () => {
    expect(formCountryCurrencyCodes({ role: 'MEDIA_BUYER', currencyCodes: ['ngn', 'GHS', 'GHS'] })).toEqual(['NGN', 'GHS']);
  });
  it('returns [] (base only) for an unassigned Media Buyer', () => {
    expect(formCountryCurrencyCodes({ role: 'MEDIA_BUYER', currencyCodes: [] })).toEqual([]);
  });
  it('leaves other roles unrestricted', () => {
    expect(formCountryCurrencyCodes({ role: 'SUPER_ADMIN', currencyCodes: ['NGN'] })).toBeNull();
    expect(formCountryCurrencyCodes({ role: 'HEAD_OF_MARKETING', currencyCodes: ['NGN'] })).toBeNull();
  });
});
