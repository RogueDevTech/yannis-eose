import { describe, it, expect } from 'vitest';
import { DEFAULT_DUPLICATE_RULES, resolveDuplicateRules, duplicateRulesSchema } from './duplicate-rules';

describe('resolveDuplicateRules', () => {
  it('defaults are today\'s hard-coded behaviour', () => {
    expect(DEFAULT_DUPLICATE_RULES).toEqual({
      intakeBlock: { mode: 'BLOCK', windowDays: 14 },
      doubleSubmitGuard: { enabled: true, windowMinutes: 2 },
      manualOrderBlock: { mode: 'BLOCK', windowDays: 14 },
      cleanupCron: { mode: 'DELETE', windowDays: 14 },
      cartPullGuard: { enabled: true, windowDays: 14 },
      cartReconcile: { mode: 'DELETE' },
      cartMerge: { enabled: true },
      preDeliveryCheck: { mode: 'BLOCK', windowDays: 14 },
      graduationGuard: { enabled: true, windowDays: 14 },
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
    expect(resolveDuplicateRules({ intakeBlock: { mode: 'FLAG' } }).intakeBlock).toEqual({ mode: 'FLAG', windowDays: 14 });
  });

  it('a corrupt rule falls back to its default without touching valid ones', () => {
    const rules = resolveDuplicateRules({
      intakeBlock: { mode: 'NUKE', windowDays: 14 },
      cartMerge: { enabled: false },
      graduationGuard: { enabled: true, windowDays: 0 },
    });
    expect(rules.intakeBlock).toEqual(DEFAULT_DUPLICATE_RULES.intakeBlock);
    expect(rules.graduationGuard).toEqual(DEFAULT_DUPLICATE_RULES.graduationGuard);
    expect(rules.cartMerge).toEqual({ enabled: false });
  });

  it('never shares state with the defaults object', () => {
    const rules = resolveDuplicateRules(null);
    rules.intakeBlock.mode = 'OFF';
    expect(DEFAULT_DUPLICATE_RULES.intakeBlock.mode).toBe('BLOCK');
  });
});
