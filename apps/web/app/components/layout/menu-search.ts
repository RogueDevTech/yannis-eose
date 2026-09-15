/**
 * Sidebar menu search — matches nav pages AND the tab sections inside them.
 *
 * The matching itself lives in `~/lib/route-search`, shared with the Cmd+K
 * command palette so the sidebar filter and the palette rank identically.
 * This file keeps the sidebar's own types and its flat, ranked output.
 *
 * Permission filtering is inherited, not re-implemented: `groups` has already
 * been filtered to what this user may see, and a tab is only ever emitted for
 * an item in that list — so a tab can never surface a page the user cannot
 * open.
 */

import {
  searchRoutes,
  type RouteSearchGroup,
  type RouteSearchItem,
  type RouteSearchHit,
} from '~/lib/route-search';

export type MenuSearchItem = RouteSearchItem;
export type MenuSearchGroup<TItem extends MenuSearchItem> = RouteSearchGroup<TItem>;

export interface MenuSearchResult<TItem extends MenuSearchItem> {
  /** The nav item to render. For a tab hit, `href` carries `?tab=<value>`. */
  item: TItem;
  group: string | null;
  /** Set only for a tab hit — the caller renders "Parent › Tab". */
  tabLabel?: string;
}

/**
 * Rank the nav tree against `trimmedQuery`, best match first.
 *
 * Matching is typo-, acronym- and synonym-tolerant (see `~/lib/smart-search`):
 * "remitance" still reaches Cash remittance, "cr" reaches it by acronym, and a
 * page's `keywords` let "salary" reach Payroll. Every word of a multi-word
 * query must match something, in any order.
 */
export function buildMenuSearchResults<TItem extends MenuSearchItem>(
  groups: Array<MenuSearchGroup<TItem>>,
  trimmedQuery: string,
): Array<MenuSearchResult<TItem>> {
  return searchRoutes(groups, trimmedQuery).map(
    ({ item, group, tabLabel }: RouteSearchHit<TItem>) => ({
      item,
      group,
      ...(tabLabel ? { tabLabel } : {}),
    }),
  );
}
