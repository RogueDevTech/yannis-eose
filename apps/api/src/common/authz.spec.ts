import { describe, expect, it } from 'vitest';
import { canMirror } from './authz';

describe('canMirror', () => {
  it('allows Head of Marketing to mirror a media buyer without org-wide-head scope', () => {
    expect(
      canMirror(
        {
          id: 'actor',
          role: 'HEAD_OF_MARKETING',
          permissions: ['users.read', 'mirror.marketing_team'],
          currentBranchId: null,
        },
        { id: 'target', role: 'MEDIA_BUYER', primaryBranchId: 'branch-a' },
      ),
    ).toBe(true);
  });

  it('keeps head mirror access limited to direct reports', () => {
    expect(
      canMirror(
        {
          id: 'actor',
          role: 'HEAD_OF_CS',
          permissions: ['mirror.cs_team'],
          currentBranchId: null,
        },
        { id: 'target', role: 'HEAD_OF_CS', primaryBranchId: 'branch-a' },
      ),
    ).toBe(false);
  });
});
