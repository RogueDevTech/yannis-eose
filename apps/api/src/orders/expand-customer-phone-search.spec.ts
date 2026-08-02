import { describe, expect, it } from 'vitest';
import { expandCustomerPhoneSearchDigitRuns } from './orders.service';

describe('expandCustomerPhoneSearchDigitRuns', () => {
  it('maps +234 international run to local 0-prefixed form', () => {
    expect(expandCustomerPhoneSearchDigitRuns('2348031234567').sort()).toEqual(
      ['08031234567', '2348031234567'].sort(),
    );
  });

  it('maps local 11-digit run to international 234 form', () => {
    expect(expandCustomerPhoneSearchDigitRuns('08031234567').sort()).toEqual(
      ['08031234567', '2348031234567'].sort(),
    );
  });

  it('expands 10-digit national significant number', () => {
    expect(expandCustomerPhoneSearchDigitRuns('8031234567').sort()).toEqual(
      ['08031234567', '2348031234567', '8031234567'].sort(),
    );
  });

  it('expands a stored 0-prefixed phone so global search matches it (regression: 08127768540)', () => {
    // A 0-prefixed 11-digit phone typed into global search must yield an ILIKE
    // run that matches the value stored in customer_phone (`08127768540`).
    const runs = expandCustomerPhoneSearchDigitRuns('08127768540');
    expect(runs).toContain('08127768540');
    expect(runs).toContain('2348127768540');
  });
});
