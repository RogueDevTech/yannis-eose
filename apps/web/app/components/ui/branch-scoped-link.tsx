import { forwardRef } from 'react';
import { Link, type LinkProps } from '@remix-run/react';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';

/**
 * Drop-in replacement for `<Link>` that pops the branch-picker modal BEFORE
 * navigating, when the active user is an org-wide department head viewing
 * "All Branches" with multiple branches available.
 *
 * Usage:
 * ```tsx
 * <BranchScopedLink to="/admin/marketing/forms/new" actionLabel="creating a form">
 *   <Button variant="primary" size="sm">+ New Form</Button>
 * </BranchScopedLink>
 * ```
 *
 * Behaviour:
 * - When `requiresBranchSelection` is false (admin-class users, single-branch
 *   org-wide heads, anyone with a branch already selected), behaves exactly
 *   like a regular `<Link>` — no extra render, no modal, no extra round-trip.
 * - When it's true, the click is preventDefault'd and the existing modal pops
 *   with the supplied `actionLabel`. After the user picks a branch, the
 *   provider includes `next=<to>` in the POST to /admin/branches/switch which
 *   redirects there directly — preserving a single-click flow.
 *
 * Pairs with the loader-side `ensureBranchScopeOrRedirect` safety net for
 * deep links / bookmarks / search-modal jumps that bypass this click handler.
 */
export type BranchScopedLinkProps = LinkProps & {
  /**
   * Short verb-phrase rendered in the modal copy:
   * "Pick a branch to continue with {actionLabel}."
   * Examples: "creating a form", "editing this user", "adding ad spend".
   */
  actionLabel?: string;
};

export const BranchScopedLink = forwardRef<HTMLAnchorElement, BranchScopedLinkProps>(
  function BranchScopedLink({ to, actionLabel, onClick, ...rest }, ref) {
    const { requiresBranchSelection, ensureBranchForAction } = useBranchScopeActionGuard();

    const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
      // Honour modifier-clicks (cmd/ctrl/shift/alt or middle-click) — the user
      // wants a new tab; let the browser handle it natively. The new tab will
      // hit the loader-side safety net and pop the modal there if needed.
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        onClick?.(event);
        return;
      }

      onClick?.(event);
      if (event.defaultPrevented) return;

      if (requiresBranchSelection) {
        event.preventDefault();
        const nextHref = typeof to === 'string' ? to : null;
        ensureBranchForAction({
          actionLabel,
          ...(nextHref ? { nextHref } : {}),
        });
      }
    };

    return <Link ref={ref} to={to} onClick={handleClick} {...rest} />;
  },
);
