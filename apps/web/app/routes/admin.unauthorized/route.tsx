import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from '@remix-run/react';
import type { MetaFunction } from '@remix-run/node';
import { PermissionRequiredModal } from '~/components/ui/permission-required-modal';

export const meta: MetaFunction = () => {
  return [{ title: 'Yannis EOSE — Access Denied' }];
};

/**
 * Phase 21 — when a route guard rejects the actor, it redirects here with the
 * canonical permission codes encoded in `?required=...`. We render the
 * `<PermissionRequiredModal>` over a dimmed shell so the message is always
 * surfaced AND the actor can dismiss the modal to land on a fallback page.
 *
 * Query params (all optional):
 *  - `required=code1,code2`  — any-of permission list the actor was missing
 *  - `roles=ROLE_A,ROLE_B`   — additional role escapes that would also unblock
 *  - `action=human verb`     — verb to use in the message ("approve a funding request")
 *  - `from=/path`            — where the user was trying to go (used for Back link)
 */
export default function Unauthorized() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  const required = (searchParams.get('required') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const roles = (searchParams.get('roles') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const action = searchParams.get('action') ?? undefined;
  const from = searchParams.get('from') ?? undefined;

  const handleClose = () => {
    setOpen(false);
    // Send the user somewhere safe — back to admin dashboard, not the page that bounced them.
    navigate('/admin', { replace: true });
  };

  return (
    <>
      {/* Dimmed shell beneath the modal so the page doesn't read as blank when the
          modal is dismissed before the navigate fires. */}
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center max-w-md">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/30">
            <svg
              className="h-10 w-10 text-danger-600 dark:text-danger-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751A11.959 11.959 0 0 0 12 3.714Zm0 10.036h.008v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-app-fg">Access denied</h1>
          <p className="mt-3 text-sm text-app-fg-muted">
            {action
              ? `You don't have permission to ${action}.`
              : 'You do not have permission to view this page.'}
          </p>
          {from ? (
            <p className="mt-1 text-xs text-app-fg-muted font-mono break-all">{from}</p>
          ) : null}
          <Link
            to="/admin"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to dashboard
          </Link>
        </div>
      </div>

      <PermissionRequiredModal
        open={open}
        onClose={handleClose}
        required={required}
        action={action}
        // `roles` is informational fallback. We still primarily surface permission
        // codes — if the actor needs a role swap, the support note in the modal
        // tells them to contact an admin.
        actorRole={roles.length > 0 ? `One of: ${roles.join(', ')} (or any of the permissions below)` : undefined}
      />
    </>
  );
}
