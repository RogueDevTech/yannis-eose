/**
 * Route search — ranks nav pages (and the tab sections inside them) against a
 * query, and works out which pages a NAMED PERSON could plausibly appear on.
 *
 * Two jobs, both built on `smart-search`:
 *
 *  1. `searchRoutes` — "cogs", "remitance", "cr", "salary" should all land on
 *     the right page. Matching runs over the label, the group name, the URL
 *     slug and a per-page `keywords` list, each weighted, so a page can be
 *     found by a word it does not literally display.
 *
 *  2. `personContextRoutes` — typing a staff name ("Olasukanmi") cannot match
 *     any route label, but the person IS reachable: their profile, their
 *     attendance, the payroll and team pages they appear on. Given a matched
 *     user we emit those pages with the person's id already in the URL, so the
 *     result is one tap from the actual record rather than from a list the user
 *     then has to search again.
 *
 * Permission filtering is INHERITED, never re-implemented: callers pass the
 * already-filtered nav groups, and a person-context route is only emitted when
 * its href belongs to a page in that list. A result can therefore never expose
 * a page the caller cannot open.
 */

import { NO_MATCH, scoreFields, type SearchField } from './smart-search';

export interface RouteSearchTab {
  value: string;
  label: string;
  /** Extra words that should find this tab. */
  keywords?: string[];
  /**
   * The query param this page actually reads for its sections. Defaults to
   * `tab`, which most pages use; Funding drives its sections from `section`
   * and Aging from `kind`. A deep-link built with the wrong param name lands
   * the user on the page's default section, silently, so this is declared per
   * tab rather than assumed.
   */
  param?: string;
}

export interface RouteSearchItem {
  label: string;
  href: string;
  tabs?: RouteSearchTab[];
  /** Domain synonyms for the page: "salary" for Payroll, "staff" for Users. */
  keywords?: string[];
}

export interface RouteSearchGroup<TItem extends RouteSearchItem = RouteSearchItem> {
  group: string | null;
  items: TItem[];
}

export interface RouteSearchHit<TItem extends RouteSearchItem = RouteSearchItem> {
  item: TItem;
  group: string | null;
  /** Set for a tab hit — the caller renders "Parent › Tab". */
  tabLabel?: string;
  score: number;
}

/** Field weights. The label is the truth; everything else supports it. */
const W_LABEL = 1;
const W_GROUP = 0.7;
const W_KEYWORD = 0.78;
const W_PATH = 0.45;

/** `/admin/marketing/cross-funnel` → "marketing cross funnel" */
function pathWords(href: string): string {
  return href
    .replace(/^\/+/, '')
    .replace(/[/\-_]+/g, ' ')
    .replace(/\badmin\b/g, '')
    .trim();
}

/**
 * Deep-link to one section of a page. Built with URLSearchParams so an href
 * that already carries a query string keeps it instead of gaining a second
 * `?`. No nav href has one today, which is exactly why this would otherwise
 * break silently the first time one did.
 */
function tabHref(href: string, tab: RouteSearchTab): string {
  const [path, existing] = href.split('?');
  const params = new URLSearchParams(existing ?? '');
  params.set(tab.param ?? 'tab', tab.value);
  return `${path}?${params.toString()}`;
}

function itemFields(item: RouteSearchItem, group: string | null): SearchField[] {
  const fields: SearchField[] = [
    { text: item.label, weight: W_LABEL },
    { text: pathWords(item.href), weight: W_PATH },
  ];
  if (group) fields.push({ text: group, weight: W_GROUP });
  for (const kw of item.keywords ?? []) fields.push({ text: kw, weight: W_KEYWORD });
  return fields;
}

/**
 * Rank pages and their tab sections against `query`.
 *
 * Rules carried over from the original substring filter, because they are
 * about result *shape* rather than matching strength:
 *
 *  - a page matches on its own label OR its group name, so "hr" surfaces
 *    everything under the HR group;
 *  - a tab deep-links to `?<param>=<value>` (default `tab`), which the page
 *    reads via `searchParams.get(...)`, so the result opens that section
 *    directly;
 *  - a page whose own label matches is not expanded into all of its tabs.
 *    Typing "settings" lists Settings once, not seven near-identical rows.
 */
export function searchRoutes<TItem extends RouteSearchItem>(
  groups: Array<RouteSearchGroup<TItem>>,
  query: string,
  options?: { limit?: number },
): Array<RouteSearchHit<TItem>> {
  const q = query.trim();
  if (!q) return [];

  const hits: Array<RouteSearchHit<TItem>> = [];

  for (const g of groups) {
    for (const item of g.items) {
      const labelScore = scoreFields(q, [
        { text: item.label, weight: W_LABEL },
        ...(item.keywords ?? []).map((kw) => ({ text: kw, weight: W_KEYWORD })),
      ]);
      const itemScore = scoreFields(q, itemFields(item, g.group));

      if (itemScore > NO_MATCH) hits.push({ item, group: g.group, score: itemScore });

      // Only dig into tabs when the page itself was not a direct label/keyword
      // hit — otherwise one page floods the list with its own sections.
      if (labelScore > NO_MATCH) continue;

      for (const tab of item.tabs ?? []) {
        const tabScore = scoreFields(q, [
          { text: tab.label, weight: W_LABEL },
          ...(tab.keywords ?? []).map((kw) => ({ text: kw, weight: W_KEYWORD })),
        ]);
        if (tabScore <= NO_MATCH) continue;
        hits.push({
          // A tab sits one level below its page, so it should not outrank a
          // page that matched just as strongly.
          score: tabScore * 0.92,
          item: { ...item, href: tabHref(item.href, tab) },
          group: g.group,
          tabLabel: tab.label,
        });
      }
    }
  }

  hits.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return options?.limit ? hits.slice(0, options.limit) : hits;
}

/* ── Person-context routes ─────────────────────────────────────────────────
 *
 * When the query turns out to be a person's name, these are the pages where
 * that person is a first-class subject. `href` is a template: `:id` is the
 * user id. `requiresNav` is the nav page that must be visible to the caller
 * for the suggestion to be offered — that is the whole permission check, since
 * the nav list handed in has already been filtered per role.
 */
interface PersonRouteDef {
  /** Suggestion label, with `{name}` replaced by the person's name. */
  label: string;
  /** URL with `:id` replaced by the user id. */
  href: string;
  /** Nav href that must be present for this suggestion to be shown. */
  requiresNav: string;
  /** Roles this suggestion only makes sense for (the person's role, not the caller's). */
  onlyForRoles?: string[];
  /** Ordering weight within the person block. */
  rank: number;
}

const PERSON_ROUTES: PersonRouteDef[] = [
  { label: '{name}: profile', href: '/hr/users/:id', requiresNav: '/hr/users', rank: 1 },
  {
    label: '{name}: attendance',
    href: '/hr/attendance/:id',
    requiresNav: '/hr/attendance',
    rank: 2,
  },
  // `/hr/users/:id/history` renders UserPayrollHistoryPage — payouts, salary
  // adjustments and tax documents, NOT permission history. So it is labelled as
  // payroll and gated on the payroll nav item: `/hr/users` is reachable with
  // `users.read` alone, which does not imply payroll visibility, and the page's
  // own procedures (`hr.listPayouts` / `hr.listAdjustments`) would 403 anyway.
  // Offering it off `/hr/users` advertised a colleague's salary record to
  // someone who cannot open it.
  {
    label: '{name}: payroll history',
    href: '/hr/users/:id/history',
    requiresNav: '/hr/payroll',
    rank: 3,
  },
  {
    label: '{name}: marketing orders',
    href: '/admin/marketing/orders?mediaBuyerId=:id',
    requiresNav: '/admin/marketing/orders',
    onlyForRoles: ['MEDIA_BUYER', 'HEAD_OF_MARKETING'],
    rank: 4,
  },
  {
    label: '{name}: CS orders',
    href: '/admin/sales/orders?csCloserId=:id',
    requiresNav: '/admin/sales/orders',
    onlyForRoles: ['CS_CLOSER', 'HEAD_OF_CS'],
    rank: 4,
  },
  // Team pages filter by free-text `q`, not by id — so the person's name is
  // what goes in the URL. Verified against the pages' own searchParams.
  {
    label: '{name}: in marketing team analysis',
    href: '/admin/marketing/team?q=:name',
    requiresNav: '/admin/marketing/team',
    onlyForRoles: ['MEDIA_BUYER', 'HEAD_OF_MARKETING'],
    rank: 5,
  },
  {
    label: '{name}: in CS team analysis',
    href: '/admin/sales/team?q=:name',
    requiresNav: '/admin/sales/team',
    onlyForRoles: ['CS_CLOSER', 'HEAD_OF_CS'],
    rank: 5,
  },
];

export interface PersonContextHit {
  /** Stable key for React and for de-duping. */
  id: string;
  label: string;
  href: string;
  rank: number;
}

/**
 * Pages where `person` is the subject, filtered to what the caller can open.
 *
 * `navHrefs` is the set of hrefs from the caller's own (already
 * permission-filtered) nav tree — a suggestion whose `requiresNav` is absent
 * is dropped, so this never widens access.
 */
export function personContextRoutes(
  person: { id: string; name: string; role?: string | null },
  navHrefs: ReadonlySet<string>,
): PersonContextHit[] {
  const name = person.name?.trim() || 'This user';
  return PERSON_ROUTES.filter((def) => {
    if (!navHrefs.has(def.requiresNav)) return false;
    if (def.onlyForRoles && !def.onlyForRoles.includes(person.role ?? '')) return false;
    return true;
  })
    .map((def) => ({
      id: `${def.href}:${person.id}`,
      label: def.label.replace('{name}', name),
      href: def.href.replace(':id', person.id).replace(':name', encodeURIComponent(name)),
      rank: def.rank,
    }))
    .sort((a, b) => a.rank - b.rank);
}
