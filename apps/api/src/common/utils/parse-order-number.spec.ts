import { describe, it, expect } from 'vitest';
import { parseOrderNumberSearch } from './parse-order-number';

describe('parseOrderNumberSearch', () => {
  it('parses a bare order number', () => {
    expect(parseOrderNumberSearch('113826')).toBe(113826);
  });

  it('parses the legacy YNS prefix in every separator form', () => {
    expect(parseOrderNumberSearch('YNS-113826')).toBe(113826);
    expect(parseOrderNumberSearch('YNS 113826')).toBe(113826);
    expect(parseOrderNumberSearch('YNS113826')).toBe(113826);
  });

  // The regression this helper exists for: a second company's prefix used to
  // fall through to a customer_name ILIKE and return nothing.
  it('parses any company prefix, not just YNS', () => {
    expect(parseOrderNumberSearch('ZAR-113826')).toBe(113826);
    expect(parseOrderNumberSearch('ZAR113826')).toBe(113826);
    expect(parseOrderNumberSearch('AB-42')).toBe(42);
    expect(parseOrderNumberSearch('ABCDE-42')).toBe(42);
  });

  it('is case-insensitive on the prefix', () => {
    expect(parseOrderNumberSearch('zar-113826')).toBe(113826);
    expect(parseOrderNumberSearch('Zar 113826')).toBe(113826);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseOrderNumberSearch('  ZAR-113826  ')).toBe(113826);
  });

  it('returns NaN for input that is not order-number-shaped', () => {
    // Callers fall back to name / phone matching on NaN.
    expect(parseOrderNumberSearch('Desmond')).toBeNaN();
    expect(parseOrderNumberSearch('')).toBeNaN();
    expect(parseOrderNumberSearch('08031110001')).toBeNaN(); // 11 digits — a phone, not an order
    expect(parseOrderNumberSearch('ZAR-')).toBeNaN();
    expect(parseOrderNumberSearch('TOOLONG-42')).toBeNaN(); // prefix over 5 chars
    expect(parseOrderNumberSearch('ZAR-113826-X')).toBeNaN();
  });

  it('does not match a leading zero-value number', () => {
    // Downstream guards require > 0; 0 must never hit the orderNumber index.
    expect(parseOrderNumberSearch('0')).toBe(0);
    expect(parseOrderNumberSearch('ZAR-0')).toBe(0);
  });
});
