import { describe, it, expect } from 'vitest';
import {
  formatProductsOrdered,
  totalOrderQuantity,
  expandExportStatusFilter,
} from './reports.service';

/**
 * Regression cover for the Delivered Orders export losing "Products Ordered".
 * `cs_orders` advertised product/quantity columns in the UI and the zod enum
 * while the service emitted neither, so the column silently came back empty.
 */
describe('export product columns', () => {
  describe('formatProductsOrdered', () => {
    it('lists every line item with its quantity for a multi-product order', () => {
      expect(
        formatProductsOrdered({
          productItems: [
            { name: 'Vitamin C', qty: 2 },
            { name: 'Collagen', qty: 1 },
          ],
        }),
      ).toBe('Vitamin C x2; Collagen x1');
    });

    it('includes the offer label as a variant when the source provides one', () => {
      expect(
        formatProductsOrdered({
          items: [
            { productName: 'BCG-35', quantity: 2, offerLabel: '3 pack' },
            { productName: 'Serum', quantity: 1, offerLabel: null },
          ],
        }),
      ).toBe('BCG-35 (3 pack) x2; Serum x1');
    });

    it('falls back to the primary product name when no breakdown exists', () => {
      expect(formatProductsOrdered({ primaryProductName: 'Vitamin C' })).toBe('Vitamin C');
    });

    it('renders a dash rather than an empty cell when there are no items', () => {
      expect(formatProductsOrdered({})).toBe('—');
    });

    it('does not drop a line whose product name is missing', () => {
      expect(formatProductsOrdered({ productItems: [{ name: null, qty: 4 }] })).toBe('Unknown x4');
    });
  });

  describe('totalOrderQuantity', () => {
    it('sums units across all lines instead of reporting only the first', () => {
      expect(
        totalOrderQuantity({
          productItems: [
            { name: 'Vitamin C', qty: 2 },
            { name: 'Collagen', qty: 1 },
          ],
          // The old behaviour returned this: the first line only.
          primaryQuantity: 2,
        }),
      ).toBe(3);
    });

    it('sums the follow-up list shape too', () => {
      expect(
        totalOrderQuantity({
          items: [
            { productName: 'A', quantity: 5 },
            { productName: 'B', quantity: 7 },
          ],
        }),
      ).toBe(12);
    });

    it('falls back to the primary quantity when no breakdown exists', () => {
      expect(totalOrderQuantity({ primaryQuantity: 3 })).toBe(3);
    });

    it('returns an empty cell rather than 0 when quantity is unknown', () => {
      expect(totalOrderQuantity({})).toBe('');
    });
  });

  describe('expandExportStatusFilter', () => {
    it('rolls REMITTED into a Delivered export, matching the Delivered pill', () => {
      expect(expandExportStatusFilter('DELIVERED')).toEqual({
        statuses: ['DELIVERED', 'REMITTED'],
      });
    });

    it('expands Confirmed across the dispatch chain, matching the Confirmed pill', () => {
      expect(expandExportStatusFilter('CONFIRMED')).toEqual({
        statuses: ['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'],
      });
    });

    it('passes any other status through untouched', () => {
      expect(expandExportStatusFilter('UNPROCESSED')).toEqual({ status: 'UNPROCESSED' });
    });

    it('applies no status filter when none was chosen', () => {
      expect(expandExportStatusFilter(undefined)).toEqual({});
    });
  });
});
