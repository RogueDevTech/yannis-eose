import { describe, it, expect } from 'vitest';
import { importStatusForAssignee } from './import-status';

describe('importStatusForAssignee', () => {
  it('writes an imported UNPROCESSED row that names a closer as CS_ASSIGNED', () => {
    expect(importStatusForAssignee('UNPROCESSED', 'closer-id')).toBe('CS_ASSIGNED');
  });

  it('keeps UNPROCESSED when no closer is named', () => {
    expect(importStatusForAssignee('UNPROCESSED', undefined)).toBe('UNPROCESSED');
    expect(importStatusForAssignee('UNPROCESSED', null)).toBe('UNPROCESSED');
  });

  it('never changes any other status', () => {
    for (const s of ['CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'DELIVERED', 'REMITTED', 'RETURNED']) {
      expect(importStatusForAssignee(s, 'closer-id')).toBe(s);
    }
  });
});
