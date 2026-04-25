/**
 * Mirror Mode read-only enforcement (frontend mirror of the backend gate).
 *
 * Backend: `apps/api/src/trpc/trpc.ts::blockMutationsWhileMirroring` rejects every
 * tRPC mutation while the session is mirroring with this exact message. Action
 * handlers forward it verbatim as `{ error }`, so we can detect mirror-blocked
 * responses anywhere a fetcher result lands.
 *
 * The frontend uses three layers — all keyed off `<html data-mirror="1">`, set
 * by DashboardLayout when `user.mirroredBy` is present:
 *
 * 1. CSS visual: `tailwind.css` greys out inputs/buttons inside mutation forms.
 * 2. `inert` attribute: applied to mutation forms in DashboardLayout so the
 *    admin can't focus or type into fields at all.
 * 3. Submit interceptor: prevents the network round-trip and shows the modal
 *    immediately. The fetcher-data watcher in `mirror-readonly-modal.tsx` is
 *    the fallback for programmatic mutations that bypass `<form>` submission.
 */
export const MIRROR_BLOCKED_MESSAGE =
  'Read-only while mirroring user. Exit mirror mode to make changes.';

/**
 * Selector for forms that mutate the *target's* data — these get visually
 * disabled and have submission intercepted while mirroring.
 *
 * `[method="post" i]` is case-insensitive. Forms opt OUT of mirror enforcement
 * by adding `data-mirror-allow` (Exit Mirror, Logout, Branch switch).
 */
export const MIRROR_MUTATION_FORM_SELECTOR =
  'form[method="post" i]:not([data-mirror-allow])';

/** True when the action response carries the mirror-blocked error. */
export function isMirrorBlockedError(value: unknown): boolean {
  if (typeof value === 'string') return value === MIRROR_BLOCKED_MESSAGE;
  if (value && typeof value === 'object') {
    const err = (value as { error?: unknown }).error;
    if (typeof err === 'string') return err === MIRROR_BLOCKED_MESSAGE;
  }
  return false;
}
