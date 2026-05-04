import { describe, expect, it } from 'vitest';
import { mergePermissionSnapshot } from './permission-snapshot-merge';

describe('mergePermissionSnapshot', () => {
  it('uses template when overrides empty', () => {
    const r = mergePermissionSnapshot(['snapshot.test.a', 'snapshot.test.b'], {});
    expect(r.granted.sort()).toEqual(['snapshot.test.a', 'snapshot.test.b']);
    expect(r.revoked).toEqual([]);
  });

  it('revokes inherited permission when override false', () => {
    const r = mergePermissionSnapshot(['snapshot.test.a', 'snapshot.test.b'], { 'snapshot.test.a': false });
    expect(r.granted).toEqual(['snapshot.test.b']);
    expect(r.revoked).toEqual(['snapshot.test.a']);
  });

  it('grants extra permission not on template', () => {
    const r = mergePermissionSnapshot(['snapshot.test.a'], { 'snapshot.test.extra': true });
    expect(r.granted.sort()).toEqual(['snapshot.test.a', 'snapshot.test.extra']);
    expect(r.revoked).toEqual([]);
  });
});
