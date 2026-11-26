/**
 * Which CS branch gets a cart order when the matching cart routing rule has no
 * target branch.
 *
 * The cart stays on its own form branch, like a funnel order with no CS routing
 * rule. Only a form branch with no active CS department falls back to
 * round-robin across the company's CS branches.
 *
 * Why (2026-11-26): 2B21 had no cart routing rules, so its carts hit the global
 * "All other countries (round-robin)" rule and were dealt in turn to Nigeria,
 * Ghana, Kenya, Tanzania and Zambia Zarvon. About 4 in 5 Nigerian cart orders
 * landed with a foreign CS team; none of those were delivered (300 stuck since
 * 15 Sep). Round-robin cannot see a branch's country, so it must not be the
 * default. To send a country's carts to a specific branch, add a currency rule
 * with a target branch.
 */
export function noTargetServicingBranch(
  cartBranchId: string | null,
  activeCsBranchIds: readonly string[],
  roundRobinOffset: number,
): string | null {
  if (activeCsBranchIds.length === 0) return null;
  if (cartBranchId && activeCsBranchIds.includes(cartBranchId)) return cartBranchId;
  const idx = Math.abs(roundRobinOffset) % activeCsBranchIds.length;
  return activeCsBranchIds[idx] ?? null;
}
