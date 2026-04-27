import { extractApiErrorMessage } from './api-error';

function collectTrpcDataCodes(value: unknown, out: string[]): void {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const x of value) collectTrpcDataCodes(x, out);
    return;
  }
  const o = value as Record<string, unknown>;
  const data = o['data'];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const code = (data as Record<string, unknown>)['code'];
    if (typeof code === 'string') out.push(code);
  }
  for (const v of Object.values(o)) {
    if (v != null && typeof v === 'object') collectTrpcDataCodes(v, out);
  }
}

/**
 * True when `orders.getById` (or equivalent) failed because the order is absent — not for 5xx / DB drift.
 */
export function trpcOrderGetByIdIsNotFound(httpStatus: number, payload: unknown): boolean {
  if (httpStatus === 404) return true;
  const msg = extractApiErrorMessage(payload, '').toLowerCase();
  if (msg.includes('order not found')) return true;
  const codes: string[] = [];
  collectTrpcDataCodes(payload, codes);
  return codes.includes('NOT_FOUND');
}
