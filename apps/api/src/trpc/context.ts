import type { Request, Response } from 'express';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { canViewAllBranches, canViewAllCountries } from '../common/authz';

/**
 * tRPC context — created for every request.
 * Contains the authenticated user (if any) and raw req/res.
 */
export interface TrpcContext {
  user: SessionUser | null;
  req: Request;
  res: Response;
  /** Raw session token — needed by procedures that mutate session (e.g. switchBranch). */
  sessionToken: string | null;
  /**
   * The active branch ID for this request, derived from the session.
   * NULL means the user has global visibility (SuperAdmin, all-branches mode).
   * Used by service methods that need explicit branch filtering on reads.
   */
  currentBranchId: string | null;
  /**
   * The concrete set of branch IDs this user is allowed to see when
   * `currentBranchId` is null ("All branches" view).
   *
   * - Global users (SuperAdmin, Admin, org-wide heads, etc.): `null` → truly
   *   unfiltered, they can see every branch in the org.
   * - Branch-scoped users (MB, CS_CLOSER, branch HoM, etc.): the user's
   *   `branchIds` array — "All branches" means "all MY branches", not every
   *   branch in the org.
   * - When `currentBranchId` is set (user picked a specific branch): `null` —
   *   use `currentBranchId` directly instead.
   *
   * Services should check: if `currentBranchId` → filter by that single branch;
   * else if `effectiveBranchIds` → filter by `IN (…)` union; else → no filter.
   */
  effectiveBranchIds: string[] | null;
  /** The active branch-group (company) ID from the session. */
  activeGroupId: string | null;
  /**
   * Multi-country data-scope — the concrete set of currency codes this request
   * is allowed to see. The country analogue of `effectiveBranchIds`, STACKS
   * with it (services push both a branch and a country condition).
   *
   *  - `null` → no country filter. MEDIA_BUYER, anyone with `countries.view_all`,
   *    and admin-level users see every country.
   *  - `['NGN']` → an unassigned non-view_all user: base country only
   *    (rollout-safe, never a fully empty app).
   *  - `[codes…]` → the user's explicitly assigned currencies.
   *
   * Built from the session's `currencyCodes` (from `user_countries`) at login.
   * See `countryScopeCondition`.
   */
  effectiveCurrencyCodes: string[] | null;
  /**
   * Multi-country VIEW — the single country the user has selected in the top-bar
   * switcher, or null for "all countries I can see". This narrows the effective
   * view WITHIN `effectiveCurrencyCodes` (the permission). Like `currentBranchId`
   * relative to `effectiveBranchIds`. Services can read this to show one country
   * at a time; `effectiveCurrencyCodes` already folds it in (see below).
   */
  currentCurrencyCode: string | null;
}

export function createContext(req: Request, res: Response): TrpcContext {
  const user = (req as Request & { user?: SessionUser }).user ?? null;
  const sessionToken = (req as Request & { sessionToken?: string }).sessionToken ?? null;
  const currentBranchId = user?.currentBranchId ?? null;
  const activeGroupId = user?.activeGroupId ?? null;

  // Resolve effectiveBranchIds: the concrete set of branch IDs this request
  // is allowed to see. Priority:
  //
  //  1. Single branch selected (currentBranchId is set) → null; use
  //     currentBranchId directly for filtering.
  //  2. Company selected ("All branches" within a company) → use
  //     selectedBranchIds from the session, which auth.service already scoped
  //     to the active group during login / switchBranch.
  //  3. Global user without company selection → null (truly org-wide).
  //  4. Branch-scoped user without company selection → user.branchIds.
  //
  // Case 2 is the critical multi-company isolation gate: when a SuperAdmin
  // picks "Rogue Tech", selectedBranchIds = [branch IDs in Rogue Tech only].
  // Without this, global users see data from every company.
  // Resolve effectiveBranchIds: the concrete set of branch IDs for the active
  // company. Used by services that need company-wide scoping (companyWideUserList,
  // order aggregates, etc.) even when a single branch is selected.
  //
  // Priority:
  //  1. selectedBranchIds from session (scoped to activeGroupId on login/switch)
  //  2. activeGroupId set but selectedBranchIds empty → empty array (match nothing)
  //  3. Non-global user without company → their personal branchIds
  //  4. Global user without company → null (truly org-wide)
  let effectiveBranchIds: string[] | null = null;
  if (user) {
    const selected = user.selectedBranchIds;
    if (selected && selected.length > 0) {
      // Company-scoped — use the group-filtered set regardless of whether
      // a single branch is selected. Pages like HR Users need this for
      // company-wide queries even when currentBranchId is set.
      effectiveBranchIds = selected;
    } else if (currentBranchId && !canViewAllBranches(user)) {
      // A branch-SCOPED user (e.g. Branch Admin) has a single branch selected but
      // selectedBranchIds is empty — the /auth/me backfill deliberately skips
      // selectedBranchIds when a single branch is selected. The selected branch IS
      // the unambiguous scope; use it directly. Without this the empty-group
      // fallback below matched NOTHING and emptied branch-scoped lists like the
      // attendance grid (which scopes only by effectiveBranchIds). Restricted to
      // non-all-branches users so admins' company-wide roster is untouched.
      effectiveBranchIds = [currentBranchId];
    } else if (activeGroupId) {
      // A company IS selected ("All branches") but selectedBranchIds is empty —
      // stale session or race before /auth/me backfill runs. Use a non-matching
      // UUID so IN-based filters return zero rows rather than leaking org-wide.
      effectiveBranchIds = ['00000000-0000-0000-0000-000000000000'];
    } else if (currentBranchId === null && !canViewAllBranches(user)) {
      // Non-global user at "All branches" without a company selection —
      // fall back to their personal branch memberships.
      const ids = user.branchIds ?? [];
      if (ids.length > 0) effectiveBranchIds = ids;
    }
    // else: global user without company selection AND no activeGroupId → null (org-wide).
  }

  // Resolve effectiveCurrencyCodes — the country-scope analogue of
  // effectiveBranchIds. Priority:
  //  1. No user → null (public/unauthed; procedures gate separately).
  //  2. canViewAllCountries (MB, admin-class, countries.view_all) → null (see all).
  //  3. Assigned currencyCodes present → exactly those.
  //  4. Non-view_all user with NO assignment → ['NGN'] (base country only,
  //     rollout-safe: never a fully empty app, foreign countries stay hidden).
  let effectiveCurrencyCodes: string[] | null = null;
  if (user) {
    if (canViewAllCountries(user)) {
      effectiveCurrencyCodes = null;
    } else {
      const assigned = user.currencyCodes ?? [];
      effectiveCurrencyCodes = assigned.length > 0 ? assigned : ['NGN'];
    }
  }

  // Multi-country VIEW switcher: when the user has picked a single country in the
  // top-bar, narrow the effective view to it — but ONLY to a country they are
  // allowed to see (never widens the permission). This is the country analogue of
  // currentBranchId narrowing within effectiveBranchIds.
  const currentCurrencyCode = user?.currentCurrencyCode
    ? user.currentCurrencyCode.toUpperCase()
    : null;
  if (currentCurrencyCode) {
    const allowed =
      effectiveCurrencyCodes == null || effectiveCurrencyCodes.includes(currentCurrencyCode);
    if (allowed) {
      // Narrow to the single selected country (within permission).
      effectiveCurrencyCodes = [currentCurrencyCode];
    }
    // If not allowed (stale selection after a revoke), ignore it and keep the
    // permission-scoped set — never expose a country the user can't see.
  }

  return {
    user,
    req,
    res,
    sessionToken,
    currentBranchId,
    effectiveBranchIds,
    activeGroupId,
    effectiveCurrencyCodes,
    currentCurrencyCode,
  };
}
