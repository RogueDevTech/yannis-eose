import { describe, it, expect } from 'vitest';

/**
 * Cross-company branch memberships must survive a user edit.
 *
 * The edit form loads ALL branches (admins use `branches.listAll`) but used to
 * receive only the ACTIVE company's memberships from `getById`. A company group
 * is ticked only when every branch in it is selected, so another company's group
 * rendered UNCHECKED even though the membership existed — and because the form
 * submits `selectedBranchIds` wholesale into a delete-and-reinsert, saving then
 * silently REVOKED that invisible membership.
 *
 * Mirrors the preservation logic in UsersService.update.
 */
type Membership = { branchId: string; isPrimary: boolean };

function resolveMembershipWrite(args: {
  existing: Membership[];
  submitted: string[];
  effectiveBranchIds: string[] | null;
  primaryFromForm: string | null;
}) {
  const { existing, submitted, effectiveBranchIds, primaryFromForm } = args;
  const existingIds = existing.map((m) => m.branchId);

  const outOfScope =
    effectiveBranchIds != null
      ? existingIds.filter((id) => !effectiveBranchIds.includes(id))
      : [];

  const toWrite = [...new Set([...submitted, ...outOfScope])];
  const preservedPrimary = new Set(
    existing.filter((m) => m.isPrimary && outOfScope.includes(m.branchId)).map((m) => m.branchId),
  );

  return {
    branchIds: toWrite.sort(),
    primaryIds: toWrite
      .filter((id) => id === primaryFromForm || preservedPrimary.has(id))
      .sort(),
    // What the campaign/roster cleanup treats as dropped.
    removed: existingIds.filter((id) => !toWrite.includes(id)).sort(),
  };
}

const YANNIS = ['y1', 'y2'];

describe('cross-company membership preservation', () => {
  it('keeps the other company membership the form could not show', () => {
    const r = resolveMembershipWrite({
      existing: [
        { branchId: 'y1', isPrimary: true },
        { branchId: 'z1', isPrimary: false }, // Zarvon — invisible to this editor
      ],
      submitted: ['y1'],
      effectiveBranchIds: YANNIS,
      primaryFromForm: 'y1',
    });
    expect(r.branchIds).toEqual(['y1', 'z1']);
    expect(r.removed).toEqual([]);
  });

  it('does not report a preserved branch as removed', () => {
    // Guards the campaign-deactivation path: treating a preserved membership as
    // dropped would deactivate another company's sales forms.
    const r = resolveMembershipWrite({
      existing: [
        { branchId: 'y1', isPrimary: true },
        { branchId: 'z1', isPrimary: false },
      ],
      submitted: ['y1'],
      effectiveBranchIds: YANNIS,
      primaryFromForm: 'y1',
    });
    expect(r.removed).not.toContain('z1');
  });

  it('preserves the out-of-scope membership own primary flag', () => {
    const r = resolveMembershipWrite({
      existing: [
        { branchId: 'y1', isPrimary: false },
        { branchId: 'z1', isPrimary: true },
      ],
      submitted: ['y1'],
      effectiveBranchIds: YANNIS,
      primaryFromForm: 'y1',
    });
    expect(r.primaryIds).toEqual(['y1', 'z1']);
  });

  it('still removes an in-scope branch the admin actually unchecked', () => {
    const r = resolveMembershipWrite({
      existing: [
        { branchId: 'y1', isPrimary: true },
        { branchId: 'y2', isPrimary: false },
        { branchId: 'z1', isPrimary: false },
      ],
      submitted: ['y1'],
      effectiveBranchIds: YANNIS,
      primaryFromForm: 'y1',
    });
    expect(r.branchIds).toEqual(['y1', 'z1']);
    expect(r.removed).toEqual(['y2']); // intended removal still happens
  });

  it('an org-wide editor (null scope) can genuinely remove any branch', () => {
    // They see everything, so nothing is preserved behind their back.
    const r = resolveMembershipWrite({
      existing: [
        { branchId: 'y1', isPrimary: true },
        { branchId: 'z1', isPrimary: false },
      ],
      submitted: ['y1'],
      effectiveBranchIds: null,
      primaryFromForm: 'y1',
    });
    expect(r.branchIds).toEqual(['y1']);
    expect(r.removed).toEqual(['z1']);
  });

  it('adding a second company alongside the first keeps both', () => {
    const r = resolveMembershipWrite({
      existing: [{ branchId: 'y1', isPrimary: true }],
      submitted: ['y1', 'y2'],
      effectiveBranchIds: YANNIS,
      primaryFromForm: 'y1',
    });
    expect(r.branchIds).toEqual(['y1', 'y2']);
  });
});
