import { describe, expect, it } from 'vitest';
import { extractApiErrorMessage } from './api-error';

describe('extractApiErrorMessage', () => {
  it('prefers nested error.message', () => {
    expect(extractApiErrorMessage({ error: { message: 'Transition failed' } })).toBe('Transition failed');
  });

  it('handles tokenized array payloads', () => {
    const payload = [{ _1: 2 }, 'data', { _3: 4 }, 'error', 'This 3PL location has no inventory row'];
    expect(extractApiErrorMessage(payload, 'Fallback')).toBe('This 3PL location has no inventory row');
  });

  it('falls back when payload has no useful text', () => {
    expect(extractApiErrorMessage(null, 'Fallback')).toBe('Fallback');
  });

  it('handles plain string payload', () => {
    expect(extractApiErrorMessage('Custom plain message')).toBe('Custom plain message');
  });
});
