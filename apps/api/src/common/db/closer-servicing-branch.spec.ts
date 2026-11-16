import { describe, it, expect } from 'vitest';
import { pickCloserServicingBranch, type CloserBranch } from './closer-servicing-branch';

const GROUPS: Record<string, string> = {
  'yns-remote': 'YNS',
  'yns-ibadan': 'YNS',
  'yns-kenya': 'YNS',
  'zar-kenya': '2B21',
  'zar-ghana': '2B21',
};
const groupOf = (b: string) => GROUPS[b] ?? null;
const br = (branchId: string, isPrimary = false): CloserBranch => ({
  branchId,
  groupId: groupOf(branchId),
  isPrimary,
  branchName: branchId,
});

describe('pickCloserServicingBranch', () => {
  it('never moves a Yannis order into a 2B21 branch (Nov 2026 Kenya Zarvon bug)', () => {
    // Closer's first branch row is 2B21 Kenya Zarvon; the old code took it.
    const closer = [br('zar-kenya', true), br('yns-kenya')];
    expect(
      pickCloserServicingBranch({ branchId: 'yns-remote', servicingBranchId: 'yns-remote' }, closer, groupOf),
    ).toBe('yns-kenya');
  });

  it('leaves the order where it is when the closer has no branch in its company', () => {
    expect(
      pickCloserServicingBranch({ branchId: 'yns-ibadan', servicingBranchId: 'yns-remote' }, [br('zar-kenya')], groupOf),
    ).toBeNull();
  });

  it('keeps the current servicing branch when the closer works it', () => {
    const closer = [br('yns-kenya', true), br('yns-remote')];
    expect(
      pickCloserServicingBranch({ branchId: 'yns-ibadan', servicingBranchId: 'yns-remote' }, closer, groupOf),
    ).toBe('yns-remote');
  });

  it('prefers the primary branch, then name order, inside the company', () => {
    expect(
      pickCloserServicingBranch(
        { branchId: 'yns-ibadan', servicingBranchId: 'yns-ibadan' },
        [br('yns-remote'), br('yns-kenya', true)],
        groupOf,
      ),
    ).toBe('yns-kenya');
    expect(
      pickCloserServicingBranch(
        { branchId: 'yns-ibadan', servicingBranchId: 'yns-ibadan' },
        [br('yns-remote'), br('yns-kenya')],
        groupOf,
      ),
    ).toBe('yns-kenya');
  });

  it('a 2B21 order still moves to the closer 2B21 branch', () => {
    expect(
      pickCloserServicingBranch(
        { branchId: 'zar-ghana', servicingBranchId: 'zar-ghana' },
        [br('yns-kenya', true), br('zar-kenya')],
        groupOf,
      ),
    ).toBe('zar-kenya');
  });

  it('falls back to the servicing branch company when the marketing branch is unknown', () => {
    expect(
      pickCloserServicingBranch({ branchId: null, servicingBranchId: 'zar-ghana' }, [br('yns-kenya'), br('zar-kenya')], groupOf),
    ).toBe('zar-kenya');
  });
});
