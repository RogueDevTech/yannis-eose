import { describe, expect, it } from 'vitest';
import { reportColumnsByKey } from '@yannis/shared/validators';
import { EXPORT_CONFIGS } from './export-config';

// Every column the export modal can send must be in the API's enum, or the
// export fails validation (e.g. cart_orders 'quantity', marketing_team 'adSpend').
describe('EXPORT_CONFIGS column parity with reportColumnsByKey', () => {
  for (const [key, config] of Object.entries(EXPORT_CONFIGS)) {
    it(`${key}: columns and defaults are accepted by the API`, () => {
      const allowed = new Set<string>(reportColumnsByKey[key as keyof typeof reportColumnsByKey]);
      expect(config.columns.map((c) => c.key).filter((k) => !allowed.has(k))).toEqual([]);
      expect(config.defaultColumns.filter((k) => !allowed.has(k))).toEqual([]);
    });
  }
});
