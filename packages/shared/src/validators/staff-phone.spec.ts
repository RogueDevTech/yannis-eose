/**
 * Staff phone must accept every market we operate in, not just Nigeria.
 *
 * The regression this guards: the validator was
 * `/^(?:0[789]\d{9}|\+234[789]\d{9})$/`, so staff assigned to Kenya or Zambia
 * could not have their phone number stored at all. On prod that showed up as
 * 240 Nigerian staff phones and zero of anything else.
 */
import { describe, it, expect } from 'vitest';
import { staffPhoneSchema } from './users';

const accepts = (v: string) => staffPhoneSchema.safeParse(v).success;

describe('staffPhoneSchema', () => {
  it.each([
    ['08031234567', 'Nigeria, local'],
    ['+2348031234567', 'Nigeria, international'],
    ['0241234567', 'Ghana, local'],
    ['+233241234567', 'Ghana, international'],
    ['0712345678', 'Kenya, local'],
    ['+254712345678', 'Kenya, international'],
    ['0971234567', 'Zambia, local'],
    ['+260971234567', 'Zambia, international'],
    ['0621234567', 'Tanzania, local'],
    ['+255621234567', 'Tanzania, international'],
  ])('accepts %s (%s)', (value) => {
    expect(accepts(value)).toBe(true);
  });

  // The five countries live on prod today; Nigeria must not regress.
  it('still accepts the Nigerian forms it always did', () => {
    expect(accepts('08031234567')).toBe(true);
    expect(accepts('09031234567')).toBe(true);
    expect(accepts('07031234567')).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['123', 'too short'],
    ['abcdefghijk', 'letters'],
    ['0000000000000000', 'too long / all zeros'],
    ['+1', 'dial code only'],
  ])('rejects %s (%s)', (value) => {
    expect(accepts(value)).toBe(false);
  });

  it('rejects a Nigerian-length number with an impossible prefix', () => {
    // Nigeria's national numbers start 7/8/9 — 0 1 2 3 4 5 6 are not mobile.
    expect(accepts('01031234567')).toBe(false);
  });
});
