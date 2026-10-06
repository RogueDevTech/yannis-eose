import { describe, it, expect } from 'vitest';
import {
  formatInternationalPhone,
  phoneSpecForCurrency,
  toDialablePhone,
  toInternationalPhone,
} from './phone-format';
import { normalizePhoneForHash } from './african-countries';
import {
  formatCustomerPhoneForDisplay,
  formatOrderCustomerPhoneDisplay,
  formatPhoneForClipboardPaste,
} from '../orders/customer-phone-display';

describe('toInternationalPhone', () => {
  it('converts a Tanzania local number', () => {
    const r = toInternationalPhone('0712345678', 'TZS');
    expect(r?.e164).toBe('+255712345678');
    expect(r?.display).toBe('+255 712 345 678');
    expect(r?.prefixMatchesCountry).toBe(true);
  });

  it('converts the reported number on a Zambia order', () => {
    expect(formatInternationalPhone('0976372552', 'ZMW')).toBe('+260 976 372 552');
  });

  it('converts but flags a Zambian-prefix number on a Tanzania order', () => {
    const r = toInternationalPhone('0976372552', 'TZS');
    expect(r?.display).toBe('+255 976 372 552');
    expect(r?.prefixMatchesCountry).toBe(false);
  });

  it('never duplicates the dial code on international input', () => {
    expect(toDialablePhone('+255 712 345 678', 'TZS')).toBe('+255712345678');
    expect(toDialablePhone('255712345678', 'TZS')).toBe('+255712345678');
    expect(toDialablePhone('00255712345678', 'TZS')).toBe('+255712345678');
  });

  it('adds the dial code to a bare national number', () => {
    expect(toDialablePhone('712345678', 'TZS')).toBe('+255712345678');
  });

  it('handles Kenya, Ghana and Nigeria', () => {
    expect(formatInternationalPhone('0712345678', 'KES')).toBe('+254 712 345 678');
    expect(formatInternationalPhone('0241234567', 'GHS')).toBe('+233 241 234 567');
    expect(formatInternationalPhone('08031234567', 'NGN')).toBe('+234 803 123 4567');
  });

  it('returns null for shapes that do not fit the country', () => {
    expect(toInternationalPhone('12345', 'TZS')).toBeNull();
    expect(toInternationalPhone('+254712345678', 'TZS')).toBeNull(); // other country's code
    expect(toInternationalPhone('0712345678', null)).toBeNull();
    expect(toInternationalPhone('', 'TZS')).toBeNull();
  });

  it('does not treat a 0-leading run of national length as bare national', () => {
    // 10-digit Nigerian-shaped run that starts with 0 is NOT a bare national number.
    expect(toInternationalPhone('0712345678', 'NGN')).toBeNull();
  });

  it('falls back to the raw value when unconvertible', () => {
    expect(toDialablePhone(' 12345 ', 'TZS')).toBe('12345');
    expect(formatInternationalPhone('abc', 'TZS')).toBe('abc');
  });
});

describe('phoneSpecForCurrency', () => {
  it('resolves single-country currencies', () => {
    expect(phoneSpecForCurrency('tzs')?.dial).toBe('255');
  });

  it('refuses shared currencies spanning several dial codes', () => {
    expect(phoneSpecForCurrency('XOF')).toBeNull();
  });
});

describe('country-aware masked display', () => {
  it('keeps the Nigerian mask byte-for-byte', () => {
    expect(formatOrderCustomerPhoneDisplay('08031234567', 'h')).toBe('0803****4567');
    expect(formatOrderCustomerPhoneDisplay('08031234567', 'h', 'NGN')).toBe('0803****4567');
  });

  it('masks non-Nigerian numbers in international form', () => {
    expect(formatOrderCustomerPhoneDisplay('0712345678', 'h', 'TZS')).toBe('+255 71****678');
  });

  it('fully masks short numbering plans (8 or fewer national digits)', () => {
    // Cabo Verde: 7-digit national number. Must not leak 5 of 7 digits.
    expect(formatOrderCustomerPhoneDisplay('05912345', 'h', 'CVE')).toBe('+238 ****');
  });

  it('falls back to the legacy mask when the number does not fit', () => {
    expect(formatOrderCustomerPhoneDisplay('071234567890', 'h', 'TZS')).toBe('0712****7890');
  });
});

describe('formatPhoneForClipboardPaste', () => {
  it('uses the order country', () => {
    expect(formatPhoneForClipboardPaste('0712345678', 'TZS')).toBe('+255712345678');
    expect(formatPhoneForClipboardPaste('08031234567', 'NGN')).toBe('+2348031234567');
  });
});

describe('hash stability', () => {
  it('read-time formatting never changes what gets hashed', () => {
    // The stored value is untouched; this pins the existing hash inputs.
    expect(normalizePhoneForHash('08031234567')).toBe('2348031234567');
    expect(normalizePhoneForHash('0712345678')).toBe('233712345678');
  });
});

describe('formatCustomerPhoneForDisplay', () => {
  it('keeps Nigerian numbers exactly as stored', () => {
    expect(formatCustomerPhoneForDisplay('08031234567', 'NGN')).toBe('08031234567');
    expect(formatCustomerPhoneForDisplay('08031234567', null)).toBe('08031234567');
  });

  it('shows other countries in international form', () => {
    expect(formatCustomerPhoneForDisplay('0976372552', 'ZMW')).toBe('+260 976 372 552');
  });
});

describe('dial fallback for numbers that do not fit the order country', () => {
  it('still dials a Nigerian-shaped number as +234', () => {
    // NGN order with a Nigerian 0[789] number on a shared-currency or mismatched order.
    expect(formatPhoneForClipboardPaste('08031234567', 'XOF')).toBe('+2348031234567');
    expect(formatPhoneForClipboardPaste('08031234567', 'ZMW')).toBe('+2348031234567');
  });

  it('never turns a Tanzanian local number into +234', () => {
    expect(formatPhoneForClipboardPaste('0712345678', 'TZS')).toBe('+255712345678');
    expect(formatPhoneForClipboardPaste('0712345678', null)).toBe('0712345678');
  });
});
