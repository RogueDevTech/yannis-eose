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
});
