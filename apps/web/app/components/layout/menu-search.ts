/**
 * Sidebar menu search — matches nav pages AND the tab sections inside them.
 *
 * Pure and separate from `sidebar.tsx` so the matching rules can be tested
 * without mounting the sidebar.
 */

export interface MenuSearchItem {
  label: string;
  href: string;
  tabs?: Array<{ value: string; label: string }>;
}

export interface MenuSearchGroup<TItem extends MenuSearchItem> {
  group: string | null;
  items: TItem[];
}

export interface MenuSearchResult<TItem extends MenuSearchItem> {
  /** The nav item to render. For a tab hit, `href` carries `?tab=<value>`. */
  item: TItem;
  group: string | null;
  /** Set only for a tab hit — the caller renders "Parent › Tab". */
  tabLabel?: string;
}

/**
 * Rules:
 *
 *  - a page matches on its own label OR its group name, so "hr" surfaces
 *    everything under the HR group;
 *  - a tab matches on the tab label, and deep-links to `?tab=<value>` — the
 *    pages read that param via `searchParams.get('tab')`, so the result opens
 *    the section directly;
 *  - a page whose OWN label matches is not expanded into all its tabs. Typing
 *    "settings" should list Settings once, not seven near-identical rows. Tabs
 *    surface when the tab label itself matches, or when the page was reached by
 *    a group-name match (where the page row is shown anyway).
 *
 * Permission filtering is inherited, not re-implemented: `groups` has already
 * been filtered to what this user may see, and a tab is only ever emitted for an
 * item in that list — so a tab can never surface a page the user cannot open.
 */
export function buildMenuSearchResults<TItem extends MenuSearchItem>(
  groups: Array<MenuSearchGroup<TItem>>,
  trimmedQuery: string,
): Array<MenuSearchResult<TItem>> {
  const q = trimmedQuery.toLowerCase();
  if (!q) return [];

  return groups.flatMap((g) =>
    g.items.flatMap((item) => {
      const labelHit = item.label.toLowerCase().includes(q);
      const groupHit = (g.group ?? '').toLowerCase().includes(q);
      const rows: Array<MenuSearchResult<TItem>> = [];

      if (labelHit || groupHit) rows.push({ item, group: g.group });

      if (!labelHit) {
        for (const tab of item.tabs ?? []) {
          if (!tab.label.toLowerCase().includes(q)) continue;
          rows.push({
            item: { ...item, href: `${item.href}?tab=${encodeURIComponent(tab.value)}` },
            group: g.group,
            tabLabel: tab.label,
          });
        }
      }

      return rows;
    }),
  );
}
