import { describe, it, expect } from 'vitest';
import { OrdersService } from './orders.service';

/**
 * `applyViewerPhoneDisplay` powers the Marketing Orders phone column. Runs the
 * real method with the DB (branch → company) and settings stubbed.
 */

const BRANCH_OPEN = 'branch-open';
const BRANCH_STRICT = 'branch-strict';
const BRANCH_NO_SETTING = 'branch-no-setting';

function makeService(opts: { voip?: boolean } = {}) {
  const branchGroups: Record<string, string | null> = {
    [BRANCH_OPEN]: 'company-open',
    [BRANCH_STRICT]: 'company-strict',
    [BRANCH_NO_SETTING]: 'company-unset',
  };
  const settings: Record<string, Record<string, unknown> | null> = {
    'VOIP_ENABLED': { enabled: opts.voip === true },
    'company-open:STRICT_PHONE_MODE': { enabled: false },
    'company-strict:STRICT_PHONE_MODE': { enabled: true },
  };
  const service = Object.create(OrdersService.prototype) as OrdersService;
  Object.assign(service, {
    db: {
      select: () => ({
        from: () => ({
          where: async () =>
            Object.entries(branchGroups).map(([id, groupId]) => ({ id, groupId })),
        }),
      }),
    },
    settingsService: {
      get: async (key: string, groupId?: string | null) =>
        settings[groupId ? `${groupId}:${key}` : key] ?? null,
    },
  });
  return service;
}

const row = (branchId: string | null, customerPhone: string | null = '08031234567') => ({
  id: `o-${branchId}`,
  branchId,
  currencyCode: 'NGN',
  customerPhone,
  customerPhoneDisplay: '0803****4567',
});

const mb = { id: 'mb-1', role: 'MEDIA_BUYER', permissions: [] } as never;
const hom = { id: 'hom-1', role: 'HEAD_OF_MARKETING', permissions: [] } as never;
const cs = { id: 'cs-1', role: 'CS_CLOSER', permissions: [] } as never;

describe('applyViewerPhoneDisplay (Marketing Orders phone column)', () => {
  it('shows the full number to marketing only where the company turned strict mode off', async () => {
    const out = await makeService().applyViewerPhoneDisplay(
      [row(BRANCH_OPEN), row(BRANCH_STRICT), row(BRANCH_NO_SETTING), row(null)],
      mb,
    );
    expect(out.map((r) => r.customerPhoneDisplay)).toEqual([
      '08031234567',
      '0803****4567',
      '0803****4567', // never saved = strict
      '0803****4567', // no branch = strict
    ]);
  });

  it('applies the same rule to Heads of Marketing', async () => {
    const out = await makeService().applyViewerPhoneDisplay([row(BRANCH_OPEN), row(BRANCH_STRICT)], hom);
    expect(out.map((r) => r.customerPhoneDisplay)).toEqual(['08031234567', '0803****4567']);
  });

  it('never applies strict mode to non-marketing roles', async () => {
    const out = await makeService().applyViewerPhoneDisplay([row(BRANCH_STRICT)], cs);
    expect(out[0]!.customerPhoneDisplay).toBe('08031234567');
  });

  it('hides the number from everyone when VOIP is on', async () => {
    const svc = makeService({ voip: true });
    expect((await svc.applyViewerPhoneDisplay([row(BRANCH_OPEN)], mb))[0]!.customerPhoneDisplay).toBe('0803****4567');
    expect((await svc.applyViewerPhoneDisplay([row(BRANCH_OPEN)], cs))[0]!.customerPhoneDisplay).toBe('0803****4567');
  });

  it('keeps the masked display when no raw number is stored', async () => {
    const out = await makeService().applyViewerPhoneDisplay([row(BRANCH_OPEN, null)], mb);
    expect(out[0]!.customerPhoneDisplay).toBe('0803****4567');
  });

  it('never returns the raw customerPhone field, whatever the outcome', async () => {
    for (const svc of [makeService(), makeService({ voip: true })]) {
      for (const actor of [mb, cs]) {
        const out = await svc.applyViewerPhoneDisplay([row(BRANCH_OPEN), row(BRANCH_STRICT)], actor);
        for (const r of out) expect('customerPhone' in r).toBe(false);
      }
    }
  });
});
