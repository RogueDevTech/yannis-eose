/**
 * Retiring a logistics location.
 *
 * The bug: `deleteLocation` guarded on `SUM(inventory_levels.stock_count) > 0`
 * and hard-deleted when the total was 0. But `inventory_levels` rows PERSIST at
 * `stock_count = 0` once stock moves out, so any location that had ever held
 * stock passed the guard and then died on
 * `inventory_levels_location_id_logistics_locations_id_fk` — a raw 500 telling
 * the user to "move or write off all stock first" when there was no stock. HoL
 * hit this twice in production.
 *
 * 13 FKs across 12 tables reference logistics_locations and none cascades, four
 * of them holding financial history, so archiving is the only correct
 * retirement path for a used location.
 *
 * These drive the real reference-counting and summary helpers against a stubbed
 * db rather than standing up the Nest graph.
 */
import { describe, expect, it, vi } from 'vitest';
import { LogisticsService } from './logistics.service';

interface Harness {
  db: unknown;
  logger: { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  deleteLocation: (id: string, actor: string) => Promise<Record<string, unknown>>;
  restoreLocation: (id: string, actor: string) => Promise<Record<string, unknown>>;
  formatReferenceSummary: (c: Array<{ label: string; n: number }>) => string;
  locationReferenceChecks: (id: string) => unknown[];
}

function harness(): Harness {
  // Private members collapse an intersection to `never`, so go via unknown and
  // describe only what these helpers touch.
  const svc = Object.create(LogisticsService.prototype) as unknown as Harness;
  svc.logger = { log: vi.fn(), warn: vi.fn() };
  return svc;
}

const LOC = '0192f8c4-2222-7000-8000-000000000001';

describe('formatReferenceSummary', () => {
  it('lists only non-zero references, pluralised', () => {
    const svc = harness();
    expect(
      svc.formatReferenceSummary([
        { label: 'stock movement', n: 3 },
        { label: 'shipment', n: 0 },
        { label: 'order', n: 1 },
      ]),
    ).toBe('3 stock movements, 1 order');
  });

  it('is empty when nothing references the location', () => {
    const svc = harness();
    expect(svc.formatReferenceSummary([{ label: 'order', n: 0 }])).toBe('');
  });
});

describe('locationReferenceChecks', () => {
  // Every FK must be covered, or a location can still die on the constraint.
  it('covers all ten referencing tables', () => {
    const svc = harness();
    expect(svc.locationReferenceChecks(LOC)).toHaveLength(10);
  });

  it('names each reference in user-facing language', () => {
    const svc = harness();
    const labels = (svc.locationReferenceChecks(LOC) as Array<{ label: string }>).map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'stock movement',
        'stock transfer',
        'shipment',
        'delivery remittance',
        'transfer remittance',
        'stock reconciliation',
        'inventory record',
        'order',
        'cart order',
        'follow-up order',
      ]),
    );
    // No snake_case or table names leaking into a message the user reads.
    for (const l of labels) expect(l).not.toMatch(/_/);
  });
});
