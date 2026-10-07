import { describe, it, expect } from 'vitest';
import { DEFAULT_DUPLICATE_RULES, resolveDuplicateRules, duplicateRulesSchema } from './duplicate-rules';

describe('resolveDuplicateRules', () => {
  it('defaults are every rule off (owner decision 2026-10-07)', () => {
    expect(DEFAULT_DUPLICATE_RULES).toEqual({
      intakeBlock: { mode: 'OFF', windowDays: 14 },
      manualOrderBlock: { mode: 'OFF', windowDays: 14 },
      cleanupCron: { mode: 'OFF', windowDays: 14 },
      cartPullGuard: { enabled: false, windowDays: 14 },
      cartReconcile: { mode: 'OFF' },
      cartMerge: { enabled: false },
      preDeliveryCheck: { mode: 'OFF', windowDays: 14 },
      graduationGuard: { enabled: false, windowDays: 14 },
    });
    expect(duplicateRulesSchema.safeParse(DEFAULT_DUPLICATE_RULES).success).toBe(true);
  });

  it('returns defaults for missing or non-object values', () => {
    for (const raw of [null, undefined, 'x', 42, []]) {
      expect(resolveDuplicateRules(raw)).toEqual(DEFAULT_DUPLICATE_RULES);
    }
  });

  it('applies a stored rule and keeps the others at their defaults', () => {
    const rules = resolveDuplicateRules({ cleanupCron: { mode: 'FLAG', windowDays: 7 } });
    expect(rules.cleanupCron).toEqual({ mode: 'FLAG', windowDays: 7 });
    expect(rules.intakeBlock).toEqual(DEFAULT_DUPLICATE_RULES.intakeBlock);
  });

  it('merges a partial rule over its default', () => {
    expect(resolveDuplicateRules({ intakeBlock: { mode: 'BLOCK' } }).intakeBlock).toEqual({ mode: 'BLOCK', windowDays: 14 });
  });

  it('a corrupt rule falls back to its default without touching valid ones', () => {
    const rules = resolveDuplicateRules({
      intakeBlock: { mode: 'NUKE', windowDays: 14 },
      cartMerge: { enabled: true },
      graduationGuard: { enabled: true, windowDays: 0 },
    });
    expect(rules.intakeBlock).toEqual(DEFAULT_DUPLICATE_RULES.intakeBlock);
    expect(rules.graduationGuard).toEqual(DEFAULT_DUPLICATE_RULES.graduationGuard);
    expect(rules.cartMerge).toEqual({ enabled: true });
  });

  it('never shares state with the defaults object', () => {
    const rules = resolveDuplicateRules(null);
    rules.intakeBlock.mode = 'BLOCK';
    expect(DEFAULT_DUPLICATE_RULES.intakeBlock.mode).toBe('OFF');
  });
});
