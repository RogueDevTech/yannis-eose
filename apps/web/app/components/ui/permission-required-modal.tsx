import { Modal } from './modal';
import { Button } from './button';
import { canonicalPermissionCode, formatPermissionCode } from '~/lib/permission-codes';

/**
 * Phase 21 — Permission Required modal.
 *
 * Surfaced whenever the UI needs to tell the actor they're missing a permission
 * — used as both an inline gate (button click → modal) AND the layout shape of
 * the `/admin/unauthorized` route. Always lists the canonical permission codes
 * the actor would need ("any of") so admins can map the message back to the
 * matrix on `/hr/users/:id` or a custom role template.
 */

export interface PermissionRequiredModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Canonical or legacy permission codes — at least one of these would unblock
   * the action. We canonicalize on render so legacy aliases display next to
   * their current code without confusing the admin.
   */
  required: string[];
  /**
   * Optional human description of the action being attempted, e.g.
   * "approve a funding request", "create an offline order", "edit this
   * message template". When provided we lead the message with this verb.
   */
  action?: string;
  /**
   * Actor's role label — surfaced so administrators see at-a-glance which role
   * is being blocked when a user calls support.
   */
  actorRole?: string;
}

export function PermissionRequiredModal({
  open,
  onClose,
  required,
  action,
  actorRole,
}: PermissionRequiredModalProps) {
  // De-duplicate after canonicalizing so legacy + canonical of the same code
  // collapse to one chip.
  const canonical = Array.from(new Set(required.map((c) => canonicalPermissionCode(c))));

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-md"
      role="alertdialog"
      aria-labelledby="permission-required-title"
      aria-describedby="permission-required-body"
      contentClassName="p-6 space-y-5"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/30">
          <svg
            className="h-5 w-5 text-danger-600 dark:text-danger-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.75}
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="permission-required-title" className="text-base font-semibold text-app-fg">
            Permission required
          </h2>
          <p id="permission-required-body" className="mt-1 text-sm text-app-fg-muted leading-relaxed">
            {action ? (
              <>You don't have permission to {action}.</>
            ) : (
              <>You don't have permission to perform this action.</>
            )}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-app-border bg-app-hover/40 p-3 space-y-2">
        <p className="text-mini font-semibold uppercase tracking-wide text-app-fg-muted">
          {canonical.length === 1 ? 'Permission needed' : 'Any one of these permissions'}
        </p>
        <ul className="space-y-2">
          {canonical.map((code) => (
            <li key={code} className="flex items-start gap-2 text-app-fg">
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {formatPermissionCode(code)}
                </span>
                <code className="mt-0.5 inline-block rounded bg-app-elevated px-1.5 py-0.5 font-mono text-mini text-app-fg-muted break-all">
                  {code}
                </code>
              </span>
            </li>
          ))}
        </ul>
        {actorRole ? (
          <p className="text-mini text-app-fg-muted pt-1">
            Your current role: <span className="font-medium text-app-fg">{actorRole}</span>
          </p>
        ) : null}
      </div>

      <p className="text-xs text-app-fg-muted leading-relaxed">
        Ask a SuperAdmin or HR Manager to grant one of these permissions to your
        role template, or to your account directly via the user detail page.
      </p>

      <div className="flex justify-end pt-1">
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          Got it
        </Button>
      </div>
    </Modal>
  );
}
