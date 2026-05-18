import { describe, it, expect } from 'vitest';
import {
  extractNigerianPhoneFromText,
  formatNigerianPhoneForClipboardPaste,
  formatOrderCustomerPhoneDisplay,
  resolveOrderClipboardPhone,
} from './customer-phone-display';

describe('formatOrderCustomerPhoneDisplay', () => {
  it('masks digits when raw phone is stored', () => {
    expect(formatOrderCustomerPhoneDisplay('08031234567', 'any_hash')).toBe('0803****4567');
    expect(formatOrderCustomerPhoneDisplay('+234 803 123 4567', null)).toBe('0803****4567');
  });

  it('returns Hidden when only a hash exists (never hash fragments)', () => {
    expect(formatOrderCustomerPhoneDisplay(null, 'deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567')).toBe(
      'Hidden',
    );
    expect(formatOrderCustomerPhoneDisplay('', 'abc')).toBe('Hidden');
  });

  it('returns em dash when neither raw nor hash', () => {
    expect(formatOrderCustomerPhoneDisplay(null, null)).toBe('—');
    expect(formatOrderCustomerPhoneDisplay(null, '')).toBe('—');
  });
});

describe('extractNigerianPhoneFromText', () => {
  it('parses local and intl formats', () => {
    expect(extractNigerianPhoneFromText('Reach me 08031234567 thanks')).toBe('08031234567');
    expect(extractNigerianPhoneFromText('+234 803 123 4567')).toBe('08031234567');
  });
});

describe('formatNigerianPhoneForClipboardPaste', () => {
  it('converts local GSM to compact +234 for WhatsApp / dialers', () => {
    expect(formatNigerianPhoneForClipboardPaste('08038661561')).toBe('+2348038661561');
    expect(formatNigerianPhoneForClipboardPaste('  08031234567  ')).toBe('+2348031234567');
  });

  it('normalizes spaced international input', () => {
    expect(formatNigerianPhoneForClipboardPaste('+234 803 123 4567')).toBe('+2348031234567');
  });

  it('passes through unknown shapes unchanged', () => {
    expect(formatNigerianPhoneForClipboardPaste('UK +44 20 7946 0958')).toBe('UK +44 20 7946 0958');
  });
});

describe('resolveOrderClipboardPhone', () => {
  it('prefers stored customer_phone', () => {
    expect(resolveOrderClipboardPhone({ customerPhone: ' 08031234567 ' })).toBe('08031234567');
  });

  it('falls back to custom field text', () => {
    expect(
      resolveOrderClipboardPhone({
        customerPhone: null,
        customFields: { alt: 'Backup line +2348031234567' },
      }),
    ).toBe('08031234567');
  });

  it('falls back to address line', () => {
    expect(
      resolveOrderClipboardPhone({
        customerPhone: null,
        customerAddress: '12 Allen, call 08031234567',
      }),
    ).toBe('08031234567');
  });
});
