/**
 * Strict phone mode: a per-company system setting (CEO directive 2026-10-07).
 *
 * - ON (default, and when never configured): marketing roles never see the
 *   customer's full number on order detail pages. This is the original flow.
 * - OFF: marketing roles see the full number like every other role that may
 *   read the order.
 *
 * UI visibility only. Exports keep their own `*.export` permission gate.
 */
export const STRICT_PHONE_MODE_KEY = 'STRICT_PHONE_MODE';

const STRICT_PHONE_HIDDEN_ROLES: ReadonlySet<string> = new Set(['MEDIA_BUYER', 'HEAD_OF_MARKETING']);

/** Missing row or anything but an explicit `enabled: false` reads as ON (fail closed). */
export function isStrictPhoneModeOn(value: Record<string, unknown> | null | undefined): boolean {
  return value?.['enabled'] !== false;
}

/** Whether strict mode applies to this role at all (skip the setting lookup otherwise). */
export function isStrictPhoneModeRole(role: string): boolean {
  return STRICT_PHONE_HIDDEN_ROLES.has(role);
}

/** True when the customer's full number must stay hidden from this role. */
export function isCustomerPhoneHiddenForRole(role: string, strictModeOn: boolean): boolean {
  return strictModeOn && isStrictPhoneModeRole(role);
}
